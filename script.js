/* ==========================================================
   Bismayah HSE Control Room — script.js
   - 실시간 시계 (바그다드 표준시 UTC+3)
   - Open-Meteo 날씨/대기질 API 연동 (무료, API 키 불필요)
   - data.json 기반 안전지표/공지/비상연락망 렌더링
   - 기온 기반 옥외작업 상태 판정 (폭염 지수)
   ========================================================== */

const BISMAYAH_LAT = 33.193;
const BISMAYAH_LON = 44.618;
const TIMEZONE = "Asia/Baghdad";

/* ---------------- 구글 번역 배너 강제 제거 ----------------
   구글 번역 스크립트는 언어를 바꿀 때마다 상단 배너(goog-te-banner-frame)의
   인라인 스타일을 자바스크립트로 다시 덮어써서, CSS의 display:none !important
   조차 무시하고 배너를 다시 노출시키는 경우가 있다.
   (인라인 style + important 는 외부 stylesheet의 !important보다도 우선순위가 높음)
   그래서 배너가 생길 때마다 즉시 다시 강제로 숨기는 감시 로직을 둔다. */
function killGoogleTranslateBanner() {
  // 클래스명만으로는 구글이 마크업을 바꿀 때 못 잡을 수 있으므로,
  // "화면 맨 위에 딱 붙어 있고 가로폭이 화면 대부분을 차지하는 얇은 막대"라는
  // 배너의 생김새(좌표) 자체로도 판별한다. 이렇게 하면 클래스명이 바뀌어도
  // 안전하게 잡히고, 언어 선택 드롭다운(작고 위젯 옆에 뜨는 iframe)은
  // 건드리지 않는다.
  document.querySelectorAll("iframe").forEach((el) => {
    const cls = el.className && el.className.baseVal !== undefined
      ? el.className.baseVal : (el.className || "");
    let looksLikeBanner = cls.includes("banner"); // goog-te-banner-frame 등
    if (!looksLikeBanner) {
      const rect = el.getBoundingClientRect();
      looksLikeBanner =
        rect.top <= 5 &&
        rect.width >= window.innerWidth * 0.7 &&
        rect.height > 0 && rect.height < 60;
    }
    if (looksLikeBanner) {
      el.style.setProperty("display", "none", "important");
      el.style.setProperty("visibility", "hidden", "important");
      el.style.setProperty("height", "0px", "important");
      el.style.setProperty("border", "0", "important");
    }
  });
  // 구글이 배너를 위해 밀어낸 body 위치도 매번 원상 복구
  if (document.body.style.top !== "0px") {
    document.body.style.setProperty("top", "0px", "important");
  }
  document.body.style.setProperty("position", "static", "important");
}

// 배너는 DOM에 새로 삽입/변경될 때 나타나므로 MutationObserver로 실시간 감시
const googleBannerObserver = new MutationObserver(killGoogleTranslateBanner);
googleBannerObserver.observe(document.documentElement, {
  childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"]
});
// 혹시 옵저버가 못 잡는 타이밍이 있을 수 있어 짧은 주기로도 한 번씩 더 확인
setInterval(killGoogleTranslateBanner, 400);
killGoogleTranslateBanner();

/* ---------------- 자체 제작 언어 전환 버튼 ----------------
   구글 번역 위젯이 내부적으로 만드는 <select class="goog-te-combo"> 를
   직접 조작해서 번역을 실행한다. 이 select는 구글 스크립트(element.js)가
   비동기로 로드된 "이후"에야 생성되므로, 페이지 로드 직후에는 아직 없을 수
   있다. 그래서 최대 20초(200ms x 100회)까지 계속 찾아보고, 찾으면 그때
   실행한다 — 버튼을 클릭한 시점에 구글 스크립트가 아직 로딩 중이어도
   기다렸다가 확실히 반영되도록 하기 위함. */
function findGoogleTranslateSelect(onFound, attemptsLeft) {
  if (attemptsLeft === undefined) attemptsLeft = 100;
  const select = document.querySelector("#google_translate_element select.goog-te-combo")
    || document.querySelector("select.goog-te-combo");
  if (select) { onFound(select); return; }
  if (attemptsLeft <= 0) {
    console.warn("[langSwitcher] 구글 번역 select를 찾지 못했습니다. 구글 스크립트 로드에 실패했을 수 있습니다.");
    return;
  }
  setTimeout(() => findGoogleTranslateSelect(onFound, attemptsLeft - 1), 200);
}

function setGoogleTranslateLanguage(lang) {
  findGoogleTranslateSelect((select) => {
    select.value = lang;
    // 구글 위젯이 확실히 감지하도록 change 이벤트를 버블링까지 포함해서 전달
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

document.querySelectorAll(".lang-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".lang-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    setGoogleTranslateLanguage(btn.dataset.lang);
  });
});

// 페이지 로드 시 미리 select를 찾아둬서, 실제 클릭 시점에는
// 지연 없이 바로 반영되도록 워밍업
findGoogleTranslateSelect(() => {});

/* ---------------- 시계 ---------------- */
function updateClock() {
  const now = new Date();
  const timeFmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  });
  const dateFmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: TIMEZONE, year: "numeric", month: "long", day: "numeric", weekday: "long"
  });
  document.getElementById("clock").textContent = timeFmt.format(now);
  document.getElementById("date").textContent = dateFmt.format(now);

  const kstFmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  });
  const kstEl = document.getElementById("clockKst");
  if (kstEl) kstEl.textContent = kstFmt.format(now);
}
updateClock();
setInterval(updateClock, 1000);

/* ---------------- data.json 로드 & 렌더 ---------------- */
async function loadSiteData() {
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    if (!res.ok) throw new Error("data.json 로드 실패");
    const data = await res.json();
    renderIncidentCounter(data.site);
    renderMetrics(data.metrics);
    renderNotices(data.notices);
    renderContacts(data.emergencyContacts);
    renderOrgChart(data.orgChart);
    renderIncidentByDept(data.site ? data.site.incidentByDept : null);
  } catch (err) {
    console.error(err);
    document.getElementById("lastIncidentText").textContent =
      "data.json을 불러올 수 없습니다 (로컬에서 열람 시 브라우저 보안정책으로 fetch가 막힐 수 있습니다. GitHub Pages 배포 후 정상 동작합니다).";
  }
}

function renderIncidentCounter(site) {
  if (!site) return;
  const start = new Date(site.lastIncidentDate + "T00:00:00");
  const now = new Date();
  const days = Math.max(0, Math.floor((now - start) / 86400000));
  animateCount(document.getElementById("incidentFreeDays"), days);
  document.getElementById("lastIncidentText").textContent =
    `최종 사고 기준일: ${site.lastIncidentDate} · 무사고 목표를 함께 지켜주세요.`;
  document.getElementById("monthlyInspections").textContent = site.monthlyInspections ?? "–";
  document.getElementById("trainingRate").textContent = site.trainingRate ?? "–";
  document.getElementById("incidentCount").textContent = site.incidentCount ?? "–";
  renderConstructionCounter(site);
}

function renderConstructionCounter(site) {
  if (!site || !site.constructionStartDate) return;
  const start = new Date(site.constructionStartDate + "T00:00:00");
  const now = new Date();
  const days = Math.max(0, Math.floor((now - start) / 86400000));
  animateCount(document.getElementById("constructionDays"), days);
  document.getElementById("constructionStartText").textContent =
    `착공일: ${site.constructionStartDate} · 오늘까지 누적 공사일수`;
}

function animateCount(el, target) {
  let current = 0;
  const step = Math.max(1, Math.ceil(target / 60));
  const timer = setInterval(() => {
    current += step;
    if (current >= target) { current = target; clearInterval(timer); }
    el.textContent = current.toLocaleString("ko-KR");
  }, 16);
}

function renderMetrics(metrics) {
  const list = document.getElementById("metricList");
  if (!metrics || !metrics.length) {
    list.innerHTML = `<li class="metric-row skeleton">등록된 안전 지표가 없습니다.</li>`;
    return;
  }
  list.innerHTML = metrics.map(m => `
    <li class="metric-row">
      <span>${escapeHtml(m.label)}</span>
      <span class="metric-value">${escapeHtml(m.value)}</span>
    </li>
  `).join("");
}

function renderNotices(notices) {
  const list = document.getElementById("noticeList");
  if (!notices || !notices.length) {
    list.innerHTML = `<li class="notice-row skeleton">등록된 공지사항이 없습니다.</li>`;
    return;
  }
  list.innerHTML = notices.map(n => `
    <li class="notice-row level-${escapeHtml(n.level)}">
      <div class="notice-top">
        <span class="notice-title"><span class="notice-tag">${escapeHtml(n.level)}</span>${escapeHtml(n.title)}</span>
        <span class="notice-date">${escapeHtml(n.date)}</span>
      </div>
      <div class="notice-body">${escapeHtml(n.body)}</div>
    </li>
  `).join("");
}

function renderContacts(contacts) {
  const list = document.getElementById("contactList");
  if (!contacts || !contacts.length) {
    list.innerHTML = `<li class="contact-row skeleton">등록된 연락처가 없습니다.</li>`;
    return;
  }
  list.innerHTML = contacts.map(c => `
    <li class="contact-row">
      <span>
        <span class="contact-role">${escapeHtml(c.role)}</span>
        <span class="contact-name">${escapeHtml(c.name || "")}</span>
      </span>
      <span class="contact-phone">${escapeHtml(c.phone)}</span>
    </li>
  `).join("");
}

async function loadNews() {
  const list = document.getElementById("newsList");
  try {
    const res = await fetch("news.json", { cache: "no-store" });
    if (!res.ok) throw new Error("news.json 로드 실패");
    const data = await res.json();
    renderNews(data.items, data.generatedAt);
  } catch (err) {
    console.error(err);
    list.innerHTML = `<li class="news-row skeleton">아직 news.json이 없거나 불러올 수 없습니다. GitHub Actions가 최초 1회 실행된 후 표시됩니다.</li>`;
  }
}

function renderNews(items, generatedAt) {
  const list = document.getElementById("newsList");
  if (!items || !items.length) {
    list.innerHTML = `<li class="news-row skeleton">최근 수집된 소식이 없습니다.</li>`;
    return;
  }
  list.innerHTML = items.map(n => `
    <li class="news-row">
      <div class="notice-top">
        <span class="notice-title">${escapeHtml(n.title_ko || n.title_en)}</span>
        <span class="notice-date">${escapeHtml(n.published ? n.published.slice(0, 16) : "")}</span>
      </div>
      <div class="notice-body">${escapeHtml(n.summary_ko || "")}</div>
      <div class="news-footer">
        <span class="news-source">${escapeHtml(n.source || "")}</span>
        <a class="news-link" href="${n.link}" target="_blank" rel="noopener noreferrer">원문 보기 ↗</a>
      </div>
    </li>
  `).join("");

  if (generatedAt) {
    const dt = new Date(generatedAt);
    document.getElementById("newsMeta").textContent =
      "Google News 기반 자동 수집 · 마지막 수집: " +
      new Intl.DateTimeFormat("ko-KR", { timeZone: TIMEZONE, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(dt);
  }
}

function escapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ---------------- 날씨 & 대기질 (Open-Meteo) ---------------- */
async function loadWeather() {
  try {
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${BISMAYAH_LAT}&longitude=${BISMAYAH_LON}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,wind_direction_10m&hourly=precipitation_probability&daily=sunrise,sunset&timezone=${encodeURIComponent(TIMEZONE)}`;
    const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${BISMAYAH_LAT}&longitude=${BISMAYAH_LON}&current=pm10,pm2_5,ozone,uv_index&timezone=${encodeURIComponent(TIMEZONE)}`;

    const [weatherRes, airRes] = await Promise.all([fetch(weatherUrl), fetch(airUrl)]);
    const weather = await weatherRes.json();
    const air = await airRes.json();

    const c = weather.current;
    const a = air.current;

    document.getElementById("wTemp").textContent = c.temperature_2m?.toFixed(1) ?? "–";
    document.getElementById("wFeels").textContent = c.apparent_temperature?.toFixed(1) ?? "–";
    document.getElementById("wHumidity").textContent = c.relative_humidity_2m ?? "–";
    document.getElementById("wWind").textContent = c.wind_speed_10m?.toFixed(1) ?? "–";
    updateWindDirection(c.wind_direction_10m);
    document.getElementById("wPm10").textContent = a.pm10?.toFixed(0) ?? "–";
    document.getElementById("wPm25").textContent = a.pm2_5?.toFixed(0) ?? "–";
    document.getElementById("wOzone").textContent = a.ozone?.toFixed(0) ?? "–";
    updateUvIndex(a.uv_index);

    updateHeatStatus(c.temperature_2m, c.apparent_temperature);
    updateSunTimes(weather.daily);
    updateRainChance(weather.hourly);
    document.getElementById("lastUpdated").textContent =
      "마지막 갱신: " + new Intl.DateTimeFormat("ko-KR", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit" }).format(new Date());
  } catch (err) {
    console.error(err);
    document.getElementById("heatStatus").innerHTML = `
      <div class="heat-status-title">날씨 데이터를 불러올 수 없습니다</div>
      <div class="heat-status-desc">네트워크 연결을 확인하거나 잠시 후 다시 시도하세요.</div>
    `;
  }
}

/* 기온 기준 임계값은 현장 안전관리 기준에 맞춰 data.json 화 하거나 아래 값을 조정하세요. */
const HEAT_THRESHOLDS = [
  { max: 35, key: "ok",      label: "정상 작업",     desc: "특이사항 없음. 통상적인 수분 섭취 수칙을 준수하세요.", seg: "seg-ok" },
  { max: 42, key: "caution", label: "주의 · 수분보충 강화", desc: "매시간 그늘 휴식과 수분 섭취를 의무화하세요.", seg: "seg-caution" },
  { max: 46, key: "warn",    label: "경고 · 옥외작업 단축", desc: "정오~오후 옥외작업 시간을 단축하고 순환 근무를 적용하세요.", seg: "seg-warn" },
  { max: Infinity, key: "danger", label: "위험 · 옥외작업 중지 권고", desc: "고온 노출 위험이 매우 높습니다. 옥외작업 중지를 권고합니다.", seg: "seg-danger" }
];

const WIND_COMPASS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"
];

function updateWindDirection(deg) {
  const arrow = document.getElementById("windArrow");
  const label = document.getElementById("wWindDir");
  if (deg === undefined || deg === null || isNaN(deg)) {
    if (label) label.textContent = "–";
    return;
  }
  // 화살표는 구글 날씨처럼 '바람이 불어가는 방향'을 가리키도록 표시
  // (Open-Meteo의 deg 값은 '불어오는 방향' 기준이라 180도 반전해서 사용합니다.)
  if (arrow) arrow.style.transform = `rotate(${deg + 180}deg)`;
  const idx = Math.round(deg / 22.5) % 16;
  if (label) label.textContent = `${WIND_COMPASS[idx]} (${Math.round(deg)}°)`;
}

function updateUvIndex(uv) {
  const el = document.getElementById("wUv");
  if (!el) return;
  if (uv === undefined || uv === null || isNaN(uv)) {
    el.textContent = "–";
    return;
  }
  let label;
  if (uv < 3) label = "낮음";
  else if (uv < 6) label = "보통";
  else if (uv < 8) label = "높음";
  else if (uv < 11) label = "매우높음";
  else label = "위험";
  el.textContent = `${uv.toFixed(1)} (${label})`;
}

function updateSunTimes(daily) {
  const riseEl = document.getElementById("wSunrise");
  const setEl = document.getElementById("wSunset");
  if (!riseEl || !setEl) return;
  if (!daily || !daily.sunrise || !daily.sunrise[0]) {
    riseEl.textContent = "–";
    setEl.textContent = "–";
    return;
  }
  const fmt = new Intl.DateTimeFormat("ko-KR", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false });
  riseEl.textContent = fmt.format(new Date(daily.sunrise[0]));
  setEl.textContent = fmt.format(new Date(daily.sunset[0]));
}

function updateRainChance(hourly) {
  const el = document.getElementById("wRainChance");
  if (!el) return;
  if (!hourly || !hourly.time || !hourly.precipitation_probability) {
    el.textContent = "–";
    return;
  }
  // 현재 시각과 가장 가까운(이전) 시간대의 예보를 찾습니다.
  const now = new Date();
  let idx = 0;
  for (let i = 0; i < hourly.time.length; i++) {
    if (new Date(hourly.time[i]) <= now) idx = i;
    else break;
  }
  const prob = hourly.precipitation_probability[idx];
  el.textContent = (prob === undefined || prob === null) ? "–" : `${prob}%`;
}

function updateHeatStatus(temp, feelsLike) {
  const ref = feelsLike ?? temp;
  const level = HEAT_THRESHOLDS.find(t => ref < t.max) || HEAT_THRESHOLDS[HEAT_THRESHOLDS.length - 1];

  const box = document.getElementById("heatStatus");
  box.classList.remove("heat-loading", "status-ok", "status-caution", "status-warn", "status-danger");
  box.classList.add(`status-${level.key}`);
  box.innerHTML = `
    <div class="heat-status-title">${level.label} (체감 ${ref?.toFixed(1) ?? "–"}°C)</div>
    <div class="heat-status-desc">${level.desc}</div>
  `;

  document.querySelectorAll(".heat-scale-seg").forEach(seg => seg.classList.remove("active"));
  document.querySelector(`.${level.seg}`)?.classList.add("active");
}

/* ---------------- 초기 실행 ---------------- */
loadSiteData();
loadWeather();
setInterval(loadWeather, 10 * 60 * 1000); // 10분마다 갱신


/* ---------------- 탭 전환 ---------------- */
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.view).classList.add("active");

    // 탭에 맞춰 배경 사진도 전환
    const bgClass = "bg-" + btn.dataset.view.replace("view-", "");
    document.body.className = bgClass;
  });
});

/* ---------------- 대사관 안전공지 ---------------- */
async function loadEmbassyNotices() {
  const list = document.getElementById("embassyList");
  try {
    const res = await fetch("embassy-notices.json", { cache: "no-store" });
    if (!res.ok) throw new Error("embassy-notices.json 로드 실패");
    const data = await res.json();
    renderEmbassyNotices(data.items, data.generatedAt);
  } catch (err) {
    console.error(err);
    list.innerHTML = `<li class="embassy-row skeleton">아직 embassy-notices.json이 없거나 불러올 수 없습니다. GitHub Actions가 최초 1회 실행된 후 표시됩니다.</li>`;
  }
}

function renderEmbassyNotices(items, generatedAt) {
  const list = document.getElementById("embassyList");
  if (!items || !items.length) {
    list.innerHTML = `<li class="embassy-row skeleton">최근 수집된 안전공지가 없습니다.</li>`;
    return;
  }
  const EMBASSY_LIST_URL = "https://www.mofa.go.kr/iq-ko/brd/m_11320/list.do";

  list.innerHTML = items.map(n => {
    const hasBody = n.body && n.body.trim().length > 0;
    return `
    <li class="embassy-row">
      <div class="notice-top">
        <span class="notice-title">${escapeHtml(n.title)}</span>
        <span class="notice-date">${escapeHtml(n.date || "")}</span>
      </div>
      ${hasBody ? `
        <div class="notice-body">${escapeHtml(n.body)}</div>
        <button type="button" class="embassy-toggle">자세히 보기 ▾</button>
      ` : `
        <div class="notice-body embassy-empty">이 공지는 본문 요약이 제공되지 않습니다.</div>
        <a class="embassy-link" href="${EMBASSY_LIST_URL}" target="_blank" rel="noopener noreferrer">대사관 홈페이지에서 원문 확인 ↗</a>
      `}
    </li>`;
  }).join("");

  document.querySelectorAll(".embassy-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const row = btn.closest(".embassy-row");
      const expanded = row.classList.toggle("expanded");
      btn.textContent = expanded ? "접기 ▴" : "자세히 보기 ▾";
    });
  });

  if (generatedAt) {
    const dt = new Date(generatedAt);
    document.getElementById("embassyMeta").textContent =
      "외교부 공공데이터 API 연동 · 마지막 수집: " +
      new Intl.DateTimeFormat("ko-KR", { timeZone: TIMEZONE, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(dt);
  }
}

loadEmbassyNotices();

function renderOrgChart(org) {
  const container = document.getElementById("orgChartContainer");
  if (!container) return;
  if (!org || !org.root) {
    container.innerHTML = `<p class="skeleton">등록된 조직도가 없습니다.</p>`;
    return;
  }

  const teamsHtml = (org.teams || []).map(team => `
    <div class="org-team">
      <div class="org-box org-lead">
        <span class="org-title">${escapeHtml(team.title)}</span>
        <span class="org-name">${escapeHtml(team.name || "")}</span>
      </div>
      <div class="org-members">
        ${(team.members || []).map(m => `
          <div class="org-box org-member">
            <span class="org-title">${escapeHtml(m.title)}</span>
            <span class="org-name">${escapeHtml(m.name || "")}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");

  container.innerHTML = `
    <div class="org-root-row">
      <div class="org-box org-root">
        <span class="org-title">${escapeHtml(org.root.title)}</span>
        <span class="org-name">${escapeHtml(org.root.name || "")}</span>
      </div>
    </div>
    <div class="org-teams-row">
      ${teamsHtml}
    </div>
  `;
}

function renderIncidentByDept(list) {
  const el = document.getElementById("incidentDeptList");
  if (!el) return;
  if (!list || !list.length) {
    el.innerHTML = `<li class="metric-row skeleton">등록된 부서별 사고 데이터가 없습니다.</li>`;
    return;
  }
  el.innerHTML = list.map(d => `
    <li class="metric-row">
      <span>${escapeHtml(d.dept)}${d.detail ? `<span class="metric-detail"> · ${escapeHtml(d.detail)}</span>` : ""}</span>
      <span class="metric-value${Number(d.count) > 0 ? " metric-alert" : ""}">${escapeHtml(String(d.count))}건</span>
    </li>
  `).join("");
}

/* ---------------- 국내 온열질환 현황 ---------------- */
async function loadHeatIllness() {
  try {
    const res = await fetch("domestic-heat-illness.json", { cache: "no-store" });
    if (!res.ok) throw new Error("domestic-heat-illness.json 로드 실패");
    const data = await res.json();
    renderHeatIllness(data);
  } catch (err) {
    console.error(err);
    document.getElementById("heatIllnessMeta").textContent = "데이터를 불러올 수 없습니다.";
  }
}

function renderHeatIllness(data) {
  document.getElementById("heatIllnessTotal").textContent =
    (data.totalCount ?? 0).toLocaleString("ko-KR");

  const metaParts = [];
  if (data.year) metaParts.push(`${data.year}년 시즌 누적`);
  if (data.latestDate) metaParts.push(`최근 발생일 ${data.latestDate}`);
  document.getElementById("heatIllnessMeta").textContent =
    metaParts.length ? metaParts.join(" · ") : "집계된 데이터가 없습니다.";

  const noteEl = document.getElementById("heatIllnessNote");
  if (noteEl) {
    noteEl.textContent = data.note || "";
    noteEl.style.display = data.note ? "block" : "none";
  }

  const list = document.getElementById("heatIllnessRegionList");
  if (!data.byRegion || !data.byRegion.length) {
    list.innerHTML = `<li class="metric-row skeleton">지역별 데이터가 없습니다.</li>`;
    return;
  }
  list.innerHTML = data.byRegion.map(r => `
    <li class="metric-row">
      <span>${escapeHtml(r.region)}</span>
      <span class="metric-value">${escapeHtml(String(r.count))}건</span>
    </li>
  `).join("");
}

loadHeatIllness();

/* ---------------- 전국 건설업 중대재해 (연간 누적) ---------------- */
async function loadDailyDisaster() {
  try {
    const res = await fetch("daily-disaster.json", { cache: "no-store" });
    if (!res.ok) throw new Error("daily-disaster.json 로드 실패");
    const data = await res.json();
    renderDailyDisaster(data);
  } catch (err) {
    console.error(err);
    document.getElementById("disasterMeta").textContent = "데이터를 불러올 수 없습니다.";
  }
}

function renderDailyDisaster(data) {
  const totalEl = document.getElementById("disasterTotal");
  const meta = document.getElementById("disasterMeta");
  const typeList = document.getElementById("disasterTypeList");
  const list = document.getElementById("disasterList");
  const count = data.totalCount ?? 0;

  totalEl.textContent = count.toLocaleString("ko-KR");
  meta.textContent = data.year
    ? `${data.year}년 누적 (${data.daysChecked ?? "–"}일 조회 기준)`
    : "데이터가 아직 없습니다.";

  if (data.byType && data.byType.length) {
    typeList.innerHTML = data.byType.map(t => `
      <li class="metric-row">
        <span>${escapeHtml(t.type)}</span>
        <span class="metric-value">${escapeHtml(String(t.count))}건</span>
      </li>
    `).join("");
  } else {
    typeList.innerHTML = `<li class="metric-row skeleton">유형별 데이터가 없습니다.</li>`;
  }

  if (!data.recentIncidents || !data.recentIncidents.length) {
    list.innerHTML = `<li class="notice-row skeleton">올해 보고된 중대재해가 없습니다.</li>`;
    return;
  }

  list.innerHTML = data.recentIncidents.map(it => `
    <li class="notice-row level-긴급">
      <div class="notice-top">
        <span class="notice-title"><span class="notice-tag">${escapeHtml(it.type || "재해")}</span>${escapeHtml(it.location || "")} · ${escapeHtml(it.jobProcess || "")}</span>
        <span class="notice-date">${escapeHtml(it.date || "")}</span>
      </div>
      <div class="notice-body">${escapeHtml(it.detail || "")}</div>
      ${it.prevention ? `<div class="notice-body embassy-empty">예방대책: ${escapeHtml(it.prevention)}</div>` : ""}
    </li>
  `).join("");
}

loadDailyDisaster();

/* ---------------- WHO 전세계 감염병 발생 정보 ---------------- */
async function loadWhoOutbreaks() {
  const list = document.getElementById("whoOutbreakList");
  try {
    const res = await fetch("who-outbreaks.json", { cache: "no-store" });
    if (!res.ok) throw new Error("who-outbreaks.json 로드 실패");
    const data = await res.json();
    renderWhoOutbreaks(data.items, data.generatedAt);
  } catch (err) {
    console.error(err);
    list.innerHTML = `<li class="embassy-row skeleton">아직 who-outbreaks.json이 없거나 불러올 수 없습니다. GitHub Actions가 최초 1회 실행된 후 표시됩니다.</li>`;
  }
}

function renderWhoOutbreaks(items, generatedAt) {
  const list = document.getElementById("whoOutbreakList");
  if (!items || !items.length) {
    list.innerHTML = `<li class="embassy-row skeleton">최근 수집된 정보가 없습니다.</li>`;
    return;
  }
  list.innerHTML = items.map(n => `
    <li class="embassy-row">
      <div class="notice-top">
        <span class="notice-title">${escapeHtml(n.title)}</span>
        <span class="notice-date">${escapeHtml((n.date || "").slice(0, 10))}</span>
      </div>
      <div class="notice-body">${escapeHtml(n.summary || "")}</div>
      ${n.link ? `<a class="embassy-link" href="${n.link}" target="_blank" rel="noopener noreferrer">WHO 원문 보기 ↗</a>` : ""}
    </li>
  `).join("");

  if (generatedAt) {
    const dt = new Date(generatedAt);
    document.getElementById("whoOutbreakMeta").textContent =
      "World Health Organization 공식 API 연동 · 마지막 수집: " +
      new Intl.DateTimeFormat("ko-KR", { timeZone: TIMEZONE, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(dt);
  }
}

loadWhoOutbreaks();

/* ---------------- 안전작업절차서 (procedures.json 기반) ---------------- */
function procEscapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function loadProcedures() {
  const container = document.getElementById("procedureContainer");
  if (!container) return;
  try {
    const res = await fetch("procedures.json", { cache: "no-store" });
    if (!res.ok) throw new Error("procedures.json 로드 실패");
    const data = await res.json();
    renderProcedures(data.categories);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<p class="skeleton">procedures.json을 불러올 수 없습니다.</p>`;
  }
}

function renderProcedures(categories) {
  const container = document.getElementById("procedureContainer");
  if (!categories || !categories.length) {
    container.innerHTML = `<p class="skeleton">등록된 절차서가 없습니다.</p>`;
    return;
  }

  container.innerHTML = categories.map(cat => `
    <div class="proc-category">
      <div class="proc-category-title">${procEscapeHtml(cat.name)}</div>
      <ul class="proc-doc-list">
        ${(cat.documents || []).map(doc => `
          <li class="proc-doc-row">
            <a href="${procEscapeHtml(doc.file)}" target="_blank" rel="noopener noreferrer">
              📄 ${procEscapeHtml(doc.title)}
            </a>
          </li>
        `).join("")}
      </ul>
    </div>
  `).join("");
}

loadProcedures();

/* ---------------- 사고사례 (accident-cases.json 기반) ---------------- */
function accEscapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function loadAccidentCases() {
  const container = document.getElementById("accidentContainer");
  if (!container) return;
  try {
    const res = await fetch("accident-cases.json", { cache: "no-store" });
    if (!res.ok) throw new Error("accident-cases.json 로드 실패");
    const data = await res.json();
    renderAccidentCases(data.categories);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<p class="skeleton">accident-cases.json을 불러올 수 없습니다.</p>`;
  }
}

function renderAccidentCases(categories) {
  const container = document.getElementById("accidentContainer");
  if (!categories || !categories.length) {
    container.innerHTML = `<p class="skeleton">등록된 사고사례가 없습니다.</p>`;
    return;
  }

  container.innerHTML = categories.map(cat => `
    <div class="proc-category">
      <div class="proc-category-title">${accEscapeHtml(cat.name)}</div>
      <ul class="proc-doc-list">
        ${(cat.documents || []).map(doc => `
          <li class="proc-doc-row">
            <a href="${accEscapeHtml(doc.file)}" target="_blank" rel="noopener noreferrer">
              📄 ${accEscapeHtml(doc.title)}
            </a>
          </li>
        `).join("")}
      </ul>
    </div>
  `).join("");
}

loadAccidentCases();

/* ==========================================================
   작업구역 (work-zones.json 기반) — 최종본
   점(마커) 없이, 구역 탭으로 전환하며 사진 + 요일별 일정을 보여줍니다.
   ========================================================== */

function wzEscapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function loadWorkZones() {
  const wrap = document.getElementById("workzoneMapWrap");
  if (!wrap) return;
  try {
    const res = await fetch("work-zones.json", { cache: "no-store" });
    if (!res.ok) throw new Error("work-zones.json 로드 실패");
    const data = await res.json();
    renderWorkZones(data);
  } catch (err) {
    console.error(err);
    wrap.innerHTML = `<p class="skeleton">work-zones.json을 불러올 수 없습니다. (${err.message})</p>`;
  }
}

const WZ_DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];
const WZ_CATEGORY_CLASS = {
  "캠프": "wz-cat-camp",
  "Site 북부": "wz-cat-north",
  "Site 남부": "wz-cat-south"
};

let wzZones = [];
let wzActiveIdx = 0;
let wzScale = 1, wzTx = 0, wzTy = 0;

function renderWorkZones(data) {
  const wrap = document.getElementById("workzoneMapWrap");
  wzZones = data.zones || [];

  // 범례 숨김 (구역 탭 자체가 구분 역할을 하므로 불필요)
  const legendEl = document.querySelector(".workzone-legend");
  if (legendEl) legendEl.style.display = "none";

  if (!wzZones.length) {
    wrap.innerHTML = `<p class="skeleton">등록된 구역이 없습니다.</p>`;
    return;
  }

  const tabsHtml = wzZones.map((z, i) => `
    <button type="button" class="wz-tab-btn ${i === 0 ? "active" : ""}" data-idx="${i}">
      <span class="wz-tab-dot ${WZ_CATEGORY_CLASS[z.category] || ""}"></span>
      ${wzEscapeHtml(z.name)}
    </button>
  `).join("");

  wrap.innerHTML = `
    <div class="wz-zone-tabs">${tabsHtml}</div>
    <div class="wz-layout">
      <div class="wz-map-col">
        <div class="wz-viewport" id="wzViewport">
          <div class="wz-zoombox" id="wzZoombox">
            <img src="" alt="구역 사진" class="workzone-bg" id="wzBgImg"
                 onerror="this.style.display='none'; document.getElementById('workzoneMapFallback').style.display='flex';">
            <div id="workzoneMapFallback" class="workzone-fallback" style="display:none;"></div>
          </div>
        </div>
        <div class="wz-zoom-controls">
          <button type="button" id="wzZoomOut" class="wz-zoom-btn">−</button>
          <button type="button" id="wzZoomReset" class="wz-zoom-btn">초기화</button>
          <button type="button" id="wzZoomIn" class="wz-zoom-btn">+</button>
          <span class="wz-zoom-hint">마우스 휠로 확대/축소 · 드래그로 이동</span>
        </div>
      </div>
      <div class="wz-schedule-col" id="wzScheduleCol"></div>
    </div>
  `;

  document.querySelectorAll(".wz-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      wzActiveIdx = parseInt(btn.dataset.idx, 10);
      document.querySelectorAll(".wz-tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      wzShowZone(wzActiveIdx);
    });
  });

  wzShowZone(0);
}

function wzShowZone(idx) {
  const zone = wzZones[idx];
  if (!zone) return;

  const img = document.getElementById("wzBgImg");
  const fallback = document.getElementById("workzoneMapFallback");
  if (img) {
    img.style.display = "block";
    img.src = zone.image || "";
    fallback.textContent = `사진(${zone.image || ""})을 아직 찾을 수 없습니다. assets 폴더에 사진을 넣어주세요.`;
    fallback.style.display = "none";
  }

  wzSetupZoomPan();
  wzShowSchedule(zone);
}

function wzShowSchedule(zone) {
  const col = document.getElementById("wzScheduleCol");
  if (!col) return;

  const scheduleMap = {};
  (zone.schedule || []).forEach(s => { scheduleMap[s.day] = s.work; });

  const rows = WZ_DAY_ORDER.map(day => {
    const work = scheduleMap[day] || "";
    return `
      <div class="wz-day-row ${work ? "" : "wz-day-empty"}">
        <span class="wz-day-label">${wzEscapeHtml(day)}</span>
        <span class="wz-day-work">${work ? wzEscapeHtml(work) : "—"}</span>
      </div>
    `;
  }).join("");

  const catClass = WZ_CATEGORY_CLASS[zone.category] || "";

  col.innerHTML = `
    <div class="wz-schedule-header">
      <span class="wz-schedule-cat-badge ${catClass}">${wzEscapeHtml(zone.category || "")}</span>
      <span class="wz-schedule-title">${wzEscapeHtml(zone.name)}</span>
    </div>
    <div class="wz-day-list">
      ${rows}
    </div>
  `;
}

/* ---------------- 지도 확대/축소/이동 ---------------- */
function wzApplyTransform() {
  const box = document.getElementById("wzZoombox");
  if (!box) return;
  box.style.transform = `translate(${wzTx}px, ${wzTy}px) scale(${wzScale})`;
}

function wzClamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function wzSetupZoomPan() {
  const viewport = document.getElementById("wzViewport");
  const zoombox = document.getElementById("wzZoombox");
  if (!viewport || !zoombox) return;

  wzScale = 1; wzTx = 0; wzTy = 0;
  wzApplyTransform();

  const MIN_SCALE = 1, MAX_SCALE = 5;

  function zoomAt(clientX, clientY, factor) {
    const rect = viewport.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const contentX = (mx - wzTx) / wzScale;
    const contentY = (my - wzTy) / wzScale;
    const newScale = wzClamp(wzScale * factor, MIN_SCALE, MAX_SCALE);
    wzTx = mx - contentX * newScale;
    wzTy = my - contentY * newScale;
    wzScale = newScale;
    if (wzScale === MIN_SCALE) { wzTx = 0; wzTy = 0; }
    wzApplyTransform();
  }

  // 이전 리스너가 중복 등록되지 않도록 새 요소로 교체
  const newViewport = viewport.cloneNode(false);
  while (viewport.firstChild) newViewport.appendChild(viewport.firstChild);
  viewport.parentNode.replaceChild(newViewport, viewport);

  const vp = newViewport;
  const zb = document.getElementById("wzZoombox");

  vp.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomAt(e.clientX, e.clientY, factor);
  }, { passive: false });

  document.getElementById("wzZoomIn")?.addEventListener("click", () => {
    const rect = vp.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.3);
  });
  document.getElementById("wzZoomOut")?.addEventListener("click", () => {
    const rect = vp.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.3);
  });
  document.getElementById("wzZoomReset")?.addEventListener("click", () => {
    wzScale = 1; wzTx = 0; wzTy = 0;
    wzApplyTransform();
  });

  // 드래그로 이동 (마우스)
  let dragging = false, startX = 0, startY = 0, startTx = 0, startTy = 0;
  zb.addEventListener("mousedown", (e) => {
    if (wzScale <= 1) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    startTx = wzTx; startTy = wzTy;
    zb.classList.add("wz-dragging");
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    wzTx = startTx + (e.clientX - startX);
    wzTy = startTy + (e.clientY - startY);
    wzApplyTransform();
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
    zb.classList.remove("wz-dragging");
  });

  // 터치 지원 (모바일)
  let touchStartDist = null, touchStartScale = 1;
  vp.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      touchStartDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartScale = wzScale;
    } else if (e.touches.length === 1 && wzScale > 1) {
      dragging = true;
      startX = e.touches[0].clientX; startY = e.touches[0].clientY;
      startTx = wzTx; startTy = wzTy;
    }
  }, { passive: true });

  vp.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2 && touchStartDist) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = dist / touchStartDist;
      wzScale = wzClamp(touchStartScale * factor, MIN_SCALE, MAX_SCALE);
      wzApplyTransform();
    } else if (e.touches.length === 1 && dragging) {
      wzTx = startTx + (e.touches[0].clientX - startX);
      wzTy = startTy + (e.touches[0].clientY - startY);
      wzApplyTransform();
    }
  }, { passive: true });

  vp.addEventListener("touchend", () => {
    dragging = false;
    touchStartDist = null;
  });
}

loadWorkZones();
