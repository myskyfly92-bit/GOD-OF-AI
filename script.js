/* ==========================================================
   Bismayah SHE Control Room — script.js
   - 실시간 시계 (바그다드 표준시 UTC+3)
   - Open-Meteo 날씨/대기질 API 연동 (무료, API 키 불필요)
   - data.json 기반 안전지표/공지/비상연락망 렌더링
   - 기온 기반 옥외작업 상태 판정 (폭염 지수)
   ========================================================== */

const BISMAYAH_LAT = 33.193;
const BISMAYAH_LON = 44.618;
const TIMEZONE = "Asia/Baghdad";

/* ---------------- 시계 ---------------- */
function updateClock() {
  const now = new Date();
  const timeFmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  });
  const dateFmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: TIMEZONE, year: "numeric", month: "long", day: "numeric", weekday: "long"
  });
  document.getElementById("clock").textContent = timeFmt.format(now) + " (바그다드)";
  document.getElementById("date").textContent = dateFmt.format(now);
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
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${BISMAYAH_LAT}&longitude=${BISMAYAH_LON}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m&timezone=${encodeURIComponent(TIMEZONE)}`;
    const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${BISMAYAH_LAT}&longitude=${BISMAYAH_LON}&current=pm10,pm2_5&timezone=${encodeURIComponent(TIMEZONE)}`;

    const [weatherRes, airRes] = await Promise.all([fetch(weatherUrl), fetch(airUrl)]);
    const weather = await weatherRes.json();
    const air = await airRes.json();

    const c = weather.current;
    const a = air.current;

    document.getElementById("wTemp").textContent = c.temperature_2m?.toFixed(1) ?? "–";
    document.getElementById("wFeels").textContent = c.apparent_temperature?.toFixed(1) ?? "–";
    document.getElementById("wHumidity").textContent = c.relative_humidity_2m ?? "–";
    document.getElementById("wWind").textContent = c.wind_speed_10m?.toFixed(1) ?? "–";
    document.getElementById("wPm10").textContent = a.pm10?.toFixed(0) ?? "–";
    document.getElementById("wPm25").textContent = a.pm2_5?.toFixed(0) ?? "–";

    updateHeatStatus(c.temperature_2m, c.apparent_temperature);
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
  list.innerHTML = items.map(n => `
    <li class="embassy-row">
      <div class="notice-top">
        <span class="notice-title">${escapeHtml(n.title)}</span>
        <span class="notice-date">${escapeHtml(n.date || "")}</span>
      </div>
      <div class="notice-body">${escapeHtml(n.body || "")}</div>
    </li>
  `).join("");

  if (generatedAt) {
    const dt = new Date(generatedAt);
    document.getElementById("embassyMeta").textContent =
      "외교부 공공데이터 API 연동 · 마지막 수집: " +
      new Intl.DateTimeFormat("ko-KR", { timeZone: TIMEZONE, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(dt);
  }
}

loadEmbassyNotices();
