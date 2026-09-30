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
   구글 번역 위젯의 <select>를 흉내 내서 change 이벤트를 발생시키는 방식은
   구글 스크립트 버전에 따라 씹히는 경우가 있어 신뢰할 수 없었다.
   대신 구글 번역이 실제로 사용하는 "googtrans" 쿠키를 직접 심고
   새로고침하는 방식을 쓴다 — 이건 위젯을 직접 클릭했을 때와 동일한
   효과를 내는, 훨씬 확실한 방법이다. (버튼 클릭 시 페이지가 한 번
   새로고침되며 그 언어로 반영된다) */
function setCookie(name, value, path) {
  document.cookie = `${name}=${value}; path=${path || "/"}`;
}
function clearCookie(name) {
  const expired = "Thu, 01 Jan 1970 00:00:00 UTC";
  document.cookie = `${name}=; expires=${expired}; path=/;`;
  document.cookie = `${name}=; expires=${expired}; path=/; domain=${location.hostname};`;
}

function setGoogleTranslateLanguage(lang) {
  if (lang === "ko") {
    // 원문(한국어)으로 되돌리기: 번역 쿠키를 지우고 새로고침
    clearCookie("googtrans");
  } else {
    // 구글이 실제로 쓰는 쿠키 형식: /{원문언어}/{번역할언어}
    clearCookie("googtrans");
    setCookie("googtrans", `/ko/${lang}`);
  }
  location.reload();
}

// 페이지가 새로고침된 뒤에도 방금 선택했던 언어에 맞는 버튼이
// active 상태로 표시되도록, 현재 googtrans 쿠키를 읽어 초기 상태를 맞춘다.
function syncActiveLangButtonFromCookie() {
  const match = document.cookie.match(/googtrans=\/[^/]*\/([a-zA-Z-]+)/);
  const current = match ? match[1] : "ko";
  document.querySelectorAll(".lang-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.lang === current);
  });
}
syncActiveLangButtonFromCookie();

document.querySelectorAll(".lang-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    setGoogleTranslateLanguage(btn.dataset.lang);
  });
});

/* ---------------- 패밀리사이트 드롭다운 ---------------- */
const familySiteSelect = document.getElementById("familySiteSelect");
if (familySiteSelect) {
  familySiteSelect.addEventListener("change", () => {
    const url = familySiteSelect.value;
    if (url) {
      // 항상 새 탭으로만 열기 — 현재 통제실 화면은 그대로 유지되도록
      // (팝업이 차단되더라도 현재 탭을 대체하지 않음)
      window.open(url, "_blank", "noopener");
    }
    familySiteSelect.selectedIndex = 0; // 선택 후 다시 "패밀리사이트 ▾" 표시로 복귀
  });
}

/* ---------------- 공휴일 달력 위젯 (이라크 · 한국) ----------------
   출처: 대한민국 - 공식 공휴일에 관한 법률/law.go.kr 기준 공표 일정(2026),
         이라크 - 이라크 정부 발표 및 각국 공휴일 데이터 서비스 종합(2026).
   이슬람력 기반 공휴일(이드 알피트르, 이드 알아드하, 이슬람 신년, 아슈라,
   마울리드 등)은 실제 초승달 관측에 따라 발표 시점에 ±1일 조정될 수 있음. */
const KR_HOLIDAYS_2026 = {
  "2026-01-01": "신정",
  "2026-02-16": "설날 연휴",
  "2026-02-17": "설날",
  "2026-02-18": "설날 연휴",
  "2026-03-01": "삼일절",
  "2026-03-02": "삼일절 대체공휴일",
  "2026-05-01": "근로자의 날",
  "2026-05-05": "어린이날",
  "2026-05-24": "부처님오신날",
  "2026-05-25": "부처님오신날 대체공휴일",
  "2026-06-06": "현충일",
  "2026-07-17": "제헌절",
  "2026-08-15": "광복절",
  "2026-08-17": "광복절 대체공휴일",
  "2026-09-24": "추석 연휴",
  "2026-09-25": "추석",
  "2026-09-26": "추석 연휴",
  "2026-10-03": "개천절",
  "2026-10-05": "개천절 대체공휴일",
  "2026-10-09": "한글날",
  "2026-12-25": "크리스마스",
};

const IQ_HOLIDAYS_2026 = {
  "2026-01-01": "New Year's Day",
  "2026-01-06": "Army Day",
  "2026-03-18": "Eid al-Fitr holiday",
  "2026-03-19": "Eid al-Fitr holiday",
  "2026-03-20": "Eid al-Fitr",
  "2026-03-21": "Nowruz",
  "2026-03-22": "Eid al-Fitr holiday",
  "2026-03-23": "Eid al-Fitr holiday",
  "2026-05-01": "Labour Day",
  "2026-05-26": "Eid al-Adha holiday",
  "2026-05-27": "Eid al-Adha",
  "2026-05-28": "Eid al-Adha holiday",
  "2026-05-29": "Eid al-Adha holiday",
  "2026-06-04": "Eid al-Ghadeer",
  "2026-06-16": "Islamic New Year",
  "2026-06-25": "Ashura",
  "2026-07-14": "Republic Day",
  "2026-08-25": "The Prophet's Birthday",
  "2026-10-03": "Iraqi National Day",
  "2026-12-10": "Victory Day",
  "2026-12-25": "Christmas Day",
};

/* ---------------- 달력용 일별 날씨 아이콘 (Open-Meteo weathercode) ---------------- */
let CALENDAR_DAILY_FORECAST = {}; // { "YYYY-MM-DD": { code, tmax, tmin } }
let refreshHolidayCalendarWeather = null; // 아래 IIFE 안에서 실제 렌더 함수로 채워짐

function weatherCodeToIcon(code) {
  if (code === 0) return "☀️";
  if (code === 1 || code === 2) return "⛅";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if ([51, 53, 55, 56, 57, 80, 81, 82].includes(code)) return "🌦️";
  if ([61, 63, 65, 66, 67].includes(code)) return "🌧️";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "❄️";
  if ([95, 96, 99].includes(code)) return "⛈️";
  return "";
}

function storeDailyForecastForCalendar(daily) {
  if (!daily || !daily.time) return;
  CALENDAR_DAILY_FORECAST = {};
  daily.time.forEach((dateStr, i) => {
    CALENDAR_DAILY_FORECAST[dateStr] = {
      code: daily.weathercode ? daily.weathercode[i] : null,
      tmax: daily.temperature_2m_max ? daily.temperature_2m_max[i] : null,
      tmin: daily.temperature_2m_min ? daily.temperature_2m_min[i] : null,
    };
  });
  if (typeof refreshHolidayCalendarWeather === "function") refreshHolidayCalendarWeather();
}

(function initHolidayWidget() {
  const panel = document.getElementById("holidayPanel");
  const monthLabel = document.getElementById("holidayMonthLabel");
  const grid = document.getElementById("holidayGrid");
  const list = document.getElementById("holidayList");
  const prevBtn = document.getElementById("holidayPrevBtn");
  const nextBtn = document.getElementById("holidayNextBtn");
  if (!panel || !grid) return;

  const nowBaghdad = new Date(); // 표시 기준은 오늘 날짜(로컬)
  let viewYear = nowBaghdad.getFullYear();
  let viewMonth = nowBaghdad.getMonth(); // 0-11

  function pad2(n) { return String(n).padStart(2, "0"); }
  function dateKey(y, m, d) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }

  function renderCalendar() {
    monthLabel.textContent = `${viewYear}년 ${viewMonth + 1}월`;
    grid.innerHTML = "";

    const firstDay = new Date(viewYear, viewMonth, 1).getDay(); // 0=일요일
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const todayKey = dateKey(nowBaghdad.getFullYear(), nowBaghdad.getMonth(), nowBaghdad.getDate());

    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement("div");
      empty.className = "holiday-cell is-empty";
      grid.appendChild(empty);
    }

    const monthEntries = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const key = dateKey(viewYear, viewMonth, d);
      const krName = KR_HOLIDAYS_2026[key];
      const iqName = IQ_HOLIDAYS_2026[key];

      const cell = document.createElement("div");
      cell.className = "holiday-cell";
      if (key === todayKey) cell.classList.add("is-today");
      if (krName || iqName) cell.classList.add("has-holiday");

      const num = document.createElement("span");
      num.textContent = String(d);
      cell.appendChild(num);

      const fc = CALENDAR_DAILY_FORECAST[key];
      if (fc && fc.code !== null && fc.code !== undefined) {
        const icon = document.createElement("span");
        icon.className = "holiday-weather-icon";
        icon.textContent = weatherCodeToIcon(fc.code);
        if (fc.tmax !== null && fc.tmax !== undefined) {
          icon.title = `최고 ${Math.round(fc.tmax)}° / 최저 ${Math.round(fc.tmin)}°`;
        }
        cell.appendChild(icon);

        if (fc.tmax !== null && fc.tmax !== undefined && fc.tmin !== null && fc.tmin !== undefined) {
          const temp = document.createElement("span");
          temp.className = "holiday-temp";
          temp.innerHTML = `<span class="holiday-temp-max">${Math.round(fc.tmax)}°</span>/<span class="holiday-temp-min">${Math.round(fc.tmin)}°</span>`;
          cell.appendChild(temp);
        }
      }

      if (krName || iqName) {
        const dots = document.createElement("span");
        dots.className = "holiday-dots";
        if (krName) {
          const dot = document.createElement("span");
          dot.className = "holiday-dot holiday-dot-kr";
          dots.appendChild(dot);
        }
        if (iqName) {
          const dot = document.createElement("span");
          dot.className = "holiday-dot holiday-dot-iq";
          dots.appendChild(dot);
        }
        cell.appendChild(dots);
        const titleParts = [];
        if (krName) titleParts.push(`🇰🇷 ${krName}`);
        if (iqName) titleParts.push(`🇮🇶 ${iqName}`);
        cell.title = titleParts.join(" · ");
        monthEntries.push({ d, krName, iqName });
      }

      grid.appendChild(cell);
    }

    list.innerHTML = "";
    if (monthEntries.length === 0) {
      const li = document.createElement("li");
      li.className = "holiday-list-empty";
      li.textContent = "이번 달은 공휴일이 없습니다.";
      list.appendChild(li);
    } else {
      monthEntries.forEach(({ d, krName, iqName }) => {
        const li = document.createElement("li");
        const dateSpan = document.createElement("span");
        dateSpan.className = "holiday-list-date";
        dateSpan.textContent = `${pad2(viewMonth + 1)}/${pad2(d)}`;
        li.appendChild(dateSpan);
        const nameSpan = document.createElement("span");
        const names = [];
        if (krName) names.push(`🇰🇷 ${krName}`);
        if (iqName) names.push(`🇮🇶 ${iqName}`);
        nameSpan.textContent = names.join("  ·  ");
        li.appendChild(nameSpan);
        list.appendChild(li);
      });
    }
  }

  function openPanel() {
    renderCalendar();
    if (typeof alignSideWidgets === "function") alignSideWidgets();
  }

  prevBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    viewMonth -= 1;
    if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
    renderCalendar();
    if (typeof alignSideWidgets === "function") alignSideWidgets();
  });
  nextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    viewMonth += 1;
    if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
    renderCalendar();
    if (typeof alignSideWidgets === "function") alignSideWidgets();
  });

  // 항상 표시: 페이지 로드 시 바로 렌더링
  openPanel();

  // 날씨 데이터가 나중에 도착했을 때(비동기) 달력을 다시 그릴 수 있도록 외부에 노출
  refreshHolidayCalendarWeather = () => {
    renderCalendar();
    if (typeof alignSideWidgets === "function") alignSideWidgets();
  };
})();


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
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${BISMAYAH_LAT}&longitude=${BISMAYAH_LON}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,wind_direction_10m&hourly=precipitation_probability&daily=sunrise,sunset,weathercode,temperature_2m_max,temperature_2m_min&forecast_days=16&timezone=${encodeURIComponent(TIMEZONE)}`;
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
    updateAirQualityGrade("wPm10", a.pm10, PM10_GRADES);
    updateAirQualityGrade("wPm25", a.pm2_5, PM25_GRADES);
    updateAirQualityGrade("wOzone", a.ozone, OZONE_GRADES);
    updateUvIndex(a.uv_index);

    updateHeatStatus(c.temperature_2m, c.apparent_temperature);
    updateSunTimes(weather.daily);
    updateRainChance(weather.hourly);
    storeDailyForecastForCalendar(weather.daily);
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

// 어르신들도 바로 이해하실 수 있도록 한글 풍향 이름도 같이 표기
const WIND_COMPASS_KO = [
  "북풍", "북북동풍", "북동풍", "동북동풍", "동풍", "동남동풍", "남동풍", "남남동풍",
  "남풍", "남남서풍", "남서풍", "서남서풍", "서풍", "서북서풍", "북서풍", "북북서풍"
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
  if (label) {
    label.innerHTML =
      `<span class="wind-compass-deg">${WIND_COMPASS[idx]} (${Math.round(deg)}°)</span>` +
      `<span class="wind-compass-ko">${WIND_COMPASS_KO[idx]}</span>`;
  }
}

/* 국내 환경부 대기환경기준 등급 (24시간 평균 기준, ㎍/㎥) */
const PM10_GRADES = [
  { max: 30, label: "좋음", color: "var(--cyan)" },
  { max: 80, label: "보통", color: "var(--green)" },
  { max: 150, label: "나쁨", color: "var(--warn)" },
  { max: Infinity, label: "매우나쁨", color: "var(--danger)" },
];
const PM25_GRADES = [
  { max: 15, label: "좋음", color: "var(--cyan)" },
  { max: 35, label: "보통", color: "var(--green)" },
  { max: 75, label: "나쁨", color: "var(--warn)" },
  { max: Infinity, label: "매우나쁨", color: "var(--danger)" },
];
/* 오존(O3)은 환경부 기준이 ppm(0.030/0.090/0.150)으로 정의돼 있는데,
   오픈메테오는 µg/㎥로 값을 주기 때문에 표준 변환식(µg/㎥ = ppb × 48/24.45)으로
   환산한 값을 기준으로 사용한다. */
const OZONE_GRADES = [
  { max: 59, label: "좋음", color: "var(--cyan)" },
  { max: 177, label: "보통", color: "var(--green)" },
  { max: 295, label: "나쁨", color: "var(--warn)" },
  { max: Infinity, label: "매우나쁨", color: "var(--danger)" },
];

function updateAirQualityGrade(elementId, value, grades) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (value === undefined || value === null || isNaN(value)) {
    el.textContent = "–";
    el.style.color = "";
    return;
  }
  const grade = grades.find((g) => value <= g.max) || grades[grades.length - 1];
  el.textContent = `${value.toFixed(0)} (${grade.label})`;
  el.style.color = grade.color;
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

/* ---------------- 환율 (USD 기준 IQD · KRW) ---------------- */
async function loadExchangeRates() {
  const elUsdIqd = document.getElementById("fxUsdIqd");
  const elUsdIqdOfficial = document.getElementById("fxUsdIqdOfficial");
  const elUsdKrw = document.getElementById("fxUsdKrw");
  const elKrwJpy = document.getElementById("fxKrwJpy");
  const elKrwCny = document.getElementById("fxKrwCny");
  const elUpdated = document.getElementById("fxUpdated");
  if (!elUsdIqd) return;

  // KRW/JPY/CNY는 일반적인 실시간(중간시장) 환율 API로 충분히 정확하다.
  // IQD는 공식 고시환율과 실제 시장(암시장) 환율의 차이가 커서,
  // 시장환율은 market-fx.json(별도 GitHub Actions가 usdiqd.com에서 수집)에서 가져오고,
  // 실패 시에만 공식 환율 API 값으로 대체한다.
  let krw = null, jpy = null, cny = null, officialIqd = null;
  try {
    const res = await fetch("https://api.exchangerate.fun/latest?base=USD");
    if (!res.ok) throw new Error("환율 API 응답 오류");
    const data = await res.json();
    krw = data.rates && data.rates.KRW;
    jpy = data.rates && data.rates.JPY;
    cny = data.rates && data.rates.CNY;
    officialIqd = data.rates && data.rates.IQD;
  } catch (err) {
    console.error(err);
  }

  let marketIqd = null;
  try {
    const res = await fetch("market-fx.json", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      marketIqd = data.usdIqdParallel || null;
      if (data.usdIqdOfficial) officialIqd = data.usdIqdOfficial; // 같은 출처 값이 있으면 그쪽을 우선
    }
  } catch (err) {
    console.error(err);
  }

  if (!krw) {
    elUpdated.textContent = "환율 정보를 불러올 수 없습니다";
    return;
  }

  if (officialIqd) {
    elUsdIqdOfficial.textContent = officialIqd.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
  }
  if (marketIqd) {
    elUsdIqd.textContent = marketIqd.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
  } else {
    elUsdIqd.textContent = "수집 전";
  }

  elUsdKrw.textContent = krw.toLocaleString("ko-KR", { maximumFractionDigits: 1 });

  // 1,000원 기준으로 환산해야 숫자가 너무 작아지지 않아 보기 편하다
  if (jpy) {
    // 네이버 환율처럼 그 나라 돈 기준으로 원화 환산 (엔화는 100엔 단위가 관례)
    const krwPer100Jpy = (krw / jpy) * 100;
    elKrwJpy.textContent = krwPer100Jpy.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + " 원";
  }
  if (cny) {
    const krwPer1Cny = krw / cny;
    elKrwCny.textContent = krwPer1Cny.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + " 원";
  }

  const now = new Date();
  const stamp = new Intl.DateTimeFormat("ko-KR", { timeZone: TIMEZONE, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(now);
  elUpdated.textContent = marketIqd
    ? `갱신: ${stamp} (바그다드) · 시장환율은 usdiqd.com 기준`
    : `갱신: ${stamp} (바그다드) · 시장환율 수집 전`;
}
loadExchangeRates();
setInterval(loadExchangeRates, 10 * 60 * 1000); // 10분마다 갱신

/* ---------------- 우측 여백 위젯(공휴일 달력 · 환율) 정렬 ----------------
   .grid(대시보드 카드 영역)의 실제 오른쪽 끝 좌표를 측정해서, 그 옆
   여백에 정확히 붙인다. 화면 폭에 따른 계산식으로 추측하지 않고
   실측하기 때문에 카드 위에 겹치는 일이 없다.
   여백이 위젯 하나 들어갈 만큼도 없는 좁은 화면에서는 위젯을 숨긴다
   (768px 미만은 CSS 미디어쿼리가 별도로 처리). */
function alignSideWidgets() {
  // 지금 보고 있는 탭의 카드 영역을 기준으로 잡는다.
  // (예전엔 항상 첫 번째 .grid(종합현황)를 기준으로 잡아서, 다른 탭에서 화면을
  //  확대·축소하면 숨겨진 종합현황 탭의 좌표(0)를 읽어 달력이 왼쪽으로 튀던 버그가 있었음)
  const gridEl = document.querySelector(".view.active .grid") || document.querySelector(".grid");
  const holidayPanel = document.getElementById("holidayPanel");
  const fxWidget = document.getElementById("fxWidget");
  if (!gridEl) return;
  // 탭 전환 직후처럼 아직 화면에 그려지지 않은 상태면 계산하지 않는다
  if (gridEl.getBoundingClientRect().width === 0) return;

  if (window.innerWidth <= 768) {
    // 좁은 화면: JS로 강제 설정한 left 값을 지워서 CSS 미디어쿼리가 그대로 적용되게 둔다
    if (holidayPanel) holidayPanel.style.left = "";
    if (fxWidget) fxWidget.style.left = "";
    if (fxWidget) fxWidget.style.display = "";
    const rightGroupMobile = document.getElementById("tabbarRightGroup");
    if (rightGroupMobile) {
      rightGroupMobile.style.position = "static";
      rightGroupMobile.style.left = "";
      rightGroupMobile.style.top = "";
      rightGroupMobile.style.marginLeft = "auto";
    }
    return;
  }

  // .grid 컨테이너 자체의 경계가 아니라, 실제 카드(패널)들의 경계를 기준으로 잡는다.
  // (.grid에는 좌우 padding(32px)이 있어서 컨테이너 기준으로 재면 카드 테두리보다
  //  32px 더 바깥쪽이 기준점이 되어 버려, 카드-카드 간격보다 카드-달력 간격이
  //  더 벌어져 보이는 버그가 있었다)
  const panels = gridEl.querySelectorAll(".panel");
  let gridRight = gridEl.getBoundingClientRect().right;
  let gridLeft = gridEl.getBoundingClientRect().left;
  if (panels.length) {
    const rects = Array.from(panels).map((p) => p.getBoundingClientRect());
    gridRight = Math.max(...rects.map((r) => r.right));
    gridLeft = Math.min(...rects.map((r) => r.left));
  }
  const gap = 20;
  const scrollX = window.scrollX || window.pageXOffset || 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;

  // 달력은 grid 컨테이너 자체가 아니라, 실제 카드(첫 패널)의 위쪽 끝과 높이를 맞춘다
  // (grid에는 위쪽 padding이 있어서 컨테이너 기준으로 맞추면 그만큼 더 위에 위치하게 됨)
  // position:absolute라 문서 좌표(스크롤 오프셋 포함)로 넣어야 페이지와 같이 스크롤된다.
  const firstPanel = gridEl.querySelector(".panel");
  if (holidayPanel && firstPanel) {
    holidayPanel.style.top = `${Math.round(firstPanel.getBoundingClientRect().top + scrollY)}px`;
  }

  // 좌우 여백이 완전히 같아지도록 달력 폭을 계산: (뷰포트 폭) - (카드 오른쪽 끝 + 간격) - (왼쪽 여백)
  // 예전엔 460px 상한을 둬서 화면이 넓을 때 오른쪽 여백이 왼쪽보다 남아버리는 문제가 있었음 —
  // 좌우 여백을 정확히 맞추는 게 우선이므로 상한은 넉넉하게 풀어둔다.
  const left = gridRight + gap;
  const minWidth = 220;
  const maxWidth = 900; // 지나치게 넓어지는 것만 막는 넉넉한 상한
  let calendarWidth = window.innerWidth - left - gridLeft;
  calendarWidth = Math.max(minWidth, Math.min(maxWidth, calendarWidth));

  const fitsOnScreen = left + calendarWidth <= window.innerWidth - 8;

  [holidayPanel, fxWidget].forEach((el) => {
    if (!el) return;

    if (fitsOnScreen) {
      el.style.left = `${Math.round(left + scrollX)}px`;
      el.style.width = `${Math.round(calendarWidth)}px`;
      el.style.display = "";
    } else {
      // 여백이 위젯 하나 들어갈 만큼도 없으면 겹치지 않도록 숨긴다
      el.style.display = "none";
    }
  });

  // 환율 위젯은 "화면 하단에서 20px" 고정이 아니라, 달력 패널 바로 아래에
  // 오도록 실제 달력 높이를 측정해서 위치를 계산한다.
  // (달력에 표시되는 공휴일 개수·아이콘 등에 따라 높이가 달마다 달라지므로
  // 매번 다시 측정해야 겹치지 않는다)
  if (fitsOnScreen && holidayPanel && fxWidget && holidayPanel.style.display !== "none") {
    const holidayBottom = holidayPanel.getBoundingClientRect().bottom + scrollY;
    fxWidget.style.bottom = "auto";
    fxWidget.style.top = `${Math.round(holidayBottom + gap)}px`;
  }

  // 언어 선택 + 패밀리사이트 그룹: 탭 바 자체의 오른쪽 끝이 아니라
  // 달력의 오른쪽 끝에 맞춰서 정렬한다 (달력이 탭 바보다 더 오른쪽까지 있으므로).
  const rightGroup = document.getElementById("tabbarRightGroup");
  const tabBarEl = document.querySelector(".tab-bar");
  if (rightGroup && tabBarEl) {
    if (fitsOnScreen) {
      const calendarRight = left + calendarWidth; // 달력의 실제 오른쪽 끝(뷰포트 기준)
      const groupWidth = rightGroup.offsetWidth || 0;
      const tabBarRect = tabBarEl.getBoundingClientRect();
      const tabBarCenterY = tabBarRect.top + tabBarRect.height / 2;
      const groupHeight = rightGroup.offsetHeight || 0;
      rightGroup.style.left = `${Math.round(calendarRight - groupWidth + scrollX)}px`;
      rightGroup.style.top = `${Math.round(tabBarCenterY - groupHeight / 2 + scrollY)}px`;
      rightGroup.style.display = "";
    } else {
      // 달력 자체가 안 뜨는 좁은 화면에서는 탭 바 안의 원래 자리로 되돌린다
      rightGroup.style.left = "";
      rightGroup.style.top = "";
      rightGroup.style.position = "static";
      rightGroup.style.marginLeft = "auto";
    }
  }
}

window.addEventListener("load", alignSideWidgets);
window.addEventListener("resize", alignSideWidgets);
// 구글 위젯/번역 등으로 레이아웃이 뒤늦게 흔들리는 경우를 대비해 재계산
setTimeout(alignSideWidgets, 600);
setTimeout(alignSideWidgets, 1500);
alignSideWidgets();


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

    // 탭마다 카드 영역 크기가 달라서 달력·환율 위치를 다시 맞춘다
    if (typeof alignSideWidgets === "function") {
      requestAnimationFrame(alignSideWidgets);
    }
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

/* ---------------- 국내 뉴스 (의학 · 질병 · 사고) ---------------- */
async function loadDomesticNews() {
  const list = document.getElementById("domesticNewsList");
  try {
    const res = await fetch("domestic-news.json", { cache: "no-store" });
    if (!res.ok) throw new Error("domestic-news.json 로드 실패");
    const data = await res.json();
    renderDomesticNews(data.items, data.generatedAt);
  } catch (err) {
    console.error(err);
    list.innerHTML = `<li class="embassy-row skeleton">아직 domestic-news.json이 없거나 불러올 수 없습니다. GitHub Actions가 최초 1회 실행된 후 표시됩니다.</li>`;
  }
}

function renderDomesticNews(items, generatedAt) {
  const list = document.getElementById("domesticNewsList");
  if (!items || !items.length) {
    list.innerHTML = `<li class="embassy-row skeleton">최근 수집된 뉴스가 없습니다.</li>`;
    return;
  }
  list.innerHTML = items.map(n => `
    <li class="embassy-row">
      <div class="notice-top">
        <span class="notice-title">${escapeHtml(n.title)}</span>
        <span class="notice-date">${escapeHtml((n.date || "").slice(0, 10))}</span>
      </div>
      <div class="notice-body">${escapeHtml(n.summary || n.source || "")}</div>
      ${n.link ? `<a class="embassy-link" href="${n.link}" target="_blank" rel="noopener noreferrer">기사 원문 보기 ↗</a>` : ""}
    </li>
  `).join("");

  if (generatedAt) {
    const dt = new Date(generatedAt);
    document.getElementById("domesticNewsMeta").textContent =
      "Google 뉴스 검색 연동 · 마지막 수집: " +
      new Intl.DateTimeFormat("ko-KR", { timeZone: TIMEZONE, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(dt);
  }
}

loadDomesticNews();

/* ---------------- 질병관리청 · 보건복지부 소식 ---------------- */
async function loadHealthAuthorityNews() {
  const list = document.getElementById("healthAuthorityNewsList");
  try {
    const res = await fetch("health-authority-news.json", { cache: "no-store" });
    if (!res.ok) throw new Error("health-authority-news.json 로드 실패");
    const data = await res.json();
    renderHealthAuthorityNews(data.items, data.generatedAt);
  } catch (err) {
    console.error(err);
    list.innerHTML = `<li class="embassy-row skeleton">아직 health-authority-news.json이 없거나 불러올 수 없습니다. GitHub Actions가 최초 1회 실행된 후 표시됩니다.</li>`;
  }
}

function renderHealthAuthorityNews(items, generatedAt) {
  const list = document.getElementById("healthAuthorityNewsList");
  if (!items || !items.length) {
    list.innerHTML = `<li class="embassy-row skeleton">최근 수집된 소식이 없습니다.</li>`;
    return;
  }
  list.innerHTML = items.map(n => `
    <li class="embassy-row">
      <div class="notice-top">
        <span class="notice-title">${n.agency ? `[${escapeHtml(n.agency)}] ` : ""}${escapeHtml(n.title)}</span>
        <span class="notice-date">${escapeHtml((n.date || "").slice(0, 10))}</span>
      </div>
      ${n.source ? `<div class="notice-body">${escapeHtml(n.source)}</div>` : ""}
      ${n.link ? `<a class="embassy-link" href="${n.link}" target="_blank" rel="noopener noreferrer">원문 보기 ↗</a>` : ""}
    </li>
  `).join("");

  if (generatedAt) {
    const dt = new Date(generatedAt);
    document.getElementById("healthAuthorityNewsMeta").textContent =
      "질병관리청·보건복지부 공식 도메인 검색 연동 · 마지막 수집: " +
      new Intl.DateTimeFormat("ko-KR", { timeZone: TIMEZONE, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(dt);
  }
}

loadHealthAuthorityNews();

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
    await wzLoadSheet(data);
    renderWorkZones(data);
  } catch (err) {
    console.error(err);
    wrap.innerHTML = `<p class="skeleton">work-zones.json을 불러올 수 없습니다. (${err.message})</p>`;
  }
}

/* ---------------- 구글 시트(작업일정) 연동 ---------------- */
// 팀·파트 구성과 색. 시트의 '팀'이 비어 있어도 '파트'로 팀을 알아낸다.
const WZ_TEAMS = {
  "공사팀": { color: "#f2a93b", parts: ["플랜트", "건축", "토목", "조경", "기계", "전기", "수처리시설"] },
  "관리재경팀": { color: "#35d0c0", parts: ["유지보수"] },
};
const WZ_PART_COLORS = {
  "플랜트": "#ff7e79", "건축": "#f2a93b", "토목": "#c9a26b", "조경": "#5fd68f", "기계": "#4fb4ff",
  "전기": "#ffd166", "수처리시설": "#7fc8f8", "유지보수": "#35d0c0",
};
const WZ_RISK_WORDS = ["고소", "중량물", "화기", "밀폐", "굴착", "전기", "해체", "크레인", "야간"];

let wzItems = null;        // 시트에서 읽은 작업 목록 (null = 시트 미연결)
let wzSheetError = "";
let wzTeam = "all", wzPart = null, wzWeekOffset = 0;

function wzParseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function wzParseDate(v) {
  v = (v || "").trim();
  let m = v.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // 미국식 월/일/연도
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

function wzBaghdadToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function wzAddDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function wzWeekDates(offset) {
  const today = wzBaghdadToday();
  const dow = (new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7; // 월=0
  const monday = wzAddDays(today, -dow + offset * 7);
  return WZ_DAY_ORDER.map((_, i) => wzAddDays(monday, i));
}

// 구역별 작업 위치 목록: work-zones.json 의 places + '위치목록' 시트(placesCsvUrl)
let wzPlaces = {};
let wzSelDate = null; // 지도에 표시할 날짜 (null = 오늘)

async function wzLoadPlaces(data) {
  wzPlaces = {};
  (data.zones || []).forEach((z) => {
    wzPlaces[z.name] = (z.places || []).map((p) => ({ name: p.name, x: Number(p.x), y: Number(p.y) }));
  });
  const url = (data.placesCsvUrl || "").trim();
  if (!url) return;
  try {
    const res = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("응답 " + res.status);
    const rows = wzParseCsv(await res.text());
    const head = (rows[0] || []).map((h) => h.replace(/\s|\(.*?\)/g, "").toUpperCase());
    const ci = (...n) => head.findIndex((h) => n.some((x) => h.startsWith(x)));
    const cz = ci("구역"), cn = ci("위치이름", "위치", "이름"), cx = ci("X"), cy = ci("Y");
    rows.slice(1).forEach((r) => {
      const zone = (r[cz] || "").trim(), name = (r[cn] || "").trim();
      const x = parseFloat(r[cx]), y = parseFloat(r[cy]);
      if (!zone || !name || !isFinite(x) || !isFinite(y)) return;
      const z = (data.zones || []).find((zz) => zz.name === zone || zz.category === zone);
      const key = z ? z.name : zone;
      (wzPlaces[key] = wzPlaces[key] || []).push({ name, x, y });
    });
  } catch (err) {
    console.error("위치목록 시트 불러오기 실패:", err);
  }
}

// 작업의 세부위치 글자 안에 등록된 위치 이름이 들어 있으면 그 좌표 (가장 긴 이름 우선)
function wzFindPlace(zone, it) {
  const list = wzPlaces[zone.name] || [];
  const text = ((it.loc || "") + " " + (it.work || "")).replace(/\s+/g, "");
  let best = null;
  list.forEach((p) => {
    const n = p.name.replace(/\s+/g, "");
    if (n && text.includes(n) && (!best || n.length > best.name.replace(/\s+/g, "").length)) best = p;
  });
  return best;
}

let wzConfig = {};

async function wzFetchRows(data) {
  const script = (data.appsScriptUrl || "").trim();
  if (script) {
    try {
      const res = await fetch(script + (script.includes("?") ? "&" : "?") + "t=" + Date.now());
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Apps Script 오류");
      return j.rows;
    } catch (err) {
      console.error("Apps Script 읽기 실패, 웹 게시 CSV로 대신 읽습니다:", err);
    }
  }
  const url = (data.sheetCsvUrl || "").trim();
  if (!url) return null;
  const res = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error("응답 " + res.status);
  return wzParseCsv(await res.text());
}

async function wzLoadSheet(data) {
  wzConfig = data;
  await wzLoadPlaces(data);
  if (!(data.sheetCsvUrl || "").trim() && !(data.appsScriptUrl || "").trim()) { wzItems = null; return; }
  try {
    const rows = await wzFetchRows(data);
    if (!rows) { wzItems = null; return; }
    if (!rows.length) { wzItems = []; return; }
    const head = rows[0].map((h) => h.replace(/\s|\(.*?\)/g, ""));
    const col = (...names) => head.findIndex((h) => names.some((n) => h.startsWith(n)));
    const c = {
      date: col("날짜", "일자"), day: col("요일"), zone: col("구역"), team: col("팀"), part: col("파트"),
      work: col("작업내용", "작업"), loc: col("세부위치", "위치"), risk: col("위험작업", "위험"),
      person: col("담당"), note: col("비고"), xy: col("좌표"),
    };
    const get = (r, i) => (i >= 0 && r[i] ? r[i].trim() : "");
    wzItems = rows.slice(1).map((r, idx) => {
      const part = get(r, c.part);
      let team = get(r, c.team);
      if (!team) team = Object.keys(WZ_TEAMS).find((t) => WZ_TEAMS[t].parts.includes(part)) || "";
      const date = wzParseDate(get(r, c.date));
      let day = get(r, c.day).replace("요일", "");
      if (date) day = WZ_DAY_ORDER[(new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7];
      const riskText = get(r, c.risk);
      const risks = riskText ? riskText.split(/[,/·\s]+/).map((x) => x.trim()).filter(Boolean) : [];
      const xyM = get(r, c.xy).match(/([\d.]+)\s*[,\s]\s*([\d.]+)/);
      const xy = xyM ? { x: parseFloat(xyM[1]), y: parseFloat(xyM[2]) } : null;
      return { date, day, zone: get(r, c.zone), team, part, work: get(r, c.work), loc: get(r, c.loc), risks,
               person: get(r, c.person), note: get(r, c.note), xy, row: idx + 2 };
    }).filter((it) => it.work && (it.date || WZ_DAY_ORDER.includes(it.day)));
    wzSheetError = "";
  } catch (err) {
    console.error("작업일정 시트 불러오기 실패:", err);
    wzItems = null;
    wzSheetError = err.message;
  }
}

// 현재 구역·주간에 해당하는 작업 (날짜 없이 요일만 적힌 작업은 매주 반복)
function wzItemsFor(zone, dates) {
  if (!wzItems) return [];
  const zoneNames = [zone.name, zone.category].filter(Boolean);
  return wzItems.filter((it) => (!it.zone || zoneNames.includes(it.zone) || it.zone === "전체")
    && (it.date ? dates.includes(it.date) : true));
}

function wzPassFilter(it) {
  if (wzTeam !== "all" && it.team !== wzTeam) return false;
  if (wzPart && it.part !== wzPart) return false;
  return true;
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
    <div class="wz-filter-bar" id="wzFilterBar"></div>
    <div class="wz-layout">
      <div class="wz-map-col">
        <div class="wz-viewport" id="wzViewport">
          <div class="wz-zoombox" id="wzZoombox">
            <img src="" alt="구역 사진" class="workzone-bg" id="wzBgImg"
                 onerror="this.style.display='none'; document.getElementById('workzoneMapFallback').style.display='flex';">
            <div id="workzoneMapFallback" class="workzone-fallback" style="display:none;"></div>
            <div class="wz-pins" id="wzPins"></div>
          </div>
          <div class="wz-map-day" id="wzMapDay"></div>
          <div class="wz-pick-box" id="wzPickBox" hidden></div>
        </div>
        <div class="wz-zoom-controls">
          <button type="button" id="wzZoomOut" class="wz-zoom-btn">−</button>
          <button type="button" id="wzZoomReset" class="wz-zoom-btn">초기화</button>
          <button type="button" id="wzZoomIn" class="wz-zoom-btn">+</button>
          <span class="wz-zoom-hint">마우스 휠로 확대/축소 · 드래그로 이동</span>
          <button type="button" id="wzPickToggle" class="wz-pick-toggle" title="지도를 클릭해 그 자리에 작업을 추가합니다" hidden>➕ 지도에 작업 추가</button>
        </div>
        <div class="wz-unplaced" id="wzUnplaced"></div>
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

  wzSetupPickMode();
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
  const catClass = WZ_CATEGORY_CLASS[zone.category] || "";
  const header = `
    <div class="wz-schedule-header">
      <span class="wz-schedule-cat-badge ${catClass}">${wzEscapeHtml(zone.category || "")}</span>
      <span class="wz-schedule-title">${wzEscapeHtml(zone.name)}</span>
    </div>`;

  // 시트가 연결되지 않았으면 예전처럼 work-zones.json 의 요일별 한 줄 일정
  if (!wzItems) {
    const scheduleMap = {};
    (zone.schedule || []).forEach(s => { scheduleMap[s.day] = s.work; });
    const rows = WZ_DAY_ORDER.map(day => {
      const work = scheduleMap[day] || "";
      return `
      <div class="wz-day-row ${work ? "" : "wz-day-empty"}">
        <span class="wz-day-label">${wzEscapeHtml(day)}</span>
        <span class="wz-day-work">${work ? wzEscapeHtml(work) : "—"}</span>
      </div>`;
    }).join("");
    col.innerHTML = header + `<div class="wz-day-list">${rows}</div>` +
      `<p class="wz-sheet-note">${wzSheetError ? "⚠ 작업일정 시트를 불러오지 못했습니다 (" + wzEscapeHtml(wzSheetError) + ")" : "작업일정 구글 시트 연결 전입니다"}</p>`;
    document.getElementById("wzFilterBar").innerHTML = "";
    wzRenderPins(zone, [], "");
    return;
  }

  const dates = wzWeekDates(wzWeekOffset);
  const today = wzBaghdadToday();
  const weekItems = wzItemsFor(zone, dates);

  // 필터 칩 (팀 → 파트, 건수 표시)
  const bar = document.getElementById("wzFilterBar");
  const cnt = (f) => weekItems.filter(f).length;
  const teamChips = [["all", "전체", "#8996a6"], ...Object.entries(WZ_TEAMS).map(([t, v]) => [t, t, v.color])]
    .map(([key, label, color]) => `<button type="button" class="wz-chip ${wzTeam === key ? "active" : ""}" data-team="${wzEscapeHtml(key)}" style="--c:${color}">
      ${wzEscapeHtml(label)} <span>${key === "all" ? weekItems.length : cnt((it) => it.team === key)}</span></button>`).join("");
  const partList = wzTeam === "all" ? Object.values(WZ_TEAMS).flatMap((v) => v.parts) : (WZ_TEAMS[wzTeam] || { parts: [] }).parts;
  const partChips = partList.map((p) => `<button type="button" class="wz-chip wz-chip-part ${wzPart === p ? "active" : ""}" data-part="${wzEscapeHtml(p)}" style="--c:${WZ_PART_COLORS[p] || "#8996a6"}">
      <i></i>${wzEscapeHtml(p)} <span>${cnt((it) => it.part === p)}</span></button>`).join("");
  const todayItems = weekItems.filter((it) => (it.date ? it.date === today : it.day === WZ_DAY_ORDER[(new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7]));
  const todayRisk = todayItems.filter((it) => it.risks.length).length;
  const inWeek = dates.includes(today);
  bar.innerHTML = `
    <div class="wz-summary">${inWeek ? `오늘 작업 <b>${todayItems.length}</b>건 · ${Object.keys(WZ_TEAMS).map((t) => `${t} ${todayItems.filter((it) => it.team === t).length}`).join(" · ")}
      ${todayRisk ? `· <span class="wz-risk-sum">⚠ 위험작업 ${todayRisk}건</span>` : ""}` : "다른 주를 보고 있습니다"}</div>
    <div class="wz-chips">${teamChips}</div>
    <div class="wz-chips">${partChips}</div>`;
  bar.querySelectorAll("[data-team]").forEach((b) => b.onclick = () => { wzTeam = b.dataset.team; wzPart = null; wzShowSchedule(zone); });
  bar.querySelectorAll("[data-part]").forEach((b) => b.onclick = () => { wzPart = wzPart === b.dataset.part ? null : b.dataset.part; wzShowSchedule(zone); });

  const fmt = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
  const rows = WZ_DAY_ORDER.map((day, i) => {
    const iso = dates[i];
    const list = weekItems.filter((it) => (it.date ? it.date === iso : it.day === day)).filter(wzPassFilter);
    const items = list.map((it) => `
      <div class="wz-item" style="--c:${WZ_PART_COLORS[it.part] || "#8996a6"}">
        <span class="wz-part-badge">${wzEscapeHtml(it.part || it.team || "–")}</span>
        <div class="wz-item-body">
          <div class="wz-item-work">${wzEscapeHtml(it.work)}${it.date ? "" : ' <span class="wz-repeat">매주</span>'}</div>
          ${(it.loc || it.person || it.note) ? `<div class="wz-item-meta">${[it.loc && "📍 " + wzEscapeHtml(it.loc), it.person && "👷 " + wzEscapeHtml(it.person), it.note && wzEscapeHtml(it.note)].filter(Boolean).join(" · ")}</div>` : ""}
          ${it.risks.length ? `<div class="wz-risks">${it.risks.map((r) => `<span class="wz-risk">⚠ ${wzEscapeHtml(r)}</span>`).join("")}</div>` : ""}
        </div>
      </div>`).join("");
    return `
      <div class="wz-day-row wz-day-v2 ${list.length ? "" : "wz-day-empty"} ${iso === today ? "wz-today" : ""}">
        <span class="wz-day-label">${wzEscapeHtml(day)}<small>${fmt(iso)}</small></span>
        <div class="wz-day-items">${items || '<span class="wz-day-work">—</span>'}</div>
      </div>`;
  }).join("");

  col.innerHTML = header.replace("</div>", `
      <span class="wz-week-nav">
        <button type="button" data-w="-1" aria-label="이전 주">‹</button>
        <span>${fmt(dates[0])} ~ ${fmt(dates[6])}${wzWeekOffset === 0 ? " (이번 주)" : ""}</span>
        <button type="button" data-w="1" aria-label="다음 주">›</button>
      </span></div>`) + `<div class="wz-day-list">${rows}</div>`;
  col.querySelectorAll(".wz-week-nav button").forEach((b) => b.onclick = () => { wzWeekOffset += Number(b.dataset.w); wzSelDate = null; wzShowSchedule(zone); });

  // 지도에 표시할 날짜: 고른 날짜 → 오늘(이번 주면) → 그 주 월요일
  const sel = dates.includes(wzSelDate) ? wzSelDate : (dates.includes(today) ? today : dates[0]);
  col.querySelectorAll(".wz-day-v2").forEach((row, i) => {
    row.classList.toggle("wz-selected", dates[i] === sel);
    row.onclick = () => { wzSelDate = dates[i]; wzShowSchedule(zone); };
  });
  const selDay = WZ_DAY_ORDER[dates.indexOf(sel)];
  const dayItems = weekItems.filter((it) => (it.date ? it.date === sel : it.day === selDay)).filter(wzPassFilter);
  wzRenderPins(zone, dayItems, `${selDay} ${fmt(sel)}${sel === today ? " (오늘)" : ""}`);
}

function wzRenderPins(zone, items, dayLabel) {
  const layer = document.getElementById("wzPins");
  const label = document.getElementById("wzMapDay");
  const unplacedBox = document.getElementById("wzUnplaced");
  if (!layer) return;
  const groups = new Map(); // 같은 위치의 작업은 핀 하나로
  const unplaced = [];
  items.forEach((it) => {
    const p = it.xy ? { name: it.loc || "작업 위치", x: it.xy.x, y: it.xy.y } : wzFindPlace(zone, it);
    if (!p) { unplaced.push(it); return; }
    const key = it.xy ? `${Math.round(p.x)},${Math.round(p.y)}` : p.name; // 거의 같은 자리는 핀 하나로
    if (!groups.has(key)) groups.set(key, { place: p, items: [] });
    groups.get(key).items.push(it);
  });

  layer.innerHTML = [...groups.values()].map((g) => {
    const first = g.items[0];
    const color = WZ_PART_COLORS[first.part] || "#8996a6";
    const risky = g.items.some((it) => it.risks.length);
    const list = g.items.map((it) => `
      <div class="wz-pin-row"><b style="color:${WZ_PART_COLORS[it.part] || "#8996a6"}">${wzEscapeHtml(it.part)}</b> ${wzEscapeHtml(it.work)}
        ${it.risks.length ? `<span class="wz-pin-risk">⚠ ${it.risks.map(wzEscapeHtml).join(", ")}</span>` : ""}</div>`).join("");
    // 사진 위쪽 핀은 설명 카드를 아래로 펼쳐서 잘리지 않게
    return `<div class="wz-pin ${risky ? "wz-pin-risky" : ""} ${g.place.y < 40 ? "wz-pin-below" : ""}" style="left:${g.place.x}%;top:${g.place.y}%;--c:${color}">
      <div class="wz-pin-inner">
        <div class="wz-pin-card"><div class="wz-pin-title">📍 ${wzEscapeHtml(g.place.name)}</div>${list}</div>
        <span class="wz-pin-tag">${wzEscapeHtml(first.part)}${g.items.length > 1 ? ` +${g.items.length - 1}` : ""}</span>
        <span class="wz-pin-dot"></span>
      </div>
    </div>`;
  }).join("");
  // 핀을 눌러도 지도가 끌리지 않게
  layer.querySelectorAll(".wz-pin").forEach((el) => {
    el.addEventListener("mousedown", (e) => e.stopPropagation());
    el.addEventListener("click", (e) => { e.stopPropagation(); el.classList.toggle("open"); });
  });

  if (label) {
    label.innerHTML = `${wzEscapeHtml(dayLabel)} 작업 위치 <b>${groups.size}</b>곳` +
      (items.length ? "" : " · 작업 없음");
  }
  if (unplacedBox) {
    const canEdit = !!(wzConfig.appsScriptUrl || "").trim();
    unplacedBox.innerHTML = unplaced.length
      ? `<span class="wz-unplaced-title">지도에 위치가 없는 작업 ${unplaced.length}건</span> ` +
        unplaced.map((it, i) => canEdit
          ? `<button type="button" class="wz-unplaced-item wz-unplaced-btn" data-i="${i}">📍 ${wzEscapeHtml(it.part)} · ${wzEscapeHtml(it.work)}</button>`
          : `<span class="wz-unplaced-item">${wzEscapeHtml(it.part)} · ${wzEscapeHtml(it.work)}</span>`).join("") +
        `<span class="wz-unplaced-hint">${canEdit ? "작업을 누른 뒤 지도에서 위치를 클릭하면 바로 저장됩니다" : "시트의 '좌표' 칸이 비어 있는 작업입니다"}</span>`
      : "";
    unplacedBox.querySelectorAll(".wz-unplaced-btn").forEach((b) => b.onclick = () => wzStartPick({ mode: "setxy", item: unplaced[Number(b.dataset.i)] }));
  }
}

/* 지도 클릭으로 작업 추가 / 위치 찍기 (구글 시트 Apps Script 로 바로 저장) */
let wzPick = null; // { mode: 'add' } | { mode: 'setxy', item }

function wzStartPick(pick) {
  wzPick = pick;
  const zb = document.getElementById("wzZoombox");
  const btn = document.getElementById("wzPickToggle");
  const box = document.getElementById("wzPickBox");
  if (zb) zb.classList.toggle("wz-picking", !!pick);
  if (btn) btn.classList.toggle("active", pick && pick.mode === "add");
  if (!box) return;
  if (!pick) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = pick.mode === "add"
    ? `<div><b>지도에서 작업 위치를 클릭하세요</b></div><button type="button" class="wz-pick-cancel">취소</button>`
    : `<div><b>'${wzEscapeHtml(pick.item.work)}'</b> 위치를 지도에서 클릭하세요</div><button type="button" class="wz-pick-cancel">취소</button>`;
  box.querySelector(".wz-pick-cancel").onclick = () => wzStartPick(null);
}

function wzPasscode(reset) {
  if (reset) { try { localStorage.removeItem("wzPass"); } catch (e) {} }
  let pw = "";
  try { pw = localStorage.getItem("wzPass") || ""; } catch (e) {}
  if (!pw) {
    pw = prompt("작업일정 저장 암호를 입력하세요 (담당자에게 문의)") || "";
    if (pw) { try { localStorage.setItem("wzPass", pw); } catch (e) {} }
  }
  return pw;
}

async function wzCallScript(action, payload) {
  const url = wzConfig.appsScriptUrl.trim();
  const q = `action=${action}&payload=${encodeURIComponent(JSON.stringify(payload))}&t=${Date.now()}`;
  const res = await fetch(url + (url.includes("?") ? "&" : "?") + q);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "저장 실패");
  return j;
}

async function wzSaveAndRefresh(action, payload) {
  payload.passcode = wzPasscode(false);
  if (!payload.passcode) return false;
  try {
    await wzCallScript(action, payload);
  } catch (err) {
    if (/암호/.test(err.message)) wzPasscode(true);
    alert("저장하지 못했습니다: " + err.message);
    return false;
  }
  await wzLoadSheet(wzConfig);
  wzShowSchedule(wzZones[wzActiveIdx]);
  return true;
}

function wzShowAddForm(x, y) {
  const box = document.getElementById("wzPickBox");
  const zone = wzZones[wzActiveIdx];
  const today = wzBaghdadToday();
  const defDate = wzSelDate || today;
  const partOpts = Object.entries(WZ_TEAMS).map(([t, v]) =>
    `<optgroup label="${wzEscapeHtml(t)}">${v.parts.map((p) => `<option value="${wzEscapeHtml(p)}">${wzEscapeHtml(p)}</option>`).join("")}</optgroup>`).join("");
  box.hidden = false;
  box.innerHTML = `
    <div><b>${wzEscapeHtml(zone.name)}</b>에 작업 추가 <small>(X ${x}, Y ${y})</small></div>
    <input type="date" id="wzfDate" value="${defDate}">
    <select id="wzfPart">${partOpts}</select>
    <input type="text" id="wzfWork" placeholder="작업내용 (필수)">
    <input type="text" id="wzfLoc" placeholder="세부위치 (예: 식당동 옥상)">
    <div class="wz-risk-checks">${WZ_RISK_WORDS.map((r) => `<label><input type="checkbox" value="${r}">${r}</label>`).join("")}</div>
    <input type="text" id="wzfPerson" placeholder="담당자 (선택)">
    <div class="wz-pick-actions"><button type="button" id="wzfSave">저장</button><button type="button" class="wz-pick-cancel">취소</button></div>`;
  box.querySelector(".wz-pick-cancel").onclick = () => wzStartPick(null);
  document.getElementById("wzfWork").focus();
  document.getElementById("wzfSave").onclick = async () => {
    const work = document.getElementById("wzfWork").value.trim();
    if (!work) { document.getElementById("wzfWork").focus(); return; }
    const part = document.getElementById("wzfPart").value;
    const team = Object.keys(WZ_TEAMS).find((t) => WZ_TEAMS[t].parts.includes(part)) || "";
    const btn = document.getElementById("wzfSave");
    btn.disabled = true; btn.textContent = "저장 중…";
    const ok = await wzSaveAndRefresh("add", {
      date: document.getElementById("wzfDate").value, zone: zone.name, team, part, work,
      loc: document.getElementById("wzfLoc").value.trim(),
      risks: [...box.querySelectorAll(".wz-risk-checks input:checked")].map((c) => c.value),
      person: document.getElementById("wzfPerson").value.trim(), x, y,
    });
    if (ok) wzStartPick(null); else { btn.disabled = false; btn.textContent = "저장"; }
  };
}

function wzSetupPickMode() {
  const btn = document.getElementById("wzPickToggle");
  const zb = document.getElementById("wzZoombox");
  if (!btn || !zb) return;
  const canEdit = !!(wzConfig.appsScriptUrl || "").trim();
  btn.hidden = !canEdit;
  btn.onclick = () => wzStartPick(wzPick && wzPick.mode === "add" ? null : { mode: "add" });
  let downX = 0, downY = 0;
  zb.addEventListener("mousedown", (e) => { downX = e.clientX; downY = e.clientY; });
  zb.addEventListener("click", async (e) => {
    if (!wzPick || Math.hypot(e.clientX - downX, e.clientY - downY) > 4) return; // 끌기는 무시
    const r = zb.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 1000) / 10;
    const y = Math.round(((e.clientY - r.top) / r.height) * 1000) / 10;
    if (wzPick.mode === "add") {
      wzPick = { mode: "adding" };
      wzShowAddForm(x, y);
    } else if (wzPick.mode === "setxy") {
      const it = wzPick.item;
      const box = document.getElementById("wzPickBox");
      box.innerHTML = `<div>'${wzEscapeHtml(it.work)}' 위치 저장 중…</div>`;
      const ok = await wzSaveAndRefresh("setxy", { row: it.row, work: it.work, x, y });
      wzStartPick(null);
      if (!ok) box.hidden = true;
    }
  });
}

/* ---------------- 지도 확대/축소/이동 ---------------- */
function wzApplyTransform() {
  const box = document.getElementById("wzZoombox");
  if (!box) return;
  box.style.transform = `translate(${wzTx}px, ${wzTy}px) scale(${wzScale})`;
  box.style.setProperty("--inv", String(1 / wzScale));
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


/* ==========================================================
   선박 추적 (ships.json 기반, Leaflet 지도)
   ========================================================== */

let shipsMapInstance = null;
let shipsMarkerLayer = null;

let planesMarkerLayer = null;

function initShipsMap() {
  if (!shipsMapInstance) {
    shipsMapInstance = L.map("shipsMap").setView([27.0, 46.5], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 12,
    }).addTo(shipsMapInstance);
    shipsMarkerLayer = L.layerGroup().addTo(shipsMapInstance);
    planesMarkerLayer = L.layerGroup().addTo(shipsMapInstance);
  }
  setTimeout(() => shipsMapInstance.invalidateSize(), 100);
  // 선박은 아래 VesselFinder 지도에서 보여 주므로 여기서는 항공기만 불러온다
  loadPlanes();
  refreshVesselFinderOnce();
}

async function loadPlanes() {
  try {
    const res = await fetch("planes.json", { cache: "no-store" });
    if (!res.ok) throw new Error("planes.json 로드 실패");
    const data = await res.json();
    renderPlanes(data);
  } catch (err) {
    console.error(err);
  }
}

function renderPlanes(data) {
  if (!planesMarkerLayer) return;
  planesMarkerLayer.clearLayers();

  const planes = data.planes || [];
  planes.forEach(p => {
    const heading = p.heading || 0;
    const icon = L.divIcon({
      className: "plane-icon-wrap",
      html: `<div class="plane-icon" style="transform: rotate(${heading}deg);">✈</div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    const marker = L.marker([p.lat, p.lon], { icon }).addTo(planesMarkerLayer);

    const alt = (p.altitude !== undefined && p.altitude !== null) ? `${Math.round(p.altitude)} m` : "–";
    const speed = (p.speed !== undefined && p.speed !== null) ? `${(p.speed * 3.6).toFixed(0)} km/h` : "–";
    marker.bindPopup(`
      <b>${escapeHtml(p.callsign || p.icao24)}</b><br>
      ${p.type ? `기종: ${escapeHtml(p.type)}<br>` : ""}${p.originCountry ? `국가: ${escapeHtml(p.originCountry)}<br>` : ""}
      고도: ${escapeHtml(alt)} · 속도: ${escapeHtml(speed)}${p.source ? `<br><span style="opacity:.6">출처: ${escapeHtml(p.source)}</span>` : ""}
    `);
  });

  // 상단 안내문에 항공기 수도 같이 표기
  const meta = document.getElementById("shipsMeta");
  if (meta) {
    const genText = data.generatedAt
      ? " · 마지막 수집: " + new Intl.DateTimeFormat("ko-KR", { timeZone: TIMEZONE, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(data.generatedAt)) + " (바그다드)"
      : "";
    meta.textContent = `항공기 ${planes.length}대 표시 중${genText}`;
  }
}

function shipsUpdateCombinedMeta() {
  const meta = document.getElementById("shipsMeta");
  if (!meta) return;
  const shipCount = meta.dataset.shipCount || "–";
  const planeCount = meta.dataset.planeCount || "–";
  meta.textContent = `선박 ${shipCount}척 · 항공기 ${planeCount}대 표시 중`;
}

async function loadShips() {
  const meta = document.getElementById("shipsMeta");
  try {
    const res = await fetch("ships.json", { cache: "no-store" });
    if (!res.ok) throw new Error("ships.json 로드 실패");
    const data = await res.json();
    renderShips(data);
  } catch (err) {
    console.error(err);
    if (meta) meta.textContent = "선박 데이터를 불러올 수 없습니다.";
  }
}

function renderShips(data) {
  const meta = document.getElementById("shipsMeta");
  if (!shipsMarkerLayer) return;

  shipsMarkerLayer.clearLayers();

  const ships = data.ships || [];
  ships.forEach(s => {
    const marker = L.circleMarker([s.lat, s.lon], {
      radius: 6,
      color: "#35d0c0",
      fillColor: "#35d0c0",
      fillOpacity: 0.8,
      weight: 1.5,
    }).addTo(shipsMarkerLayer);

    const name = s.name && s.name.trim() ? s.name.trim() : `MMSI ${s.mmsi}`;
    const speed = (s.speed !== undefined && s.speed !== null) ? `${s.speed.toFixed(1)} knots` : "–";
    marker.bindPopup(`
      <b>${escapeHtml(name)}</b><br>
      MMSI: ${escapeHtml(String(s.mmsi))}<br>
      속도: ${escapeHtml(speed)}<br>
      갱신: ${escapeHtml(s.updatedAt || "–")}
    `);
  });

  if (meta) {
    meta.dataset.shipCount = ships.length;
    shipsUpdateCombinedMeta();
    const genText = data.generatedAt
      ? " · 마지막 수집: " + new Intl.DateTimeFormat("ko-KR", { timeZone: TIMEZONE, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(data.generatedAt))
      : "";
    meta.textContent += genText;
  }
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.dataset.view === "view-ships") {
      initShipsMap();
    }
  });
});


/* 선박 지도(VesselFinder)는 숨겨진 탭 안에서 처음 만들어지면 크기를 0으로
   잡는 경우가 있어서, 탭을 처음 열 때 한 번만 새로 불러와 크기를 맞춘다 */
let vesselFinderRefreshed = false;
function refreshVesselFinderOnce() {
  if (vesselFinderRefreshed) return;
  const frame = document.querySelector("#vesselFinderBox iframe");
  if (!frame) return;
  vesselFinderRefreshed = true;
  const src = frame.src;
  frame.src = "about:blank";
  setTimeout(() => { frame.src = src; }, 50);
}


/* ==========================================================
   이라크 화재 현황 (NASA FIRMS 위성 감지 · fires.json)
   배경 지도는 한글 지명을 쓰기 위해 타일 대신 iraq-map.json
   (Natural Earth 주 경계·주변국·강)을 직접 그린다.
   ========================================================== */

let fireMapInstance = null;
let fireLayer = null;

function fireFmtTime(iso) {
  if (!iso) return "–";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: TIMEZONE, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

function fireLabelIcon(text, cls) {
  return L.divIcon({
    className: "map-label-wrap",
    html: `<span class="${cls}">${escapeHtml(text)}</span>`,
    iconSize: [0, 0],
  });
}

async function initFireMap() {
  if (fireMapInstance) {
    setTimeout(() => fireMapInstance.invalidateSize(), 100);
    loadFires();
    return;
  }

  fireMapInstance = L.map("fireMap", {
    zoomSnap: 0.25,
    minZoom: 5,
    maxZoom: 11,
    attributionControl: true,
  });
  fireMapInstance.attributionControl.setPrefix(false);
  fireMapInstance.attributionControl.addAttribution("지도: Natural Earth · 화재: NASA FIRMS");
  fireMapInstance.fitBounds([[29.0, 38.8], [37.4, 48.6]]);
  fireMapInstance.setMaxBounds([[25.0, 33.0], [42.0, 55.0]]);

  // 라벨은 화재 점보다 위, 경계선은 화재 점보다 아래에 오도록 레이어 순서를 나눈다
  fireMapInstance.createPane("firePane").style.zIndex = 450;
  fireMapInstance.createPane("labelPane").style.zIndex = 500;
  fireMapInstance.getPane("labelPane").style.pointerEvents = "none";

  try {
    const res = await fetch("iraq-map.json", { cache: "force-cache" });
    if (!res.ok) throw new Error("iraq-map.json 로드 실패");
    const geo = await res.json();

    L.geoJSON({ type: "FeatureCollection", features: geo.countries || [] }, {
      style: { stroke: false, fillColor: "#1b232d", fillOpacity: 1 },
      interactive: false,
    }).addTo(fireMapInstance);

    L.geoJSON({ type: "FeatureCollection", features: geo.borders || [] }, {
      style: { color: "#4a5563", weight: 1 },
      interactive: false,
    }).addTo(fireMapInstance);

    L.geoJSON({ type: "FeatureCollection", features: geo.governorates || [] }, {
      style: { color: "#6b7a8c", weight: 1.2, fillColor: "#26313d", fillOpacity: 1 },
      interactive: false,
    }).addTo(fireMapInstance);

    L.geoJSON({ type: "FeatureCollection", features: geo.lakes || [] }, {
      style: { color: "#2c5d7c", weight: 1, fillColor: "#1d4a66", fillOpacity: 1 },
      interactive: false,
    }).addTo(fireMapInstance);

    L.geoJSON({ type: "FeatureCollection", features: geo.rivers || [] }, {
      style: { color: "#3a8fc4", weight: 1.6, opacity: 0.85 },
      interactive: false,
    }).addTo(fireMapInstance);

    (geo.governorates || []).forEach((f) => {
      const p = f.properties;
      L.marker([p.labelLat, p.labelLon], { icon: fireLabelIcon(p.ko, "gov-label"), pane: "labelPane", interactive: false })
        .addTo(fireMapInstance);
    });
    (geo.countries || []).forEach((f) => {
      const p = f.properties;
      L.marker([p.labelLat, p.labelLon], { icon: fireLabelIcon(p.ko, "country-label"), pane: "labelPane", interactive: false })
        .addTo(fireMapInstance);
    });
    [
      { t: "티그리스강", lat: 34.75, lon: 43.35 },
      { t: "유프라테스강", lat: 34.55, lon: 41.75 },
      { t: "페르시아만", lat: 29.2, lon: 49.4 },
    ].forEach((w) => {
      L.marker([w.lat, w.lon], { icon: fireLabelIcon(w.t, "water-label"), pane: "labelPane", interactive: false })
        .addTo(fireMapInstance);
    });
  } catch (err) {
    console.error(err);
  }

  // 비스마야 현장 + 반경 50km
  L.circle([BISMAYAH_LAT, BISMAYAH_LON], {
    radius: 50000, color: "#35d0c0", weight: 1.5, dashArray: "6 6", fill: true, fillOpacity: 0.05, interactive: false,
  }).addTo(fireMapInstance);
  L.marker([BISMAYAH_LAT, BISMAYAH_LON], {
    icon: L.divIcon({ className: "map-label-wrap", html: '<span class="site-star">★</span>', iconSize: [0, 0] }),
    pane: "labelPane",
    interactive: false,
  }).addTo(fireMapInstance);
  L.marker([BISMAYAH_LAT, BISMAYAH_LON], {
    icon: fireLabelIcon("비스마야 현장", "site-label"), pane: "labelPane", interactive: false,
  }).addTo(fireMapInstance);

  fireLayer = L.layerGroup().addTo(fireMapInstance);
  setTimeout(() => fireMapInstance.invalidateSize(), 100);
  loadFires();
}

async function loadFires() {
  const meta = document.getElementById("fireMeta");
  const alertBox = document.getElementById("fireAlert");
  try {
    const res = await fetch("fires.json", { cache: "no-store" });
    if (!res.ok) throw new Error("fires.json 로드 실패");
    const data = await res.json();
    renderFires(data);
  } catch (err) {
    console.error(err);
    if (meta) meta.textContent = "화재 데이터를 불러올 수 없습니다.";
    if (alertBox) { alertBox.className = "fire-alert"; alertBox.textContent = "화재 데이터를 불러올 수 없습니다."; }
  }
}

function renderFires(data) {
  const meta = document.getElementById("fireMeta");
  const alertBox = document.getElementById("fireAlert");

  if (!data.generatedAt) {
    if (meta) meta.textContent = "아직 수집된 데이터가 없습니다. (FIRMS_MAP_KEY 등록 후 Actions에서 첫 수집이 필요합니다)";
    if (alertBox) { alertBox.className = "fire-alert"; alertBox.textContent = "화재 데이터 수집 대기 중"; }
    return;
  }

  if (fireLayer) {
    fireLayer.clearLayers();
    const fires = (data.fires || []).slice().sort((a, b) => (a.persistent === b.persistent ? 0 : a.persistent ? -1 : 1));
    fires.forEach((f) => {
      const recent = f.hoursAgo <= 24;
      let color, opacity, radius;
      if (f.persistent) {
        color = "#8a94a3"; opacity = 0.45; radius = 3;
      } else {
        color = recent ? "#ff4d4f" : "#f2a93b";
        opacity = recent ? 0.9 : 0.7;
        radius = Math.max(4, Math.min(12, 3 + Math.sqrt(f.frp || 0)));
      }
      const m = L.circleMarker([f.lat, f.lon], {
        pane: "firePane", radius, color, weight: 1, fillColor: color, fillOpacity: opacity, opacity: Math.min(1, opacity + 0.1),
      }).addTo(fireLayer);
      const kind = f.persistent ? "상시 열원 (가스 플레어 추정)" : recent ? "신규 화재 (24시간 이내)" : "신규 화재 (24~48시간)";
      m.bindPopup(`
        <b>${escapeHtml(kind)}</b><br>
        감지: ${escapeHtml(fireFmtTime(f.time))} (바그다드) · 약 ${escapeHtml(String(Math.round(f.hoursAgo)))}시간 전<br>
        강도(FRP): ${escapeHtml(String(f.frp))} MW<br>
        현장까지: ${escapeHtml(String(f.distanceKm))} km<br>
        <span style="opacity:.6">${escapeHtml(f.sensor)} 위성 감지 · 신뢰도 ${escapeHtml(String(f.confidence || "–"))}</span>
      `);
    });
  }

  if (meta) {
    meta.textContent = `최근 48시간 신규 화재 ${data.newCount ?? 0}건 · 상시 열원 ${data.persistentCount ?? 0}건 · 마지막 수집: ${fireFmtTime(data.generatedAt)} (바그다드)`;
  }

  if (alertBox) {
    const near = data.nearby || { count: 0, closest: [], radiusKm: 50 };
    if (near.count > 0) {
      const c = near.closest[0];
      alertBox.className = "fire-alert fire-alert-warn";
      alertBox.textContent = `⚠ 현장 반경 ${near.radiusKm}km 안에서 최근 24시간 신규 화재 ${near.count}건 감지 · 가장 가까운 지점 약 ${c.distanceKm}km (${fireFmtTime(c.time)})`;
    } else {
      alertBox.className = "fire-alert fire-alert-ok";
      alertBox.textContent = `현장 반경 ${near.radiusKm}km 안에서 최근 24시간 신규 화재 감지 없음`;
    }
  }
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.view === "view-fires") initFireMap();
  });
});
setInterval(() => { if (fireMapInstance) loadFires(); }, 30 * 60 * 1000); // 열어 둔 화면도 30분마다 새로고침


/* ==========================================================
   해외 현장 지도 (overseas-projects.json)
   회사 로고는 담당자가 assets 폴더에 넣은 이미지를 쓰고,
   없으면 회사 약칭을 색 배지로 보여 준다.
   ========================================================== */

let globalMapInstance = null;
let globalMarkers = [];      // { marker, project, company }
let globalCompanies = {};
let globalActiveCompany = "all";

const GLOBAL_STATUS_COLOR = { "공사중": "#35d0c0", "수주": "#f2a93b", "준공": "#8a94a3" };

function globalBadgeHtml(company, size) {
  const s = size || 34;
  if (company.logo) {
    // 로고는 가로로 긴 경우가 많아서 둥근 사각형 배지에 넣는다
    return `<span class="gbadge gbadge-logo" style="width:${Math.round(s * 1.9)}px;height:${s}px;border-color:${escapeHtml(company.color || "#35d0c0")}">
      <img src="${escapeHtml(company.logo)}" alt="${escapeHtml(company.name)}"></span>`;
  }
  const label = company.short || (company.name || "?").slice(0, 2);
  return `<span class="gbadge gbadge-text" style="width:${s}px;height:${s}px;background:${escapeHtml(company.color || "#35d0c0")};font-size:${label.length > 2 ? 10 : 12}px">${escapeHtml(label)}</span>`;
}

async function initGlobalMap() {
  if (globalMapInstance) {
    setTimeout(() => globalMapInstance.invalidateSize(), 100);
    return;
  }
  globalMapInstance = L.map("globalMap", { zoomSnap: 0.5, minZoom: 1.5, maxZoom: 9, worldCopyJump: true });
  globalMapInstance.attributionControl.setPrefix(false);
  globalMapInstance.attributionControl.addAttribution("지도: Natural Earth");
  globalMapInstance.setView([25, 40], 2);
  globalMapInstance.createPane("labelPane").style.zIndex = 450;
  globalMapInstance.getPane("labelPane").style.pointerEvents = "none";

  let data;
  try {
    const res = await fetch("overseas-projects.json", { cache: "no-store" });
    if (!res.ok) throw new Error("overseas-projects.json 로드 실패");
    data = await res.json();
  } catch (err) {
    console.error(err);
    document.getElementById("globalMeta").textContent = "현장 데이터를 불러올 수 없습니다.";
    return;
  }

  globalCompanies = {};
  (data.companies || []).forEach((c) => { globalCompanies[c.id] = c; });

  // 로고를 따로 지정하지 않은 회사는 assets/logos/회사id.png(.jpg/.svg) 파일이 있으면 자동으로 쓴다
  // 예: 현대건설 → assets/logos/hdec.png, 삼성물산 → assets/logos/samsungcnt.png
  await Promise.all(Object.values(globalCompanies).map(async (c) => {
    if (c.logo) return;
    for (const ext of ["png", "jpg", "svg"]) {
      try {
        const r = await fetch(`assets/logos/${c.id}.${ext}`, { method: "HEAD", cache: "no-store" });
        if (r.ok) { c.logo = `assets/logos/${c.id}.${ext}`; return; }
      } catch (e) { /* 파일 없음 */ }
    }
  }));
  const projects = (data.projects || []).filter((p) => globalCompanies[p.company] && typeof p.lat === "number" && typeof p.lon === "number");
  const activeCountries = new Set(projects.map((p) => p.country));

  // 배경 세계 지도 (현장이 있는 나라는 색을 입힌다)
  try {
    const res = await fetch("world-map.json", { cache: "force-cache" });
    const world = await res.json();
    L.geoJSON(world, {
      style: (f) => activeCountries.has(f.properties.ko)
        ? { color: "#4f6b7a", weight: 0.8, fillColor: "#1f4a55", fillOpacity: 1 }
        : { color: "#3a4452", weight: 0.6, fillColor: "#1b232d", fillOpacity: 1 },
      interactive: false,
    }).addTo(globalMapInstance);
    world.features.forEach((f) => {
      if (!activeCountries.has(f.properties.ko)) return;
      L.marker([f.properties.labelLat, f.properties.labelLon], {
        icon: L.divIcon({ className: "map-label-wrap", html: `<span class="gcountry-label">${escapeHtml(f.properties.ko)}</span>`, iconSize: [0, 0] }),
        pane: "labelPane", interactive: false,
      }).addTo(globalMapInstance);
    });
  } catch (err) {
    console.error(err);
  }

  // 같은 자리에 겹치는 현장은 조금씩 비켜서 놓는다
  const seen = {};
  globalMarkers = projects.map((p) => {
    const c = globalCompanies[p.company];
    const key = `${p.lat.toFixed(1)},${p.lon.toFixed(1)}`;
    const n = seen[key] = (seen[key] || 0) + 1;
    // 같은 나라 중앙에 여러 현장이 몰리면 해바라기 씨앗 모양(나선)으로 퍼뜨린다
    let dLat = 0, dLon = 0;
    if (n > 1) {
      const angle = (n - 1) * 2.39996; // 황금각(라디안)
      const r = 1.4 * Math.sqrt(n - 1);
      dLat = r * Math.sin(angle) * 0.7;
      dLon = r * Math.cos(angle);
    }
    const marker = L.marker([p.lat + dLat, p.lon + dLon], {
      icon: L.divIcon({
        className: "gmarker-wrap",
        html: `<div class="gmarker" style="--st:${GLOBAL_STATUS_COLOR[p.status] || "#35d0c0"}">${globalBadgeHtml(c, 34)}</div>`,
        iconSize: [0, 0],
      }),
      riseOnHover: true,
    }).addTo(globalMapInstance);
    marker.bindTooltip(`<b>${escapeHtml(c.name)}</b><br>${escapeHtml(p.name)}`, { direction: "top", offset: [0, -20], className: "gtooltip" });
    marker.bindPopup(`
      <div class="gpopup">
        <div class="gpopup-head">${globalBadgeHtml(c, 40)}<div><b>${escapeHtml(c.name)}</b><br><span>${escapeHtml(p.name)}</span></div></div>
        국가: ${escapeHtml(p.country || "–")}${p.city ? " · " + escapeHtml(p.city) : ""}<br>
        공종: ${escapeHtml(p.type || "–")} · 상태: <b style="color:${GLOBAL_STATUS_COLOR[p.status] || "inherit"}">${escapeHtml(p.status || "–")}</b><br>
        ${p.amount ? `금액: ${escapeHtml(p.amount)}<br>` : ""}${p.period ? `기간: ${escapeHtml(p.period)}<br>` : ""}${p.note ? `<span style="opacity:.65">${escapeHtml(p.note)}</span><br>` : ""}
        ${p.link ? `<a href="${escapeHtml(p.link)}" target="_blank" rel="noopener">${p.auto ? "DART 공시 원문 보기 ↗" : "관련 자료 보기 ↗"}</a>` : ""}
      </div>`);
    return { marker, project: p, company: c };
  });

  renderGlobalFilter(projects);
  renderGlobalList();
  const countries = new Set(projects.map((p) => p.country)).size;
  const companyCount = new Set(projects.map((p) => p.company)).size;
  document.getElementById("globalMeta").textContent =
    `${companyCount}개사 · ${countries}개국 · 현장 ${projects.length}곳${data.updatedAt ? " · 자료 기준일 " + data.updatedAt : ""}${data.autoSource ? " · 자동 수집: " + data.autoSource : ""}`;
  setTimeout(() => globalMapInstance.invalidateSize(), 100);
}

function renderGlobalFilter(projects) {
  const box = document.getElementById("globalFilter");
  const counts = {};
  projects.forEach((p) => { counts[p.company] = (counts[p.company] || 0) + 1; });
  const chips = [`<button type="button" class="gchip active" data-company="all">전체 <span>${projects.length}</span></button>`];
  Object.keys(counts).forEach((id) => {
    const c = globalCompanies[id];
    chips.push(`<button type="button" class="gchip" data-company="${escapeHtml(id)}">${globalBadgeHtml(c, 18)}${escapeHtml(c.name)} <span>${counts[id]}</span></button>`);
  });
  box.innerHTML = chips.join("");
  box.querySelectorAll(".gchip").forEach((btn) => {
    btn.addEventListener("click", () => {
      globalActiveCompany = btn.dataset.company;
      box.querySelectorAll(".gchip").forEach((b) => b.classList.toggle("active", b === btn));
      applyGlobalFilter();
    });
  });
}

function applyGlobalFilter() {
  const visible = [];
  globalMarkers.forEach((m) => {
    const show = globalActiveCompany === "all" || m.project.company === globalActiveCompany;
    if (show) { m.marker.addTo(globalMapInstance); visible.push(m.marker.getLatLng()); }
    else m.marker.remove();
  });
  if (globalActiveCompany !== "all" && visible.length) {
    globalMapInstance.fitBounds(L.latLngBounds(visible).pad(0.5), { maxZoom: 5 });
  } else if (globalActiveCompany === "all") {
    globalMapInstance.setView([25, 40], 2);
  }
  renderGlobalList();
}

function renderGlobalList() {
  const tbody = document.getElementById("globalList");
  const rows = globalMarkers.filter((m) => globalActiveCompany === "all" || m.project.company === globalActiveCompany);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="global-empty">등록된 현장이 없습니다</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((m, i) => {
    const p = m.project;
    return `<tr data-idx="${globalMarkers.indexOf(m)}">
      <td><span class="glist-company">${globalBadgeHtml(m.company, 22)}${escapeHtml(m.company.name)}</span></td>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.country || "–")}</td>
      <td>${escapeHtml(p.type || "–")}</td>
      <td><span class="gstatus" style="color:${GLOBAL_STATUS_COLOR[p.status] || "inherit"}">${escapeHtml(p.status || "–")}</span></td>
      <td>${escapeHtml(p.amount || "–")}</td>
    </tr>`;
  }).join("");
  tbody.querySelectorAll("tr[data-idx]").forEach((tr) => {
    tr.addEventListener("click", () => {
      const m = globalMarkers[Number(tr.dataset.idx)];
      globalMapInstance.flyTo(m.marker.getLatLng(), 5, { duration: 0.8 });
      setTimeout(() => m.marker.openPopup(), 850);
      document.getElementById("globalMap").scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.view === "view-global") initGlobalMap();
  });
});


/* ==========================================================
   전국 중대재해 현황 (serious-accidents.json)
   왼쪽: 자동으로 넘어가는 통계 슬라이드 / 오른쪽: 발생유형별 카드
   ========================================================== */

const SA_COLORS = { construction: "#f2a93b", manufacturing: "#4fb4ff", etc: "#5fd68f" };
let saSlideIdx = 0, saTimer = null, saPaused = false, saSideIdx = 0, saSideTimer = null, saLoaded = false;

function saYoyHtml(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  const cls = n > 0 ? "sa-up" : n < 0 ? "sa-down" : "";
  return `<span class="sa-yoy ${cls}">${n > 0 ? "▲" : n < 0 ? "▼" : "–"} ${Math.abs(n).toFixed(1)}%</span>`;
}

function saBars(groups, color, total) {
  const max = Math.max(1, ...groups.map((g) => g[1]));
  return `<div class="sa-bars">
    <div class="sa-bar-row sa-bar-total"><span class="sa-bar-label">총계</span>
      <span class="sa-bar-track"><span class="sa-bar" style="width:100%;background:var(--danger)"></span></span><b>${total}</b></div>
    ${groups.map((g) => `
      <div class="sa-bar-row"><span class="sa-bar-label">${escapeHtml(g[0])}</span>
        <span class="sa-bar-track"><span class="sa-bar" style="width:${(g[1] / Math.max(total, max)) * 100}%;background:${color}"></span></span><b>${g[1]}</b></div>`).join("")}
  </div>`;
}

function buildSaSlides(d) {
  const inds = (d.byIndustry || []).filter((x) => x && x.total != null);
  const total = inds.reduce((a, x) => a + Number(x.total || 0), 0);
  const slides = [];

  if (inds.length) {
    slides.push({
      title: "업종별 사고사망자",
      html: `<div class="sa-s1">
        <div class="sa-big"><span>${escapeHtml(d.period || "")} 사고사망자</span><b>${total}<small>명</small></b>${saYoyHtml(d.totalYoy)}</div>
        <div class="sa-ind-tiles">${inds.map((x) => `
          <div class="sa-ind" style="--c:${SA_COLORS[x.key] || "#35d0c0"}">
            <div class="sa-ind-name">${escapeHtml(x.name)}</div>
            <div class="sa-ind-num">${x.total}<small>명</small></div>
            <div class="sa-ind-share"><span style="width:${total ? (x.total / total) * 100 : 0}%"></span></div>
            <div class="sa-ind-foot">전체의 ${total ? ((x.total / total) * 100).toFixed(1) : 0}% ${saYoyHtml(x.yoy)}</div>
          </div>`).join("")}</div>
      </div>`,
    });

    slides.push({
      title: "업종·규모별",
      html: `<div class="sa-s2">${inds.map((x) => `
        <div class="sa-chart">
          <div class="sa-chart-title" style="--c:${SA_COLORS[x.key] || "#35d0c0"}"><b>${escapeHtml(x.name)}</b>(${escapeHtml(x.basis || "")})</div>
          ${saBars(x.groups || [], SA_COLORS[x.key] || "#35d0c0", x.total)}
        </div>`).join("")}</div>`,
    });
  }

  // 3. 업종·재해유형별
  const withTypes = inds.filter((x) => Array.isArray(x.types) && x.types.length);
  if (withTypes.length) {
    slides.push({
      title: "업종·재해유형별",
      html: `<div class="sa-s5">${withTypes.map((x) => `
        <div class="sa-tcard" style="--c:${SA_COLORS[x.key] || "#35d0c0"}">
          <div class="sa-tcard-head"><span>${escapeHtml(x.name)}</span><b>${x.total}<small>명</small></b></div>
          <div class="sa-tgrid">${x.types.map((t, i) => `
            <div class="sa-titem${i === 0 ? " top" : ""}"><span>${escapeHtml(t[0])}</span><b>${t[1]}<small>명</small></b></div>`).join("")}
          </div>
        </div>`).join("")}</div>`,
    });

    // 4. 전 업종 재해유형 순위 (업종별 재해유형을 합산)
    const sum = {};
    withTypes.forEach((x) => x.types.forEach(([name, n]) => { sum[name] = (sum[name] || 0) + n; }));
    const yoyOf = {};
    (d.byType || []).forEach((t) => { yoyOf[t.type] = t.yoy; });
    const ranked = Object.entries(sum).sort((a, b) => (a[0] === "기타") - (b[0] === "기타") || b[1] - a[1]);
    const tmax = Math.max(...ranked.map((r) => r[1]), 1);
    const tsum = ranked.reduce((a, r) => a + r[1], 0);
    slides.push({
      title: "재해유형 순위",
      html: `<div class="sa-s4"><div class="sa-s4-title">전 업종 재해유형별 사고사망자 (합계 ${tsum}명)</div>
        ${ranked.map(([name, n], i) => `
          <div class="sa-type-row"><span class="sa-rank">${name === "기타" ? "–" : i + 1}</span><span class="sa-type-name">${escapeHtml(name)}</span>
            <span class="sa-bar-track"><span class="sa-bar" style="width:${(n / tmax) * 100}%;background:${i === 0 ? "var(--danger)" : name === "기타" ? "var(--text-dim)" : "var(--amber)"}"></span></span>
            <b>${n}명</b><span class="sa-type-pct">${((n / tsum) * 100).toFixed(1)}%${saYoyHtml(yoyOf[name])}</span></div>`).join("")}
      </div>`,
    });
  }

  // 5. 사망사고 최다 발생 유형 (연령·직종·요일·시간)
  const tops = (d.topFactors || []).filter((f) => f && f.deaths != null);
  if (tops.length) {
    const colors = ["#e8743b", "#4f8ef7", "#e8743b", "#4f8ef7"];
    slides.push({
      title: "사망사고 최다 발생 유형",
      html: `<div class="sa-s6">${tops.map((f, i) => `
        <div class="sa-fdonut">
          <div class="sa-fring" style="--p:${Number(f.pct) || 0};--c:${colors[i % colors.length]}">
            <span class="sa-fcount" style="color:${colors[i % colors.length]}">${f.deaths}명</span>
            <div><b>${escapeHtml(f.label)}</b><small>(${Number(f.pct).toFixed(1)}%)</small></div>
          </div>
          <div class="sa-faxis">${escapeHtml(f.axis)}</div>
        </div>`).join("")}</div>`,
    });
  }

  // 건설업 집중 분석: 공사금액 50억 미만 소규모 현장 비중
  const con = inds.find((x) => x.key === "construction");
  if (con && con.groups && con.groups.length) {
    const small = con.groups.filter((g) => /1억 미만|1~5억|5~20억|20~50억/.test(g[0])).reduce((a, g) => a + g[1], 0);
    const pct = con.total ? (small / con.total) * 100 : 0;
    slides.push({
      title: "건설업 집중",
      html: `<div class="sa-s3">
        <div class="sa-donut" style="--p:${pct.toFixed(1)}">
          <div><b>${pct.toFixed(1)}%</b><span>공사금액 50억 미만</span></div>
        </div>
        <div class="sa-s3-text">
          <div class="sa-s3-kicker">건설업 사고사망자 ${con.total}명 중</div>
          <div class="sa-s3-head"><b>${small}명</b>이 공사금액 <b>50억 원 미만</b> 소규모 현장에서 발생</div>
          <ul>${con.groups.map((g) => `<li><span>${escapeHtml(g[0])}</span><b>${g[1]}명</b></li>`).join("")}</ul>
        </div>
      </div>`,
    });
  }

  return slides;
}

function saShow(i) {
  const slides = document.querySelectorAll("#saSlides .sa-slide");
  if (!slides.length) return;
  saSlideIdx = (i + slides.length) % slides.length;
  slides.forEach((s, k) => s.classList.toggle("active", k === saSlideIdx));
  document.querySelectorAll("#saDots .sa-dot").forEach((b, k) => b.classList.toggle("active", k === saSlideIdx));
}

function saRestart() {
  clearInterval(saTimer);
  if (!saPaused) saTimer = setInterval(() => saShow(saSlideIdx + 1), 7000);
}

function saRowHtml(label, value, cls) {
  // "27명" → 숫자는 크게, 단위는 작게
  const m = String(value).match(/^([-+]?[\d,.]+)\s*(.*)$/);
  const v = m ? `${escapeHtml(m[1])}<small>${escapeHtml(m[2])}</small>` : escapeHtml(value);
  return `<div class="sa-side-row"><span>${escapeHtml(label).replace(/\s*(사망자수|증감률)$/, "<br>$1")}</span><b class="${cls || ""}">${v}</b></div>`;
}

function saRenderSide(d, moel) {
  const cards = [];
  if (moel && Array.isArray(moel.cards) && moel.cards.length) {
    // 고용노동부 사이트에서 자동 수집한 카드
    moel.cards.forEach((c) => cards.push({
      sub: c.subtitle || c.title,
      rows: (c.items || []).map((it) => ({
        label: it.label, value: it.value,
        cls: /증감/.test(it.label) && it.number != null ? (it.number > 0 ? "sa-up" : it.number < 0 ? "sa-down" : "") : "",
      })),
    }));
  } else {
    const inds = (d.byIndustry || []).filter((x) => x && x.total != null);
    const total = inds.reduce((a, x) => a + Number(x.total || 0), 0);
    const yoyRow = (y) => ({ label: "전년동기대비 증감률", value: y == null ? "–" : `${y > 0 ? "+" : ""}${Number(y).toFixed(1)}%`, cls: y > 0 ? "sa-up" : y < 0 ? "sa-down" : "" });
    if (total) cards.push({ sub: "전체 사고사망자", rows: [{ label: `${d.period || ""} 사망자수`, value: `${total}명` }, yoyRow(d.totalYoy)] });
    (d.byType || []).filter((t) => t && t.deaths != null).forEach((t) =>
      cards.push({ sub: `발생유형(${t.type})`, rows: [{ label: `${d.period || ""} 사망자수`, value: `${t.deaths}명` }, yoyRow(t.yoy)] }));
    (d.bySize || []).filter((t) => t && t.deaths != null).forEach((t) =>
      cards.push({ sub: t.name, rows: [{ label: `${d.period || ""} 사망자수`, value: `${t.deaths}명` }, yoyRow(t.yoy)] }));
  }
  if (!cards.length) return;

  document.getElementById("saSideSrc").textContent = moel && moel.cards && moel.cards.length
    ? `고용노동부 사이트 자동 연동 · ${fireFmtTime(moel.fetchedAt)} 확인`
    : "직접 입력한 수치";

  const show = (i) => {
    saSideIdx = (i + cards.length) % cards.length;
    const c = cards[saSideIdx];
    document.getElementById("saSideSub").textContent = c.sub;
    const card = document.getElementById("saSideCard");
    card.innerHTML = c.rows.map((r, k) => (k ? '<div class="sa-side-sep"></div>' : "") + saRowHtml(r.label, r.value, r.cls)).join("");
    card.classList.remove("sa-flash"); void card.offsetWidth; card.classList.add("sa-flash");
  };
  const restartSide = () => { clearInterval(saSideTimer); if (cards.length > 1) saSideTimer = setInterval(() => show(saSideIdx + 1), 5000); };
  document.getElementById("saSidePrev").onclick = () => { show(saSideIdx - 1); restartSide(); };
  document.getElementById("saSideNext").onclick = () => { show(saSideIdx + 1); restartSide(); };
  show(0);
  restartSide();
}

async function initSeriousAccidents() {
  if (saLoaded) return;
  let d;
  try {
    const res = await fetch("serious-accidents.json", { cache: "no-store" });
    if (!res.ok) throw new Error("serious-accidents.json 로드 실패");
    d = await res.json();
  } catch (err) {
    console.error(err);
    document.getElementById("saSource").textContent = "중대재해 통계를 불러올 수 없습니다.";
    return;
  }
  saLoaded = true;

  // 고용노동부 사이트 자동 수집분(있으면): 발생유형별 수치는 이것을 우선 사용
  let moel = null;
  try {
    const r = await fetch("moel-serious.json", { cache: "no-store" });
    if (r.ok) moel = await r.json();
  } catch (e) { /* 아직 수집 전 */ }
  if (moel && Array.isArray(moel.cards)) {
    const types = moel.cards.filter((c) => c.accidentType).map((c) => {
      const deaths = (c.items || []).find((it) => /사망/.test(it.label));
      const yoy = (c.items || []).find((it) => /증감/.test(it.label));
      return { type: c.accidentType, deaths: deaths ? deaths.number : null, yoy: yoy ? yoy.number : null };
    }).filter((t) => t.deaths != null);
    if (types.length) d.byType = types;

    // 고용노동부가 더 새 배너(통계)를 올렸으면 안내
    const notice = document.getElementById("saNotice");
    if (moel.latestBannerDate && d.bannerDate && moel.latestBannerDate > d.bannerDate) {
      notice.hidden = false;
      notice.innerHTML = `📢 고용노동부 중대재해 통계가 새로 발표됐습니다 (배너 ${escapeHtml(moel.latestBannerDate)} 수정) · 아래 막대그래프는 이전 발표(${escapeHtml(d.bannerDate)}) 기준입니다 · <a href="${escapeHtml(moel.source)}" target="_blank" rel="noopener">원문 보기 ↗</a>`;
    }
  }
  document.getElementById("saPeriod").textContent = d.period ? `· ${d.period}` : "";
  document.getElementById("saSource").textContent =
    `출처: ${d.source || "고용노동부"} (재해조사 대상 사망사고 기준) · 자료 반영일 ${d.updatedAt || "–"} · 분기별 발표 수치를 옮겨 적은 참고 자료입니다`;

  const slides = buildSaSlides(d);
  document.getElementById("saSlides").innerHTML = slides.map((s, i) =>
    `<div class="sa-slide${i === 0 ? " active" : ""}" role="group" aria-label="${i + 1} / ${slides.length}">
      <div class="sa-slide-tag"><span>${i + 1}</span>${escapeHtml(s.title)}</div>${s.html}</div>`).join("");
  document.getElementById("saDots").innerHTML = slides.map((s, i) =>
    `<button type="button" class="sa-dot${i === 0 ? " active" : ""}" data-i="${i}" title="${escapeHtml(s.title)}">${i + 1}</button>`).join("");
  document.querySelectorAll("#saDots .sa-dot").forEach((b) => b.addEventListener("click", () => { saShow(Number(b.dataset.i)); saRestart(); }));
  document.getElementById("saPrev").onclick = () => { saShow(saSlideIdx - 1); saRestart(); };
  document.getElementById("saNext").onclick = () => { saShow(saSlideIdx + 1); saRestart(); };
  const pauseBtn = document.getElementById("saPause");
  pauseBtn.onclick = () => {
    saPaused = !saPaused;
    pauseBtn.textContent = saPaused ? "▶" : "❚❚";
    pauseBtn.setAttribute("aria-label", saPaused ? "재생" : "일시정지");
    saRestart();
  };
  const stage = document.getElementById("saStage");
  stage.addEventListener("mouseenter", () => clearInterval(saTimer));
  stage.addEventListener("mouseleave", saRestart);
  saRestart();
  saRenderSide(d, moel);
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.view === "view-sa") initSeriousAccidents();
  });
});
