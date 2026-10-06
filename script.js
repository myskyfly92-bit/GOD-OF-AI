/* ==========================================================
   Bismayah HSE Situation Room — script.js
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
      // 항상 새 탭으로만 열기 — 현재 상황실 화면은 그대로 유지되도록
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


/* 탭(소분류) → 그 탭이 속한 대분류의 배경 이름 */
const BG_OF_GROUP = { home: "bg-dashboard", safety: "bg-safety", health: "bg-health", env: "bg-env", fire: "bg-fire", etc: "bg-etc" };
function bgClassOfView(viewId) {
  const b = document.querySelector(`.sub-row .tab-btn[data-view="${viewId}"]`);
  const g = b && b.closest(".sub-row") ? b.closest(".sub-row").dataset.group : "home";
  return BG_OF_GROUP[g] || "bg-dashboard";
}

/* 공항 전광판식 시계: 숫자가 바뀌는 칸만 위쪽 반이 접히며 넘어간다 */
const FLAP_CLOCK_REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function flapClock(el, text) {
  if (!el) return;
  if (FLAP_CLOCK_REDUCE) { el.textContent = text; return; }
  if (!el.classList.contains("flapclock")) {
    el.classList.add("flapclock");
    el.innerHTML = [...text].map((ch) => (/\d/.test(ch)
      ? `<span class="fc" data-v="${ch}"><span class="fc-top">${ch}</span><span class="fc-bot">${ch}</span><span class="fc-flip fc-flip-top">${ch}</span><span class="fc-flip fc-flip-bot">${ch}</span></span>`
      : `<span class="fc-sep">${ch}</span>`)).join("");
    return;
  }
  const cards = el.querySelectorAll(".fc");
  const digits = [...text].filter((c) => /\d/.test(c));
  cards.forEach((card, i) => {
    const nv = digits[i], ov = card.dataset.v;
    if (nv === undefined || nv === ov) return;
    card.dataset.v = nv;
    const top = card.querySelector(".fc-top"), bot = card.querySelector(".fc-bot");
    const ft = card.querySelector(".fc-flip-top"), fb = card.querySelector(".fc-flip-bot");
    // 뒤쪽 위 반쪽은 새 숫자, 앞에서 접히는 위 반쪽은 옛 숫자 → 접힌 뒤 아래 반쪽이 새 숫자로 펼쳐짐
    top.textContent = nv; ft.textContent = ov; fb.textContent = nv; bot.textContent = ov;
    card.classList.remove("flipping"); void card.offsetWidth; card.classList.add("flipping");
    clearTimeout(card._t);
    card._t = setTimeout(() => { bot.textContent = nv; card.classList.remove("flipping"); }, 600);
  });
  el.setAttribute("aria-label", text);
}

function updateClock() {
  const now = new Date();
  const timeFmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  });
  const dateFmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: TIMEZONE, year: "numeric", month: "long", day: "numeric", weekday: "long"
  });
  flapClock(document.getElementById("clock"), timeFmt.format(now));
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
  // 화면에 안 보이는 카드(display:none → 좌표 0)는 빼고 잰다.
  // (종합현황에서 숨겨 둔 온열질환·중대재해 카드의 0 좌표가 섞이면 왼쪽 여백이 0으로 잡혀
  //  달력이 들어갈 자리가 없다고 판단해 달력·환율 위젯을 숨기던 버그)
  const rects = Array.from(panels)
    .map((p) => p.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
  if (rects.length) {
    gridRight = Math.max(...rects.map((r) => r.right));
    gridLeft = Math.min(...rects.map((r) => r.left));
  }
  const gap = 20;
  const scrollX = window.scrollX || window.pageXOffset || 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;

  // 달력은 grid 컨테이너 자체가 아니라, 실제 카드(첫 패널)의 위쪽 끝과 높이를 맞춘다
  // (grid에는 위쪽 padding이 있어서 컨테이너 기준으로 맞추면 그만큼 더 위에 위치하게 됨)
  // position:absolute라 문서 좌표(스크롤 오프셋 포함)로 넣어야 페이지와 같이 스크롤된다.
  // 카드가 나타나는 효과(아래에서 위로 떠오름) 도중에 재면 그만큼 아래로 어긋나므로,
  // 움직이는 카드 대신 grid 위쪽 끝 + grid 위쪽 여백으로 첫 줄 카드의 '최종' 위치를 계산한다.
  const firstPanel = gridEl.querySelector(".panel");
  if (holidayPanel && firstPanel) {
    const padTop = parseFloat(getComputedStyle(gridEl).paddingTop) || 0;
    holidayPanel.style.top = `${Math.round(gridEl.getBoundingClientRect().top + padTop + scrollY)}px`;
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
      // 소분류 줄이 열려 있어도 언어 버튼은 대분류 줄(첫 줄) 높이에 맞춘다
      const tabBarRect = (tabBarEl.querySelector(".group-bar") || tabBarEl).getBoundingClientRect();
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
    // 배경 사진은 대분류(종합현황·안전·보건·환경·소방·기타 정보)마다 하나. 소분류는 대분류 사진을 따른다
    document.body.className = bgClassOfView(btn.dataset.view);

    // 탭마다 카드 영역 크기가 달라서 달력·환율 위치를 다시 맞춘다
    if (typeof alignSideWidgets === "function") {
      requestAnimationFrame(alignSideWidgets);
    }
  });
});

/* ---------------- 중동·주변국 대사관 안전공지 ----------------
   embassy-notices.json: 나라별(이라크·이란·시리아·요르단·사우디 등 16개국) 최근 공지를 날짜순으로 합친 것.
   위쪽 나라 버튼으로 걸러 볼 수 있다. */
let embData = null, embCountry = "ALL", embKind = "ALL", embShown = 8;
// 대사관 바로가기 (외교부 재외공관 홈페이지). 시리아는 주레바논대사관이 겸임
const EMBASSY_LINKS = [
  ["IQ", "이라크", "iq-ko"], ["IR", "이란", "ir-ko"], ["JO", "요르단", "jo-ko"], ["SA", "사우디아라비아", "sa-ko"],
  ["KW", "쿠웨이트", "kw-ko"], ["TR", "튀르키예", "tr-ko"], ["LB", "레바논 (시리아 겸임)", "lb-ko"], ["IL", "이스라엘", "il-ko"],
  ["PS", "팔레스타인 (대표사무소)", "ps-ko"], ["EG", "이집트", "eg-ko"], ["AE", "아랍에미리트", "ae-ko"], ["QA", "카타르", "qa-ko"],
  ["BH", "바레인", "bh-ko"], ["OM", "오만", "om-ko"], ["YE", "예멘", "ye-ko"],
];
(function renderEmbassyLinks() {
  const box = document.getElementById("embLinks");
  if (!box) return;
  box.innerHTML = EMBASSY_LINKS.map(([iso, name, path]) => `
    <a class="emb-link" href="https://overseas.mofa.go.kr/${path}/index.do" target="_blank" rel="noopener noreferrer">
      <img src="https://flagcdn.com/w40/${iso.toLowerCase()}.png" alt="" loading="lazy">
      <span>${escapeHtml(name)}</span><i>↗</i>
    </a>`).join("");
})();
async function loadEmbassyNotices() {
  const list = document.getElementById("embassyList");
  try {
    const res = await fetch("embassy-notices.json", { cache: "no-store" });
    if (!res.ok) throw new Error("embassy-notices.json 로드 실패");
    embData = await res.json();
    renderEmbassyNotices();
  } catch (err) {
    console.error(err);
    list.innerHTML = `<li class="embassy-row skeleton">아직 embassy-notices.json이 없거나 불러올 수 없습니다. GitHub Actions가 최초 1회 실행된 후 표시됩니다.</li>`;
  }
}

function renderEmbassyNotices() {
  const list = document.getElementById("embassyList");
  const items = (embData && embData.items) || [];
  // 외교부 API에 자료가 없으면 이 칸 전체를 숨긴다 (자료가 다시 들어오면 자동으로 나타남)
  const apiBox = document.getElementById("embApiBox");
  if (apiBox) apiBox.hidden = !items.length;
  if (!items.length) return;
  // 나라 버튼 (공지가 있는 나라만, 많은 순)
  const counts = {};
  items.forEach((n) => { const k = n.iso2 || "IQ"; counts[k] = counts[k] || { name: n.country || "이라크", n: 0 }; counts[k].n++; });
  const flag = (iso) => `<img src="https://flagcdn.com/w40/${iso.toLowerCase()}.png" alt="" loading="lazy">`;
  document.getElementById("embFilter").innerHTML =
    `<button type="button" data-c="ALL" class="${embCountry === "ALL" ? "active" : ""}">전체 <b>${items.length}</b></button>` +
    Object.entries(counts).sort((a, b) => b[1].n - a[1].n).map(([iso, c]) =>
      `<button type="button" data-c="${iso}" class="${embCountry === iso ? "active" : ""}">${flag(iso)}${escapeHtml(c.name)} <b>${c.n}</b></button>`).join("");
  // 종류 버튼 (안전공지 / 공지사항)
  const kinds = [...new Set(items.map((n) => n.kind || "안전공지"))];
  if (kinds.length > 1) {
    document.getElementById("embFilter").insertAdjacentHTML("beforeend", `<span class="emb-sep"></span>` +
      ["ALL", ...kinds].map((k) => `<button type="button" data-k="${k}" class="${embKind === k ? "active" : ""}">${k === "ALL" ? "모든 종류" : escapeHtml(k)}</button>`).join(""));
  }
  document.querySelectorAll("#embFilter button[data-c]").forEach((b) => b.onclick = () => { embCountry = b.dataset.c; embShown = 8; renderEmbassyNotices(); });
  document.querySelectorAll("#embFilter button[data-k]").forEach((b) => b.onclick = () => { embKind = b.dataset.k; embShown = 8; renderEmbassyNotices(); });

  const shown = items.filter((n) => (embCountry === "ALL" || (n.iso2 || "IQ") === embCountry) && (embKind === "ALL" || (n.kind || "안전공지") === embKind));
  if (!shown.length) {
    list.innerHTML = `<li class="embassy-row skeleton">외교부 공지 API가 현재 자료를 제공하지 않고 있습니다. 위의 대사관 바로가기와 아래 관련 뉴스를 확인해 주세요. (API에 자료가 다시 들어오면 여기에 자동으로 표시됩니다)</li>`;
  } else {
    // 최근 3일 안에 올라온 공지는 NEW 표시
    const newSince = Date.now() - 3 * 86400000;
    const isNew = (d) => { const t = Date.parse(String(d || "").slice(0, 10)); return !isNaN(t) && t >= newSince; };
    list.innerHTML = shown.slice(0, embShown).map((n) => {
      const hasBody = n.body && n.body.trim().length > 0;
      const iso = n.iso2 || "IQ";
      return `
      <li class="embassy-row${isNew(n.date) ? " is-new" : ""}">
        <div class="notice-top">
          <span class="notice-title"><span class="emb-country">${flag(iso)}${escapeHtml(n.country || "")}</span><span class="emb-kind ${(n.kind || "안전공지") === "안전공지" ? "safe" : ""}">${escapeHtml(n.kind || "안전공지")}</span>${isNew(n.date) ? `<span class="emb-new">NEW</span>` : ""}${escapeHtml(n.title)}</span>
          <span class="notice-date">${escapeHtml(n.date || "")}</span>
        </div>
        ${hasBody ? `
          <div class="notice-body">${escapeHtml(n.body)}</div>
          <button type="button" class="embassy-toggle">자세히 보기 ▾</button>
        ` : `
          <div class="notice-body embassy-empty">이 공지는 본문 요약이 제공되지 않습니다.</div>
          <a class="embassy-link" href="https://www.0404.go.kr/" target="_blank" rel="noopener noreferrer">해외안전여행 홈페이지에서 원문 확인 ↗</a>
        `}
      </li>`;
    }).join("") + (shown.length > embShown
      ? `<li><button type="button" class="emb-more">이전 공지 더 보기 (${shown.length - embShown}건)</button></li>` : "");
    const more = list.querySelector(".emb-more");
    if (more) more.onclick = () => { embShown += 8; renderEmbassyNotices(); };
    // 제목이나 '자세히 보기'를 누르면 본문 펼치기/접기
    list.querySelectorAll(".embassy-row").forEach((row) => {
      const btn = row.querySelector(".embassy-toggle");
      if (!btn) return;
      const toggle = () => {
        const expanded = row.classList.toggle("expanded");
        btn.textContent = expanded ? "접기 ▴" : "자세히 보기 ▾";
      };
      btn.addEventListener("click", toggle);
      row.querySelector(".notice-top").addEventListener("click", toggle);
    });
  }
  if (embData && embData.generatedAt) {
    document.getElementById("embassyMeta").textContent =
      `외교부 공공데이터 API 연동 · 중동·주변국 ${(embData.countries || []).length || 1}개국 · 3시간마다 갱신 · 마지막 수집: ` +
      new Intl.DateTimeFormat("ko-KR", { timeZone: TIMEZONE, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(embData.generatedAt));
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

let appsScriptUrlPromise = null;
function getAppsScriptUrl() {
  if (!appsScriptUrlPromise) {
    appsScriptUrlPromise = fetch("work-zones.json", { cache: "no-store" })
      .then((r) => r.json()).then((c) => (c.appsScriptUrl || "").trim()).catch(() => "");
  }
  return appsScriptUrlPromise;
}

function renderWhoOutbreaks(items, generatedAt) {
  const list = document.getElementById("whoOutbreakList");
  if (!items || !items.length) {
    list.innerHTML = `<li class="embassy-row skeleton">최근 수집된 정보가 없습니다.</li>`;
    return;
  }
  const draw = (ko) => {
    list.innerHTML = items.map(n => {
      const k = ko && n.link ? ko[n.link] : null;
      const title = k && k.titleKo ? k.titleKo : n.title;
      const summary = k && k.summaryKo ? k.summaryKo : (n.summary || "");
      return `
    <li class="embassy-row">
      <div class="notice-top">
        <span class="notice-title">${escapeHtml(title)}</span>
        <span class="notice-date">${escapeHtml((n.date || "").slice(0, 10))}</span>
      </div>
      <div class="notice-body">${escapeHtml(summary)}</div>
      ${k && k.titleKo ? `<details class="inews-orig"><summary>원문 보기</summary><p><b>${escapeHtml(n.title)}</b></p><p>${escapeHtml(n.summary || "")}</p>
        ${n.link ? `<a href="${n.link}" target="_blank" rel="noopener noreferrer">WHO 원문 페이지 ↗</a>` : ""}</details>`
        : (n.link ? `<a class="embassy-link" href="${n.link}" target="_blank" rel="noopener noreferrer">WHO 원문 보기 ↗</a>` : "")}
    </li>`;
    }).join("");
  };
  draw(null); // 먼저 영어 원문으로 그리고
  // Apps Script가 번역해 둔 한국어가 있으면 바꿔 그린다
  getAppsScriptUrl().then(async (url) => {
    if (!url) return;
    try {
      const r = await (await fetch(url + (url.includes("?") ? "&" : "?") + "action=who&t=" + Date.now())).json();
      if (r.ok && r.map && Object.keys(r.map).length) draw(r.map);
    } catch (e) { console.warn("WHO 번역 불러오기 실패", e); }
  });

  if (generatedAt) {
    const dt = new Date(generatedAt);
    document.getElementById("whoOutbreakMeta").textContent =
      "World Health Organization 공식 API 연동 · 한국어는 구글 번역 · 마지막 수집: " +
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

/* ---------------- 사고사례: 국내 건설업 재해사례 (kosha-cases.json 기반) ----------------
   한국산업안전보건공단 국내재해사례 게시판에서 건설업만 골라
   GitHub Actions(update-kosha-cases.yml)가 매일 kosha-cases.json으로 저장한다. */
function accEscapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let accKosha = null;
let accKoshaType = "전체";
let accKoshaShown = 15;
const ACC_KOSHA_STEP = 15;

async function loadAccidentCases() {
  const container = document.getElementById("accidentContainer");
  if (!container) return;
  try {
    const res = await fetch("kosha-cases.json", { cache: "no-store" });
    if (!res.ok) throw new Error("kosha-cases.json 로드 실패");
    accKosha = await res.json();
  } catch (err) {
    console.error(err);
    accKosha = null;
  }
  container.innerHTML = renderKoshaCases();
}

function renderKoshaCases() {
  if (!accKosha || !(accKosha.items || []).length) {
    return `<p class="skeleton">국내 건설업 재해사례를 준비 중입니다. (자동 수집이 처음 실행되면 표시됩니다)</p>`;
  }
  // 사고 발생일 기준 최신 → 과거 (발생일이 본문에 없는 사례는 맨 뒤)
  const items = [...accKosha.items].sort((a, b) =>
    String(b.sortKey || "0").localeCompare(String(a.sortKey || "0")) ||
    String(b.boardno || "").localeCompare(String(a.boardno || "")));
  const counts = {};
  items.forEach(it => { counts[it.type] = (counts[it.type] || 0) + 1; });
  const types = Object.keys(counts).sort((x, y) => counts[y] - counts[x]);
  const filtered = accKoshaType === "전체" ? items : items.filter(it => it.type === accKoshaType);
  const shown = filtered.slice(0, accKoshaShown);
  const updated = accKosha.generatedAt
    ? new Date(accKosha.generatedAt).toLocaleDateString("ko-KR") : "";

  const chip = (label, n) => `
    <button type="button" class="kosha-chip${accKoshaType === label ? " is-active" : ""}"
      data-kosha-type="${accEscapeHtml(label)}">${accEscapeHtml(label)} <span>${n}</span></button>`;

  return `
    <p class="kosha-source">
      한국산업안전보건공단 산업안전포털 국내재해사례 중 <b>건설업</b> 최신 ${items.length}건${updated ? ` · ${updated} 갱신` : ""}
    </p>
    <div class="kosha-chips">
      ${chip("전체", items.length)}
      ${types.map(t => chip(t, counts[t])).join("")}
    </div>
    <ul class="kosha-list">
      ${shown.map(it => `
        <li>
          <details class="kosha-case">
            <summary>
              <span class="kosha-type kosha-type--${accEscapeHtml(it.type)}">${accEscapeHtml(it.type)}</span>
              <span class="kosha-title">${accEscapeHtml(it.title)}</span>
              <span class="kosha-date">${accEscapeHtml(koshaDateLabel(it.accidentDate))}</span>
            </summary>
            <p class="kosha-body">${accEscapeHtml(it.contents)}</p>
            ${koshaLinks(it)}
          </details>
        </li>
      `).join("")}
    </ul>
    ${filtered.length > accKoshaShown
      ? `<button type="button" class="kosha-more" data-kosha-more>더 보기 (${filtered.length - accKoshaShown}건 남음)</button>`
      : ""}
    <p class="kosha-note">출처: 한국산업안전보건공단 <a href="${accEscapeHtml(accKosha.sourceUrl || "https://portal.kosha.or.kr")}" target="_blank" rel="noopener noreferrer">산업안전포털</a> 국내재해사례 · 공공데이터포털 오픈API · 매일 자동 갱신 · 날짜는 사고 발생일(일자가 가려진 사례는 연·월만 표시) · 상세 자료는 공단이 사례별로 첨부한 원문입니다</p>
  `;
}

// "2025-11-20" → "2025.11.20", "2025-11" → "2025.11", 없으면 "발생일 미상"
function koshaDateLabel(d) {
  if (!d) return "발생일 미상";
  return d.replace(/-/g, ".");
}

// 공단이 사례에 붙인 상세 자료(사고 경위·원인·대책 PDF) 버튼
function koshaLinks(it) {
  const files = Array.isArray(it.files) ? it.files : [];
  if (!files.length) return "";
  const fileBtns = files.map((f) => {
    const ext = (String(f.name).match(/\.([a-z0-9]+)$/i) || [])[1];
    const label = files.length > 1 ? f.name.replace(/\.[a-z0-9]+$/i, "") : "상세 자료";
    return `<a class="kosha-file" href="${accEscapeHtml(f.url)}" target="_blank" rel="noopener noreferrer"
      title="${accEscapeHtml(f.name)}">📄 ${accEscapeHtml(label)}${ext ? ` (${accEscapeHtml(ext.toUpperCase())})` : ""} ↗</a>`;
  }).join("");
  return `<div class="kosha-links">${fileBtns}</div>`;
}

document.addEventListener("click", (e) => {
  const box = document.getElementById("accidentContainer");
  if (!box || !box.contains(e.target)) return;
  const chip = e.target.closest("[data-kosha-type]");
  if (chip) {
    accKoshaType = chip.dataset.koshaType;
    accKoshaShown = ACC_KOSHA_STEP;
    box.innerHTML = renderKoshaCases();
    return;
  }
  if (e.target.closest("[data-kosha-more]")) {
    accKoshaShown += ACC_KOSHA_STEP;
    box.innerHTML = renderKoshaCases();
  }
});

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
      person: col("담당"), note: col("비고"), xy: col("좌표"), crew: col("작업인원", "인원"),
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
               person: get(r, c.person), note: get(r, c.note), xy, row: idx + 2,
               crew: parseInt(get(r, c.crew).replace(/[^\d]/g, ""), 10) || 0 };
    }).filter((it) => it.work && (it.date || WZ_DAY_ORDER.includes(it.day)));
    wzSheetError = "";
  } catch (err) {
    console.error("작업일정 시트 불러오기 실패:", err);
    wzItems = null;
    wzSheetError = err.message;
  }
  renderTodayWork();
}

/* ---------------- 종합현황: 오늘 작업 현황 ---------------- */
function renderTodayWork() {
  const totalEl = document.getElementById("twTotal");
  if (!totalEl) return;
  const riskEl = document.getElementById("twRisk");
  const rowsEl = document.getElementById("twRows");
  const today = wzBaghdadToday();
  const dow = WZ_DAY_ORDER[(new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7];
  document.getElementById("twDate").textContent = `· ${Number(today.slice(5, 7))}/${Number(today.slice(8, 10))} (${dow})`;
  document.getElementById("twGo").onclick = () => document.querySelector('.tab-btn[data-view="view-workzone"]')?.click();

  if (!wzItems) {
    totalEl.textContent = "–"; riskEl.textContent = "–"; document.getElementById("twCrew").textContent = "–";
    rowsEl.innerHTML = `<p class="tw-empty">${wzSheetError ? "작업일정을 불러오지 못했습니다" : "작업일정 시트 연결 전입니다"}</p>`;
    return;
  }
  const items = wzItems.filter((it) => (it.date ? it.date === today : it.day === dow));
  const risky = items.filter((it) => it.risks.length);
  totalEl.textContent = items.length;
  riskEl.textContent = risky.length;
  const crewAll = items.reduce((a, it) => a + it.crew, 0);
  const crewRisk = risky.reduce((a, it) => a + it.crew, 0);
  document.getElementById("twCrew").textContent = crewAll;
  document.getElementById("twRiskCrew").textContent = crewRisk ? `위험작업 투입 ${crewRisk}명` : "";
  document.getElementById("twRiskBox").classList.toggle("on", risky.length > 0);

  const count = (arr, key) => arr.reduce((m, it) => { const k = key(it); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
  const chips = (obj, color) => Object.entries(obj).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `<span class="tw-chip" style="--c:${color ? color(k) : "#8996a6"}">${wzEscapeHtml(k)} <b>${n}</b></span>`).join("");
  const byTeam = count(items, (it) => it.team);
  const byZone = count(items, (it) => it.zone || "전체");
  const byRisk = {};
  risky.forEach((it) => it.risks.forEach((r) => { byRisk[r] = (byRisk[r] || 0) + 1; }));

  rowsEl.innerHTML = items.length ? `
    <div class="tw-row"><span class="tw-key">팀별</span><div>${chips(byTeam, (t) => (WZ_TEAMS[t] || {}).color || "#8996a6")}</div></div>
    <div class="tw-row"><span class="tw-key">구역별</span><div>${chips(byZone)}</div></div>
    ${crewAll ? `<div class="tw-row"><span class="tw-key">인원(명)</span><div>${chips(Object.fromEntries(Object.keys(WZ_TEAMS).map((t) => [t, items.filter((it) => it.team === t).reduce((a, it) => a + it.crew, 0)]).filter(([, n]) => n)), (t) => (WZ_TEAMS[t] || {}).color || "#8996a6")}</div></div>` : ""}
    ${risky.length ? `<div class="tw-row"><span class="tw-key">위험작업</span><div>${chips(byRisk, () => "#e5484d")}</div></div>
    <div class="tw-risk-list">${risky.slice(0, 4).map((it) => `<div>⚠ <b style="color:${WZ_PART_COLORS[it.part] || "#8996a6"}">${wzEscapeHtml(it.part)}</b> ${wzEscapeHtml(it.work)} <span>${wzEscapeHtml(it.zone || "")}${it.loc ? " · " + wzEscapeHtml(it.loc) : ""}${it.crew ? " · 👥 " + it.crew + "명" : ""}</span></div>`).join("")}
      ${risky.length > 4 ? `<div class="tw-more">외 ${risky.length - 4}건</div>` : ""}</div>` : ""}`
    : `<p class="tw-empty">오늘 등록된 작업이 없습니다</p>`;
}

// 상황실 화면을 켜 두어도 10분마다 작업일정을 다시 읽는다
setInterval(() => { if (typeof wzConfig === "object" && (wzConfig.appsScriptUrl || wzConfig.sheetCsvUrl)) wzLoadSheet(wzConfig).then(() => { if (wzZones[wzActiveIdx] && document.getElementById("wzScheduleCol")) wzShowSchedule(wzZones[wzActiveIdx]); }); }, 10 * 60 * 1000);

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
    <div class="wz-summary">${inWeek ? `오늘 작업 <b>${todayItems.length}</b>건 · 인원 <b>${todayItems.reduce((a, it) => a + it.crew, 0)}</b>명 · ${Object.keys(WZ_TEAMS).map((t) => `${t} ${todayItems.filter((it) => it.team === t).length}`).join(" · ")}
      ${todayRisk ? `· <span class="wz-risk-sum">⚠ 위험작업 ${todayRisk}건</span>` : ""}` : "다른 주를 보고 있습니다"}</div>
    <div class="wz-chips">${teamChips}</div>
    <div class="wz-chips">${partChips}</div>`;
  bar.querySelectorAll("[data-team]").forEach((b) => b.onclick = () => { wzTeam = b.dataset.team; wzPart = null; wzShowSchedule(zone); });
  bar.querySelectorAll("[data-part]").forEach((b) => b.onclick = () => { wzPart = wzPart === b.dataset.part ? null : b.dataset.part; wzShowSchedule(zone); });

  const fmt = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
  const canEdit = !!((wzConfig && wzConfig.appsScriptUrl) || "").trim();
  const rows = WZ_DAY_ORDER.map((day, i) => {
    const iso = dates[i];
    const list = weekItems.filter((it) => (it.date ? it.date === iso : it.day === day)).filter(wzPassFilter);
    const items = list.map((it) => `
      <div class="wz-item" style="--c:${WZ_PART_COLORS[it.part] || "#8996a6"}">
        <span class="wz-part-badge">${wzEscapeHtml(it.part || it.team || "–")}</span>
        <div class="wz-item-body">
          <div class="wz-item-work">${wzEscapeHtml(it.work)}${it.date ? "" : ' <span class="wz-repeat">매주</span>'}</div>
          ${(it.loc || it.person || it.note || it.crew) ? `<div class="wz-item-meta">${[it.loc && "📍 " + wzEscapeHtml(it.loc), it.crew && "👥 " + it.crew + "명", it.person && "👷 " + wzEscapeHtml(it.person), it.note && wzEscapeHtml(it.note)].filter(Boolean).join(" · ")}</div>` : ""}
          ${it.risks.length ? `<div class="wz-risks">${it.risks.map((r) => `<span class="wz-risk">⚠ ${wzEscapeHtml(r)}</span>`).join("")}</div>` : ""}
        </div>
        ${canEdit ? `<span class="wz-item-tools"><button type="button" class="wz-edit" data-row="${it.row}" title="수정">수정</button><button type="button" class="wz-del" data-row="${it.row}" title="삭제">삭제</button></span>` : ""}
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

  // 수정·삭제 버튼 (누를 때 그 줄 선택(날짜 바꾸기)이 같이 일어나지 않게 막는다)
  const byRow = (r) => (wzItems || []).find((it) => it.row === Number(r));
  col.querySelectorAll(".wz-edit").forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const it = byRow(b.dataset.row);
    if (it) { wzShowAddForm(null, null, it); document.getElementById("wzPickBox")?.scrollIntoView({ behavior: "smooth", block: "center" }); }
  });
  col.querySelectorAll(".wz-del").forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    const it = byRow(b.dataset.row);
    if (!it) return;
    if (!confirm(`'${it.work}' 작업을 지울까요?\n(구글 시트에서도 지워집니다)`)) return;
    b.disabled = true; b.textContent = "…";
    await wzSaveAndRefresh("del", { row: it.row, work: it.work });
  });

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
      <div class="wz-pin-row"><b style="color:${WZ_PART_COLORS[it.part] || "#8996a6"}">${wzEscapeHtml(it.part)}</b> ${wzEscapeHtml(it.work)}${it.crew ? ` <span class="wz-pin-crew">👥 ${it.crew}명</span>` : ""}
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

// 저장 암호: 평소엔 묻지 않고, 시트 쪽에 암호가 걸려 있을 때만 한 번 물어본다
function wzPasscode(ask) {
  let pw = "";
  try { pw = localStorage.getItem("wzPass") || ""; } catch (e) {}
  if (ask) {
    pw = prompt("작업일정 저장 암호를 입력하세요 (담당자에게 문의)") || "";
    try { pw ? localStorage.setItem("wzPass", pw) : localStorage.removeItem("wzPass"); } catch (e) {}
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
  try {
    try {
      await wzCallScript(action, payload);
    } catch (err) {
      if (!/암호/.test(err.message)) throw err;
      payload.passcode = wzPasscode(true); // 암호가 걸려 있으면 그때만 물어보고 한 번 더 시도
      if (!payload.passcode) return false;
      await wzCallScript(action, payload);
    }
  } catch (err) {
    alert("저장하지 못했습니다: " + err.message);
    return false;
  }
  await wzLoadSheet(wzConfig);
  wzShowSchedule(wzZones[wzActiveIdx]);
  return true;
}

function wzShowAddForm(x, y, editItem) {
  const box = document.getElementById("wzPickBox");
  const zone = wzZones[wzActiveIdx];
  const today = wzBaghdadToday();
  const ed = editItem || null;
  const defDate = ed ? (ed.date || "") : (wzSelDate || today);
  if (ed) wzPick = { mode: "editing" };
  const partOpts = Object.entries(WZ_TEAMS).map(([t, v]) =>
    `<optgroup label="${wzEscapeHtml(t)}">${v.parts.map((p) => `<option value="${wzEscapeHtml(p)}">${wzEscapeHtml(p)}</option>`).join("")}</optgroup>`).join("");
  box.hidden = false;
  box.innerHTML = `
    <div>${ed ? `<b>작업 수정</b> <small>${ed.date ? "" : "(매주 반복 작업 · 날짜를 넣으면 그날 작업으로 바뀝니다)"}</small>` : `<b>${wzEscapeHtml(zone.name)}</b>에 작업 추가 <small>(X ${x}, Y ${y})</small>`}</div>
    <input type="date" id="wzfDate" value="${defDate}">
    <select id="wzfPart">${partOpts}</select>
    <input type="text" id="wzfWork" placeholder="작업내용 (필수)">
    <input type="text" id="wzfLoc" placeholder="세부위치 (예: 식당동 옥상)">
    <div class="wz-risk-checks">${WZ_RISK_WORDS.map((r) => `<label><input type="checkbox" value="${r}">${r}</label>`).join("")}</div>
    <div class="wz-form-pair">
      <input type="number" id="wzfCrew" min="0" step="1" inputmode="numeric" placeholder="작업인원 (명)">
      <input type="text" id="wzfPerson" placeholder="담당자 (선택)">
    </div>
    <div class="wz-pick-actions"><button type="button" id="wzfSave">저장</button>${ed ? '<button type="button" id="wzfMove">위치 다시 찍기</button>' : ""}<button type="button" class="wz-pick-cancel">취소</button></div>`;
  box.querySelector(".wz-pick-cancel").onclick = () => wzStartPick(null);
  if (ed) {
    // 원래 값 채우기
    document.getElementById("wzfPart").value = ed.part || "";
    document.getElementById("wzfWork").value = ed.work || "";
    document.getElementById("wzfLoc").value = ed.loc || "";
    document.getElementById("wzfCrew").value = ed.crew || "";
    document.getElementById("wzfPerson").value = ed.person || "";
    box.querySelectorAll(".wz-risk-checks input").forEach((c) => { c.checked = ed.risks.includes(c.value); });
    document.getElementById("wzfMove").onclick = () => wzStartPick({ mode: "setxy", item: ed });
  }
  document.getElementById("wzfWork").focus();
  document.getElementById("wzfSave").onclick = async () => {
    const work = document.getElementById("wzfWork").value.trim();
    if (!work) { document.getElementById("wzfWork").focus(); return; }
    const part = document.getElementById("wzfPart").value;
    const team = Object.keys(WZ_TEAMS).find((t) => WZ_TEAMS[t].parts.includes(part)) || "";
    const btn = document.getElementById("wzfSave");
    btn.disabled = true; btn.textContent = "저장 중…";
    const ok = await wzSaveAndRefresh(ed ? "edit" : "add", {
      ...(ed ? { row: ed.row, origWork: ed.work } : {}),
      date: document.getElementById("wzfDate").value, zone: zone.name, team, part, work,
      loc: document.getElementById("wzfLoc").value.trim(),
      risks: [...box.querySelectorAll(".wz-risk-checks input:checked")].map((c) => c.value),
      person: document.getElementById("wzfPerson").value.trim(),
      crew: parseInt(document.getElementById("wzfCrew").value, 10) || "", x, y,
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
  airSetupOnce();
  // 선박은 아래 VesselFinder 지도에서 보여 주므로 여기서는 항공기만 불러온다
  loadPlanes();
  refreshVesselFinderOnce();
}

/* ---------- 항공기: 실시간 지도(iframe) / 요약 지도 전환 ---------- */
const AIR_LIVE_URL = "https://adsb.lol/?lat=32.0&lon=45.0&zoom=6&hideSidebar&hideButtons";
const AIR_LIVE_OPEN = "https://adsb.lol/?lat=32.0&lon=45.0&zoom=6";
const IRAQ_AIRPORTS = [
  { name: "바그다드 국제공항", code: "BGW", lat: 33.262, lon: 44.235 },
  { name: "바스라 국제공항", code: "BSR", lat: 30.549, lon: 47.662 },
  { name: "에르빌 국제공항", code: "EBL", lat: 36.238, lon: 43.963 },
  { name: "술라이마니야 국제공항", code: "ISU", lat: 35.562, lon: 45.317 },
  { name: "나자프 국제공항", code: "NJF", lat: 31.990, lon: 44.404 },
];
let airSetupDone = false, airView = "live", airLiveTimer = null;

function airSetupOnce() {
  if (airSetupDone) return;
  airSetupDone = true;
  document.getElementById("airLiveOpen").href = AIR_LIVE_OPEN;
  try { airView = localStorage.getItem("airView") || "live"; } catch (e) {}
  document.querySelectorAll(".air-tab").forEach((b) => b.onclick = () => airShow(b.dataset.air));
  // 공항 표시
  const apLayer = L.layerGroup().addTo(shipsMapInstance);
  IRAQ_AIRPORTS.forEach((a) => {
    L.marker([a.lat, a.lon], {
      icon: L.divIcon({ className: "airport-wrap", html: `<span class="airport-pin">✈</span><span class="airport-label">${escapeHtml(a.code)}</span>`, iconSize: [0, 0] }),
      zIndexOffset: -100,
    }).bindPopup(`<b>${escapeHtml(a.name)}</b> (${escapeHtml(a.code)})`).addTo(apLayer);
  });
  airShow(airView);
}

function airShow(v) {
  airView = v;
  try { localStorage.setItem("airView", v); } catch (e) {}
  document.querySelectorAll(".air-tab").forEach((b) => b.classList.toggle("active", b.dataset.air === v));
  document.getElementById("airLiveBox").hidden = v !== "live";
  document.getElementById("airSummaryBox").hidden = v !== "summary";
  if (v === "live") {
    const f = document.getElementById("airLiveFrame");
    if (!f.src) f.src = AIR_LIVE_URL; // 처음 볼 때만 불러온다
  } else {
    setTimeout(() => shipsMapInstance && shipsMapInstance.invalidateSize(), 50);
    loadPlanes();
  }
}

/* ---------- 요약 지도: 브라우저에서 adsb.lol 실시간 조회 → 실패하면 planes.json ---------- */
const AIR_LIVE_POINTS = [ // 반경 250해리(약 460km) 원 여러 개로 중동을 덮는다
  [33.3, 44.4], [30.0, 47.7], [36.3, 40.0], [26.0, 50.5], [25.0, 45.0], [32.0, 36.5], [24.5, 55.0], [35.5, 51.5],
];

async function fetchLivePlanes() {
  const results = await Promise.allSettled(AIR_LIVE_POINTS.map(([lat, lon]) =>
    fetch(`https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/250`, { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error("응답 " + r.status);
      return r.json();
    })));
  const ok = results.filter((r) => r.status === "fulfilled");
  if (!ok.length) throw new Error("adsb.lol 실시간 조회 실패");
  const map = new Map();
  ok.forEach((r) => (r.value.ac || []).forEach((a) => {
    if (a.lat == null || a.lon == null || a.alt_baro === "ground") return;
    if ((a.seen_pos || 0) > 60) return;
    const id = (a.hex || "").replace("~", "").toLowerCase();
    if (!id || map.has(id)) return;
    map.set(id, {
      icao24: id,
      callsign: (a.flight || "").trim() || a.r || id,
      type: a.t || "",
      lat: a.lat, lon: a.lon,
      altitude: typeof a.alt_baro === "number" ? a.alt_baro * 0.3048 : null,
      speed: typeof a.gs === "number" ? a.gs * 0.514444 : null,
      heading: a.track != null ? a.track : a.true_heading,
      source: "adsb.lol 실시간",
    });
  }));
  return { planes: [...map.values()], generatedAt: new Date().toISOString(), live: true };
}

async function loadPlanes() {
  let data = null;
  try {
    data = await fetchLivePlanes();
  } catch (err) {
    console.warn(err.message, "→ 저장된 planes.json 사용");
    try {
      const res = await fetch("planes.json", { cache: "no-store" });
      if (!res.ok) throw new Error("planes.json 로드 실패");
      data = await res.json();
    } catch (e) {
      console.error(e);
    }
  }
  if (data) renderPlanes(data);
  // 요약 지도를 보고 있는 동안만 1분마다 새로고침
  clearTimeout(airLiveTimer);
  airLiveTimer = setTimeout(function check() {
    const onTab = document.getElementById("view-ships")?.classList.contains("active");
    if (onTab && airView === "summary" && document.visibilityState === "visible") loadPlanes();
    else airLiveTimer = setTimeout(check, 60 * 1000); // 안 보고 있으면 불러오지 않고 1분 뒤 다시 확인
  }, 60 * 1000);
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
    meta.textContent = data.live
      ? `항공기 ${planes.length}대 · 실시간 (adsb.lol) · ${new Intl.DateTimeFormat("ko-KR", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date())} (바그다드) 기준, 1분마다 갱신`
      : `항공기 ${planes.length}대 표시 중${genText} · 실시간 연결이 안 돼 저장된 데이터를 표시합니다`;
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
  // 준공된 현장은 빼고, 수주·공사중 현장만 보여 준다
  const projects = (data.projects || []).filter((p) => globalCompanies[p.company] && typeof p.lat === "number" && typeof p.lon === "number"
    && p.status !== "준공");
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


/* ==========================================================
   배너 마스코트: 배너 위를 걸어 다니고, 가끔 폴짝 뛰고, 누르면 한마디
   (그림 파일은 그대로 쓰고 움직임만 준다)
   - 걸음: 속도에 맞춰 한 걸음마다 한 번씩 통통 튀고, 걸음마다 좌우로 살짝 기운다
   - 출발·정지 때 천천히 빨라지고 느려진다 / 돌아설 때 멈칫한 뒤 몸을 돌린다
   - 그림자가 발 밑에서 같이 움직인다
   ========================================================== */
(function mascotRunner() {
  const bar = document.querySelector(".topbar");
  const home = document.querySelector(".brand-mascot");
  if (!bar || !home) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const runner = document.createElement("div");
  runner.className = "mascot-runner";
  runner.innerHTML = `<div class="mascot-shadow"></div>
    <div class="mascot-body"><div class="mascot-step"><img src="${home.getAttribute("src")}" alt="" draggable="false"></div></div>
    <div class="mascot-bubble" hidden></div>`;
  bar.appendChild(runner);
  home.classList.add("mascot-home");
  const body = runner.querySelector(".mascot-body");
  const step = runner.querySelector(".mascot-step");
  const img = runner.querySelector("img");
  const shadow = runner.querySelector(".mascot-shadow");
  const bubble = runner.querySelector(".mascot-bubble");

  const LINES = ["안전제일!", "보호구 착용 확인!", "오늘도 무재해!", "안전벨트 체결!", "물 자주 마셔요!", "작업 전 TBM!", "위험하면 멈추기!"];
  const MAX_SPEED = 30;      // px/초 (천천히 걷기)
  const STEPS_PER_PX = 0.05; // 이동 거리당 걸음 수 → 빨리 걸으면 걸음도 빨라진다
  let x = 0, dir = 1, facing = 1, speed = 0, target = 0, phase = 0, breath = 0;
  let minX = 0, maxX = 0, last = 0, hover = false, busyUntil = 0, mode = "idle";

  function bounds() {
    const b = bar.getBoundingClientRect();
    const h = home.getBoundingClientRect();
    const status = bar.querySelector(".topbar-status");
    minX = h.left - b.left;
    const right = status ? status.getBoundingClientRect().left - b.left : b.width;
    maxX = Math.max(minX, right - runner.offsetWidth - 16);
    x = Math.min(Math.max(x || minX, minX), maxX);
    runner.style.top = (h.top - b.top) + "px";
  }

  // 날씨에 따라 다른 대사를 쓰게 (window.hseMascotLines 가 있으면 70% 확률로 그쪽에서 고름)
  const pickLine = () => {
    const w = window.hseMascotLines;
    const pool = w && w.length && Math.random() < 0.7 ? w : LINES;
    return pool[Math.floor(Math.random() * pool.length)];
  };
  function say(text) {
    bubble.textContent = text;
    bubble.hidden = false;
    bubble.classList.toggle("left", facing < 0 && x > minX + 120);
    clearTimeout(say.t);
    say.t = setTimeout(() => { bubble.hidden = true; }, 2600);
  }

  function jump(big) {
    body.classList.remove("jump", "jump-big");
    void body.offsetWidth;
    body.classList.add(big ? "jump-big" : "jump");
  }

  function turn(newDir) {
    if (newDir === facing) return;
    dir = newDir;
    target = 0;
    mode = "turn";
    busyUntil = performance.now() + 700;
    setTimeout(() => { facing = newDir; img.style.setProperty("--flip", facing); }, 250);
  }

  function decide(now) {
    if (maxX <= minX) { mode = "idle"; target = 0; busyUntil = now + 4000; return; }
    const r = Math.random();
    if (r < 0.6) {
      let d = facing;
      if (x <= minX + 4) d = 1; else if (x >= maxX - 4) d = -1; else if (Math.random() < 0.3) d = -facing;
      if (d !== facing) { turn(d); return; }
      mode = "walk"; dir = d; target = MAX_SPEED * (0.75 + Math.random() * 0.35);
      busyUntil = now + 3000 + Math.random() * 5000;
    } else if (r < 0.75) {
      mode = "idle"; target = 0; busyUntil = now + 1800;
      setTimeout(() => jump(false), 350); // 멈춘 뒤 폴짝
    } else if (r < 0.85) {
      mode = "idle"; target = 0; busyUntil = now + 3000;
      say(pickLine());
    } else {
      mode = "idle"; target = 0; busyUntil = now + 2000 + Math.random() * 3000;
    }
  }

  function tick(t) {
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
    last = t;
    if (!hover && t > busyUntil) decide(t);
    if (hover) target = 0;

    // 부드럽게 빨라지고 느려지기
    speed += (target - speed) * Math.min(1, dt * 3);
    if (speed < 0.3 && target === 0) speed = 0;
    x += dir * speed * dt;
    if (x <= minX) { x = minX; if (mode === "walk") { busyUntil = 0; } }
    if (x >= maxX) { x = maxX; if (mode === "walk") { busyUntil = 0; } }

    // 걸음: 한 걸음(π)마다 한 번 튀고, 걸음마다 좌우로 번갈아 기울기
    const walkAmt = Math.min(1, speed / MAX_SPEED);
    phase += speed * dt * STEPS_PER_PX * Math.PI;
    const bob = Math.abs(Math.sin(phase)) * 5 * walkAmt;
    const tilt = Math.sin(phase) * 3 * walkAmt;
    // 쉴 때: 천천히 숨쉬기
    breath += dt * 2.2;
    const squash = 1 - (1 - walkAmt) * 0.015 * (1 + Math.sin(breath));

    runner.style.transform = `translateX(${x.toFixed(1)}px)`;
    step.style.transform = `translateY(${(-bob).toFixed(2)}px) rotate(${(tilt * facing).toFixed(2)}deg) scaleY(${squash.toFixed(4)})`;
    shadow.style.transform = `scaleX(${(1 - bob / 18).toFixed(3)})`;
    shadow.style.opacity = (0.35 - bob / 40).toFixed(3);
    requestAnimationFrame(tick);
  }

  window.hseMascotSay = (t) => say(t);
  runner.addEventListener("mouseenter", () => { hover = true; });
  runner.addEventListener("mouseleave", () => { hover = false; busyUntil = performance.now() + 800; });
  runner.addEventListener("click", () => {
    jump(true);
    say(pickLine());
  });

  const start = () => { bounds(); busyUntil = performance.now() + 1500; requestAnimationFrame(tick); };
  if (home.complete) start(); else home.addEventListener("load", start, { once: true });
  window.addEventListener("resize", bounds);
})();


/* ==========================================================
   대분류(종합현황·안전·보건·환경·기타) → 소분류 탭
   - 소분류 버튼은 예전 탭 버튼(.tab-btn)을 그대로 써서 기존 기능이 모두 그대로 동작한다
   - 보건·환경 화면 일부는 종합현황의 카드를 잠깐 빌려 와서 보여 주고,
     종합현황으로 돌아가면 제자리로 돌려놓는다 (같은 카드를 두 벌 만들지 않기 위해)
   ========================================================== */
(function navGroups() {
  const groupBtns = document.querySelectorAll(".group-btn");
  const subBar = document.getElementById("subBar");
  if (!groupBtns.length || !subBar) return;
  const lastView = {}; // 대분류마다 마지막으로 본 소분류

  function showGroup(g) {
    groupBtns.forEach((b) => b.classList.toggle("active", b.dataset.group === g));
    subBar.querySelectorAll(".sub-row").forEach((r) => { r.hidden = r.dataset.group !== g || g === "home"; });
    subBar.hidden = g === "home";
  }

  // 빌려 온 카드 관리
  const borrowed = []; // { el, marker }
  function restoreAll() {
    borrowed.forEach(({ el, marker }) => {
      if (el.previousSibling !== marker) marker.parentNode.insertBefore(el, marker.nextSibling);
    });
  }
  function borrowInto(view) {
    const grid = view.querySelector(".grid");
    (view.dataset.borrow || "").split(",").map((x) => x.trim()).filter(Boolean).forEach((sel) => {
      let rec = borrowed.find((r) => r.sel === sel);
      if (!rec) {
        const el = document.querySelector(`#view-dashboard ${sel}`);
        if (!el) return;
        const marker = document.createComment(" 원래 자리: " + sel);
        el.parentNode.insertBefore(marker, el);
        rec = { sel, el, marker };
        borrowed.push(rec);
      }
      grid.appendChild(rec.el);
    });
  }

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest(".sub-row");
      const g = row ? row.dataset.group : "home";
      lastView[g] = btn.dataset.view;
      showGroup(g);
      const view = document.getElementById(btn.dataset.view);
      restoreAll();
      if (view && view.classList.contains("view-borrow")) borrowInto(view);
      // 빌려 온 카드 안의 그래프·지도가 크기를 다시 잡도록
      window.dispatchEvent(new Event("resize"));
    });
  });

  groupBtns.forEach((gb) => gb.addEventListener("click", () => {
    const g = gb.dataset.group;
    const row = subBar.querySelector(`.sub-row[data-group="${g}"]`);
    const target = (lastView[g] && row.querySelector(`.tab-btn[data-view="${lastView[g]}"]`)) || row.querySelector(".tab-btn");
    if (target) target.click();
  }));

  showGroup("home");
})();


/* ==========================================================
   환경 > 날씨·대기환경 : 작업 안전 기상 지표 (비스마야 vs 서울)
   ① 돌풍(순간풍속)과 크레인 작업 기준  ② 모래먼지·시정
   ③ 미국 대기질 지수(US AQI)  ④ WBGT 추정(더위 스트레스)
   ========================================================== */
const HSEWX_SITES = [
  { key: "bnc", name: "비스마야", lat: BISMAYAH_LAT, lon: BISMAYAH_LON },
  { key: "sel", name: "서울", lat: 37.5665, lon: 126.978 },
];
let hsewxLoaded = 0;

// 등급표: [상한, 이름, 색]
const HSEWX_BANDS = {
  gust: [[10, "정상", "#35d0c0"], [20, "설치·해체 중지", "#f2a93b"], [Infinity, "운전 중지", "#e5484d"]],
  dust: [[30, "좋음", "#35d0c0"], [80, "보통", "#8bd35f"], [150, "나쁨", "#f2a93b"], [Infinity, "매우 나쁨", "#e5484d"]],
  vis: [[1, "매우 나쁨", "#e5484d"], [5, "나쁨", "#f2a93b"], [10, "보통", "#8bd35f"], [Infinity, "좋음", "#35d0c0"]],
  aqi: [[50, "좋음", "#35d0c0"], [100, "보통", "#8bd35f"], [150, "민감군 나쁨", "#f2a93b"], [200, "나쁨", "#ff7e79"], [300, "매우 나쁨", "#e5484d"], [Infinity, "위험", "#b11f4a"]],
  wbgt: [[21, "거의 안전", "#35d0c0"], [25, "주의", "#8bd35f"], [28, "경계", "#ffd166"], [31, "엄중 경계", "#f2a93b"], [Infinity, "위험", "#e5484d"]],
};
function hsewxBand(kind, v) {
  if (v == null || !isFinite(v)) return { name: "–", color: "#5b6675" };
  const b = HSEWX_BANDS[kind].find(([max]) => v < max) || HSEWX_BANDS[kind][HSEWX_BANDS[kind].length - 1];
  return { name: b[1], color: b[2] };
}

// WBGT 간이 추정식 (호주 기상청 방식, 기온·습도로 계산하는 그늘 기준 값)
function hsewxWbgt(t, rh) {
  if (t == null || rh == null) return null;
  const e = (rh / 100) * 6.105 * Math.exp((17.27 * t) / (237.7 + t));
  return 0.567 * t + 0.393 * e + 3.94;
}

async function hsewxFetch(site) {
  const q = `latitude=${site.lat}&longitude=${site.lon}&timezone=auto`;
  const [wx, aq] = await Promise.all([
    fetch(`https://api.open-meteo.com/v1/forecast?${q}&wind_speed_unit=ms&current=temperature_2m,relative_humidity_2m,apparent_temperature,dew_point_2m,wind_speed_10m,wind_gusts_10m,visibility,shortwave_radiation,cloud_cover,pressure_msl&hourly=wind_gusts_10m&forecast_hours=24`).then((r) => r.json()),
    fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&current=us_aqi,pm10,pm2_5,dust,aerosol_optical_depth,carbon_monoxide,nitrogen_dioxide`).then((r) => r.json()),
  ]);
  const c = wx.current || {}, a = aq.current || {};
  const gustNext = (wx.hourly && wx.hourly.wind_gusts_10m || []).filter((x) => x != null);
  return {
    time: c.time, tz: wx.timezone_abbreviation || "",
    temp: c.temperature_2m, rh: c.relative_humidity_2m, feel: c.apparent_temperature, dew: c.dew_point_2m,
    wind: c.wind_speed_10m, gust: c.wind_gusts_10m, gustMax24: gustNext.length ? Math.max(...gustNext) : null,
    vis: c.visibility != null ? c.visibility / 1000 : null, rad: c.shortwave_radiation, cloud: c.cloud_cover, pres: c.pressure_msl,
    aqi: a.us_aqi, pm10: a.pm10, pm25: a.pm2_5, dust: a.dust, aod: a.aerosol_optical_depth, co: a.carbon_monoxide, no2: a.nitrogen_dioxide,
    wbgt: hsewxWbgt(c.temperature_2m, c.relative_humidity_2m),
  };
}

function hsewxFmt(v, d = 0) { return v == null || !isFinite(v) ? "–" : Number(v).toFixed(d); }

function hsewxCard(title, unit, kind, key, d, data, extra) {
  const rows = HSEWX_SITES.map((s) => {
    const v = data[s.key] ? data[s.key][key] : null;
    const b = hsewxBand(kind, v);
    return `<div class="hsewx-row">
      <span class="hsewx-site">${s.name}</span>
      <b style="color:${b.color}">${hsewxFmt(v, d)}<small>${unit}</small></b>
      <span class="hsewx-badge" style="--c:${b.color}">${b.name}</span>
    </div>`;
  }).join("");
  return `<div class="hsewx-card"><div class="hsewx-card-title">${title}</div>${rows}${extra || ""}</div>`;
}

async function loadHsewx() {
  if (Date.now() - hsewxLoaded < 10 * 60 * 1000) return; // 10분 안에는 다시 부르지 않는다
  const cards = document.getElementById("hsewxCards");
  if (!cards) return;
  const results = await Promise.allSettled(HSEWX_SITES.map(hsewxFetch));
  const data = {};
  results.forEach((r, i) => { if (r.status === "fulfilled") data[HSEWX_SITES[i].key] = r.value; });
  if (!Object.keys(data).length) {
    cards.innerHTML = '<p class="skeleton">기상 지표를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.</p>';
    return;
  }
  hsewxLoaded = Date.now();
  const b = data.bnc || {};

  // ① 돌풍 카드: 비스마야 크레인 작업 판단 문구
  const g = b.gust, gmax = b.gustMax24;
  const crane = g == null ? "" : g > 20
    ? "⛔ 지금 순간풍속 20m/s 초과: 타워크레인 운전 작업 중지"
    : g > 10 ? "⚠ 지금 순간풍속 10m/s 초과: 타워크레인 설치·수리·점검·해체 작업 중지"
    : "✅ 크레인 작업 가능 (순간풍속 10m/s 이하)";
  const gustExtra = `<p class="hsewx-note">${crane}${gmax != null ? `<br>비스마야 24시간 내 최대 순간풍속 예보 <b>${hsewxFmt(gmax, 1)} m/s</b>${gmax > 10 ? " · 작업 계획 시 주의" : ""}` : ""}</p>`;

  // ② 모래먼지 + 시정
  const visRows = HSEWX_SITES.map((s) => {
    const v = data[s.key] ? data[s.key].vis : null; const bd = hsewxBand("vis", v);
    return `<span>${s.name} 시정 <b style="color:${bd.color}">${hsewxFmt(v, 1)} km</b></span>`;
  }).join(" · ");
  const dustAlert = (b.dust != null && b.dust > 150) || (b.vis != null && b.vis < 1)
    ? "🌪 모래폭풍 수준: 옥외작업 중지 검토, 방진마스크 착용, 장비·차량 운행 주의"
    : (b.dust != null && b.dust > 80) || (b.vis != null && b.vis < 5)
      ? "😷 먼지 많음: 방진마스크 착용, 시야 확보 주의" : "";
  const dustExtra = `<p class="hsewx-note">${visRows}${dustAlert ? `<br><b class="hsewx-alert">${dustAlert}</b>` : ""}</p>`;

  // ④ WBGT
  const wb = b.wbgt;
  const wbAdvice = wb == null ? "" : wb >= 31 ? "위험: 옥외 중작업 중지 검토, 매시간 충분한 휴식"
    : wb >= 28 ? "엄중 경계: 작업·휴식 시간 조정, 물·그늘·휴식 철저"
    : wb >= 25 ? "경계: 규칙적인 물 섭취와 휴식" : wb >= 21 ? "주의: 수분 보충" : "거의 안전";
  const wbExtra = `<p class="hsewx-note">비스마야: ${wbAdvice}<br><span class="hsewx-dim">기온·습도로 계산한 그늘 기준 추정치이며, 햇볕 아래에서는 보통 2~3℃ 더 높습니다</span></p>`;

  cards.innerHTML =
    hsewxCard("💨 순간풍속(돌풍)", " m/s", "gust", "gust", 1, data, gustExtra) +
    hsewxCard("🌪 모래먼지", " ㎍/㎥", "dust", "dust", 0, data, dustExtra) +
    hsewxCard("🌫 대기질 지수 (US AQI)", "", "aqi", "aqi", 0, data,
      `<p class="hsewx-note hsewx-dim">미세먼지·오존·가스 농도를 합친 종합 점수 (0~50 좋음 · 51~100 보통 · 101 이상 나쁨)</p>`) +
    hsewxCard("🌡 WBGT 추정 (더위 스트레스)", " ℃", "wbgt", "wbgt", 1, data, wbExtra);

  // 세부 비교표
  const rows = [
    ["기온", "temp", "℃", 1], ["체감온도", "feel", "℃", 1], ["습도", "rh", "%", 0], ["이슬점", "dew", "℃", 1],
    ["평균 풍속", "wind", "m/s", 1], ["순간풍속", "gust", "m/s", 1], ["시정", "vis", "km", 1],
    ["일사량", "rad", "W/㎡", 0], ["구름양", "cloud", "%", 0], ["기압", "pres", "hPa", 0],
    ["미세먼지 PM10", "pm10", "㎍/㎥", 0], ["초미세먼지 PM2.5", "pm25", "㎍/㎥", 0], ["모래먼지", "dust", "㎍/㎥", 0],
    ["연무(에어로졸 광학두께)", "aod", "", 2], ["일산화탄소", "co", "㎍/㎥", 0], ["이산화질소", "no2", "㎍/㎥", 0],
  ];
  document.getElementById("hsewxTable").innerHTML = `
    <thead><tr><th>항목</th>${HSEWX_SITES.map((s) => `<th>${s.name}</th>`).join("")}<th>차이 (비스마야 − 서울)</th></tr></thead>
    <tbody>${rows.map(([label, key, unit, d]) => {
      const a = data.bnc ? data.bnc[key] : null, c = data.sel ? data.sel[key] : null;
      const diff = a != null && c != null ? a - c : null;
      return `<tr><td>${label}${unit ? ` <small>(${unit})</small>` : ""}</td><td>${hsewxFmt(a, d)}</td><td>${hsewxFmt(c, d)}</td>
        <td class="${diff > 0 ? "hsewx-up" : diff < 0 ? "hsewx-down" : ""}">${diff == null ? "–" : (diff > 0 ? "+" : "") + diff.toFixed(d)}</td></tr>`;
    }).join("")}</tbody>`;

  const t = (k) => data[k] && data[k].time ? `${data[k].time.slice(11, 16)}` : "–";
  document.getElementById("hsewxMeta").textContent =
    `Open-Meteo 날씨·대기질 API · 기준 시각: 비스마야 ${t("bnc")} (현지), 서울 ${t("sel")} (현지) · 10분마다 갱신 · ` +
    `크레인 기준: 산업안전보건기준에 관한 규칙(순간풍속 10m/s·20m/s) · WBGT 구간: 일본 환경성 지침 · 먼지 구간: 한국 PM10 예보 기준 준용`;
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => { if (btn.dataset.view === "view-env-weather") loadHsewx(); });
});
setInterval(() => {
  if (document.getElementById("view-env-weather")?.classList.contains("active")) { hsewxLoaded = 0; loadHsewx(); }
}, 10 * 60 * 1000);


/* ---------------- 이라크 보건부·환경부 소식 (구글 Apps Script가 모아 번역한 기사) ---------------- */
let inewsCache = null, inewsAt = 0;

async function loadIraqNews(force) {
  const lists = document.querySelectorAll(".inews-list");
  if (!lists.length) return;
  if (!force && inewsCache && Date.now() - inewsAt < 10 * 60 * 1000) return renderIraqNews(inewsCache);
  let data = null, err = "";
  try {
    const cfg = await (await fetch("work-zones.json", { cache: "no-store" })).json();
    const url = (cfg.appsScriptUrl || "").trim();
    if (!url) throw new Error("Apps Script 주소(appsScriptUrl)가 없습니다");
    const res = await fetch(url + (url.includes("?") ? "&" : "?") + "action=news&t=" + Date.now());
    data = await res.json();
    if (!data.ok) throw new Error(data.error || "불러오기 실패");
  } catch (e) {
    err = e.message;
  }
  if (!data) {
    lists.forEach((l) => { l.innerHTML = `<p class="skeleton">기사를 불러오지 못했습니다 (${escapeHtml(err)})</p>`; });
    return;
  }
  inewsCache = data; inewsAt = Date.now();
  renderIraqNews(data);
}

function renderIraqNews(data) {
  const fmt = (d) => (d || "").slice(0, 16).replace("T", " ");
  document.querySelectorAll(".inews-list").forEach((list) => {
    const items = (data.items || []).filter((n) => n.topic === list.dataset.topic);
    if (!items.length) {
      list.innerHTML = `<p class="skeleton">아직 모은 기사가 없습니다. Apps Script에서 setupNewsTrigger를 한 번 실행하면 6시간마다 모입니다.</p>`;
      return;
    }
    list.innerHTML = items.map((n, i) => {
      const ar = /arab/i.test(n.lang || "");
      const body = (n.bodyKo || "").split(/\n+/).filter(Boolean);
      return `
      <article class="inews-item">
        ${n.image ? `<img class="inews-img" src="${escapeHtml(n.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
        <div class="inews-main">
          <div class="inews-meta-row"><span class="inews-date">${escapeHtml(fmt(n.date))}</span><span class="inews-src">${escapeHtml(n.source || "")}</span></div>
          <h3 class="inews-title">${escapeHtml(n.titleKo || n.title)}</h3>
          ${body.length ? `<div class="inews-body${body.join("").length > 260 ? " clamp" : ""}">${body.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}</div>
            ${body.join("").length > 260 ? `<button type="button" class="inews-more">더 보기 ▾</button>` : ""}` : ""}
          <details class="inews-orig"><summary>원문 보기</summary>
            <p ${ar ? 'dir="rtl" lang="ar"' : ""}><b>${escapeHtml(n.title)}</b></p>
            ${n.body ? `<p ${ar ? 'dir="rtl" lang="ar"' : ""}>${escapeHtml(n.body)}</p>` : ""}
            ${n.link ? `<a href="${escapeHtml(n.link)}" target="_blank" rel="noopener noreferrer">원문 기사 페이지 ↗</a>` : ""}
          </details>
        </div>
      </article>`;
    }).join("");
    // 보건부·환경부 목록이 같은 번호를 쓰면 엉뚱한 기사가 펼쳐지므로, 버튼 바로 앞의 본문을 펼친다
    list.querySelectorAll(".inews-more").forEach((b) => b.onclick = () => {
      const el = b.previousElementSibling;
      const open = el.classList.toggle("clamp");
      b.textContent = open ? "더 보기 ▾" : "접기 ▴";
    });
    const meta = list.parentElement.querySelector(".inews-meta");
    if (meta && data.updatedAt) {
      meta.textContent = "이라크 언론 기사(GDELT 검색)를 모아 구글 번역으로 한국어로 옮긴 참고 자료입니다 · 번역은 기계 번역이라 어색할 수 있습니다 · 마지막 수집: " +
        new Intl.DateTimeFormat("ko-KR", { timeZone: TIMEZONE, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(data.updatedAt));
    }
  });
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (["view-iraq-moh", "view-iraq-moen", "view-iraq-cd"].includes(btn.dataset.view)) loadIraqNews(false);
  });
});


/* ==========================================================
   보건 > 국내 감염병 현황 (kdca-infectious.json · 질병관리청 전수신고)
   ========================================================== */
const KDCA_GRADE_COLOR = { "제1급": "#e5484d", "제2급": "#f2a93b", "제3급": "#4fb4ff" };
let kdcaLoaded = false;

function kdcaDelta(now, before) {
  const d = now - before;
  if (!before && !now) return '<span class="kdca-flat">–</span>';
  if (d === 0) return '<span class="kdca-flat">0</span>';
  const pct = before ? ` (${d > 0 ? "+" : ""}${Math.round((d / before) * 100)}%)` : "";
  return `<span class="${d > 0 ? "kdca-up" : "kdca-down"}">${d > 0 ? "▲" : "▼"} ${Math.abs(d).toLocaleString()}${pct}</span>`;
}

async function loadKdca() {
  if (kdcaLoaded) return;
  let d;
  try {
    const res = await fetch("kdca-infectious.json", { cache: "no-store" });
    if (!res.ok) throw new Error("없음");
    d = await res.json();
  } catch (e) {
    document.getElementById("kdcaGrades").innerHTML =
      '<p class="skeleton">아직 통계가 없습니다. GitHub Actions에서 "Update KDCA infectious disease stats"를 한 번 실행하면 표시됩니다.</p>';
    return;
  }
  kdcaLoaded = true;
  const bw = d.baseWeek, md = (s) => s.slice(5).replace("-", "/");
  document.getElementById("kdcaWeek").textContent = `· ${bw.label} (${md(bw.start)}~${md(bw.end)}) 기준`;

  // 1급 감염병 경보
  const alert = document.getElementById("kdcaAlert");
  if (d.grade1Recent && d.grade1Recent.length) {
    alert.className = "kdca-alert on";
    alert.innerHTML = `⚠ 최근 4주 제1급 감염병 신고: ` + d.grade1Recent.map((g) =>
      `<b>${escapeHtml(g.name)}</b> ${g.total}건 <small>(${g.weeks.map((w) => escapeHtml(w.week.replace(/^\d+년 /, ""))).join(", ")})</small>`).join(" · ");
  } else {
    alert.className = "kdca-alert ok";
    alert.textContent = "최근 4주간 제1급 감염병(에볼라, 페스트, 탄저 등) 신고 없음";
  }

  // 급별 카드 + 추이 막대
  document.getElementById("kdcaGrades").innerHTML = ["제1급", "제2급", "제3급"].map((g) => {
    const v = d.grades[g] || { base: 0, prev: 0, provisional: 0, trend: [], diseases: 0, outnatn: 0 };
    const max = Math.max(1, ...v.trend);
    const c = KDCA_GRADE_COLOR[g];
    return `<div class="kdca-card" style="--c:${c}">
      <div class="kdca-card-head"><b>${g} 감염병</b><span>${v.diseases}종</span></div>
      <div class="kdca-num">${v.base.toLocaleString()}<small>건</small></div>
      <div class="kdca-delta">전주 대비 ${kdcaDelta(v.base, v.prev)}</div>
      <div class="kdca-bars" title="최근 ${v.trend.length}주 추이">${v.trend.map((t, i) =>
        `<i style="height:${Math.max(4, (t / max) * 100)}%" title="${escapeHtml(d.trendWeeks[i] || "")}: ${t}건"></i>`).join("")}</div>
      <div class="kdca-foot">해외유입 ${v.outnatn}건 · 잠정(${escapeHtml(d.provisionalWeek.label.replace(/^\d+년 /, ""))}) ${v.provisional.toLocaleString()}건</div>
    </div>`;
  }).join("");

  // 상위 감염병 표
  document.getElementById("kdcaTop").innerHTML = `
    <thead><tr><th>#</th><th>감염병</th><th>급</th><th>${escapeHtml(bw.label.replace(/^\d+년 /, ""))}</th><th>전주 대비</th><th>해외유입</th></tr></thead>
    <tbody>${(d.top || []).slice(0, 10).map((t, i) => `<tr>
      <td>${i + 1}</td><td>${escapeHtml(t.name)}</td>
      <td><span class="kdca-grade" style="--c:${KDCA_GRADE_COLOR[t.grade] || "#8996a6"}">${escapeHtml(t.grade.replace("제", ""))}</span></td>
      <td class="num">${t.base.toLocaleString()}</td><td class="num">${kdcaDelta(t.base, t.prev)}</td>
      <td class="num">${t.outnatn ? t.outnatn : "–"}</td></tr>`).join("") || '<tr><td colspan="6">신고 없음</td></tr>'}</tbody>`;

  document.getElementById("kdcaImported").innerHTML = (d.importedRecent4 || []).length
    ? d.importedRecent4.map((m) => `<li><span class="kdca-grade" style="--c:${KDCA_GRADE_COLOR[m.grade] || "#8996a6"}">${escapeHtml(m.grade.replace("제", ""))}</span>${escapeHtml(m.name)}<b>${m.count}건</b></li>`).join("")
    : "<li>최근 4주 해외유입 신고 없음</li>";

  document.getElementById("kdcaMeta").textContent =
    `출처: 질병관리청 전수신고 감염병 발생현황 (공공누리 제4유형) · 신고가 늦게 쌓이므로 진행 중인 주의 2주 전(${bw.label})을 기준으로 봅니다 · 마지막 수집: ` +
    new Intl.DateTimeFormat("ko-KR", { timeZone: TIMEZONE, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(d.generatedAt));
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => { if (btn.dataset.view === "view-health-kdca") loadKdca(); });
});


/* ==========================================================
   배경 사진 살리기
   ① 탭을 누르면 배경이 잠깐 보인 뒤 카드들이 차례로 떠오른다
   ② '배경 보기' 버튼: 누르면 카드가 사라지고 사진만 보인다 (다시 누르거나 Esc로 복귀)
   ③ 상황실 화면을 3분 동안 아무도 만지지 않으면 카드가 서서히 사라져 사진이 보이고,
      마우스를 움직이면 다시 나타난다
   ========================================================== */
(function backgroundShowcase() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const IDLE_MS = 3 * 60 * 1000;

  // ① 카드 차례로 나타나기
  function playEnter(view) {
    if (!view || reduce) return;
    view.querySelectorAll(".grid > .panel").forEach((p, i) => p.style.setProperty("--i", i));
    view.classList.remove("view-enter");
    void view.offsetWidth; // 애니메이션 다시 시작
    view.classList.add("view-enter");
  }
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => playEnter(document.getElementById(btn.dataset.view)));
  });
  playEnter(document.querySelector(".view.active")); // 처음 열 때도

  // ② 배경 보기 버튼
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "bg-peek-btn";
  btn.textContent = "배경 보기";
  btn.title = "카드를 잠시 숨기고 배경 사진을 봅니다 (Esc로 복귀)";
  document.body.appendChild(btn);
  let manual = false;
  function setReveal(on, byUser) {
    manual = on && byUser;
    document.body.classList.toggle("bg-reveal", on);
    btn.textContent = on ? "정보 다시 보기" : "배경 보기";
    if (!on) playEnter(document.querySelector(".view.active"));
  }
  btn.addEventListener("click", (e) => { e.stopPropagation(); setReveal(!document.body.classList.contains("bg-reveal"), true); });
  window.hseSetReveal = setReveal;
  window.hsePlayEnter = () => playEnter(document.querySelector(".view.active"));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("bg-reveal")) setReveal(false); });

  // ③ 오래 안 만지면 자동으로 배경 보이기
  let idleTimer = null;
  function wake() {
    if (window.hseKiosk && window.hseKiosk.running) { window.hseKiosk.stop(); }
    else if (document.body.classList.contains("bg-reveal") && !manual) setReveal(false);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (document.body.classList.contains("bg-reveal")) return;
      // 상황실 순환 모드가 있으면 그걸로, 없으면 배경만 보여 주기
      if (window.hseKiosk) window.hseKiosk.start(); else setReveal(true, false);
    }, IDLE_MS);
  }
  ["mousemove", "mousedown", "keydown", "touchstart", "wheel"].forEach((ev) =>
    document.addEventListener(ev, wake, { passive: true }));
  wake();
})();

/* 배경 사진이 배너 바로 아래에서 시작하도록 배너 높이를 CSS(--hdr)에 알려 준다 */
(function syncHeaderHeight() {
  const bar = document.querySelector(".topbar");
  if (!bar) return;
  const set = () => document.documentElement.style.setProperty("--hdr", bar.getBoundingClientRect().height + "px");
  set();
  window.addEventListener("resize", set);
  if (window.ResizeObserver) new ResizeObserver(set).observe(bar);
})();


/* ==========================================================
   배경 특수효과 (발표·상황실 모니터용)
   1) 실제 날씨 효과: 비스마야 현재 날씨에 따라 모래바람·빗줄기·아지랑이·밤하늘
   2) 상황실 순환 모드: 3분 동안 아무도 안 만지면 탭 사진이 바뀌며 핵심 숫자를 크게 보여 줌
   3) 사진 전환: 탭을 바꾸면 사진이 스르르 겹치며 넘어가고, 평소엔 아주 천천히 확대(켄 번즈)
   4) 첫 화면 인트로: 로고·상황실 이름이 잠깐 나타났다 사라지고 숫자가 올라감
   5) 경보 테두리: 중요한 경보가 있을 때만 화면 가장자리가 붉게 숨 쉬듯 빛남
   - 미리 보기: 주소 끝에 ?fx=dust 또는 ?fx=rain,night,heat,alert 를 붙이면 날씨와 상관없이 효과를 볼 수 있음
   - 컴퓨터에서 '움직임 줄이기'를 켠 사용자에게는 움직이는 효과를 끔
   ========================================================== */
(function hseEffects() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const params = new URLSearchParams(location.search);
  const forced = new Set((params.get("fx") || "").split(",").map((x) => x.trim()).filter(Boolean));
  const fetchJson = (u) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  /* ---------- 3) 사진 전환(크로스페이드) ---------- */
  const fadeLayer = document.createElement("div");
  fadeLayer.className = "bg-fade-layer";
  document.body.appendChild(fadeLayer);
  function crossfadeSnapshot() {
    if (reduce) return;
    const cs = getComputedStyle(document.body, "::before");
    fadeLayer.style.transition = "none";
    fadeLayer.style.backgroundImage = cs.backgroundImage;
    fadeLayer.style.backgroundSize = cs.backgroundSize;
    fadeLayer.style.backgroundPosition = cs.backgroundPosition;
    fadeLayer.style.transform = cs.transform === "none" ? "" : cs.transform;
    fadeLayer.style.opacity = "1";
    void fadeLayer.offsetWidth;
    requestAnimationFrame(() => {
      fadeLayer.style.transition = "opacity 1s ease";
      fadeLayer.style.opacity = "0";
    });
  }
  // 탭 버튼이 배경을 바꾸기 '전에' 지금 사진을 찍어 둔다 (캡처 단계에서 먼저 실행)
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".tab-btn");
    if (b && !b.classList.contains("active")) crossfadeSnapshot();
  }, true);

  /* ---------- 1) 실제 날씨 효과 ---------- */
  const canvas = document.createElement("canvas");
  canvas.className = "wx-canvas";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const chip = document.createElement("div");
  chip.className = "wx-chip";
  chip.hidden = true;
  document.body.appendChild(chip);

  const wx = { dust: 0, rain: 0, heat: 0, night: false, windTo: 90, windSpeed: 3, raw: null };
  let parts = [], stars = [], W = 0, H = 0, dpr = 1;

  function resize() {
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = Array.from({ length: 90 }, () => ({ x: Math.random() * W, y: Math.random() * H * 0.45, r: Math.random() * 1.2 + 0.3, p: Math.random() * 6 }));
    spawn();
  }

  function spawn() {
    const n = Math.round(wx.dust * 260) + Math.round(wx.rain * 180);
    parts = Array.from({ length: n }, (_, i) => newPart(i < Math.round(wx.dust * 260) ? "dust" : "rain", true));
  }
  function newPart(kind, anywhere) {
    const p = { kind, x: Math.random() * W, y: anywhere ? Math.random() * H : -20 };
    if (kind === "dust") {
      p.r = Math.random() * 1.8 + 0.6; p.a = Math.random() * 0.45 + 0.15;
      p.v = 0.6 + Math.random() * 0.8; p.wob = Math.random() * 6;
      p.streak = Math.random() < 0.18;
    } else {
      p.len = 14 + Math.random() * 12; p.v = 0.8 + Math.random() * 0.5;
    }
    return p;
  }

  function wind() {
    const rad = (wx.windTo * Math.PI) / 180; // 바람이 '불어 가는' 방향
    const speed = 25 + wx.windSpeed * 14;
    return { vx: Math.sin(rad) * speed, vy: -Math.cos(rad) * speed * 0.25 }; // 옆에서 보는 화면이라 세로 움직임은 약하게
  }

  let last = 0, running = false;
  function frame(t) {
    if (!running) return;
    const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    ctx.clearRect(0, 0, W, H);

    if (wx.night) {
      ctx.fillStyle = "rgba(4, 10, 30, 0.38)"; ctx.fillRect(0, 0, W, H);
      stars.forEach((s) => {
        const a = 0.35 + 0.35 * Math.sin(t / 900 + s.p);
        ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      });
    }
    if (wx.heat > 0) {
      ctx.fillStyle = `rgba(255, 140, 40, ${(0.05 * wx.heat).toFixed(3)})`; ctx.fillRect(0, 0, W, H);
      // 아지랑이: 아래에서 위로 천천히 올라가는 일렁이는 띠
      for (let k = 0; k < 7; k++) {
        const baseY = H - ((t / 40 + k * (H / 7)) % (H * 0.9));
        ctx.beginPath();
        for (let x = 0; x <= W; x += 24) {
          const y = baseY + Math.sin(x / 70 + t / 500 + k) * 6;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(255, 220, 170, ${(0.05 * wx.heat).toFixed(3)})`;
        ctx.lineWidth = 10; ctx.stroke();
      }
    }
    if (wx.dust > 0) {
      ctx.fillStyle = `rgba(196, 150, 80, ${(0.16 * wx.dust).toFixed(3)})`; ctx.fillRect(0, 0, W, H);
    }

    const w = wind();
    parts.forEach((p, i) => {
      if (p.kind === "dust") {
        p.x += w.vx * p.v * dt; p.y += (w.vy * p.v + Math.sin(t / 700 + p.wob) * 6) * dt;
        if (p.streak) {
          ctx.strokeStyle = `rgba(222, 190, 135, ${(p.a * 0.5).toFixed(3)})`; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - w.vx * 0.35, p.y - w.vy * 0.35); ctx.stroke();
        } else {
          ctx.fillStyle = `rgba(222, 190, 135, ${p.a.toFixed(3)})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        }
      } else {
        const vx = w.vx * 0.6, vy = 700 * p.v;
        p.x += vx * dt; p.y += vy * dt;
        ctx.strokeStyle = "rgba(190, 210, 235, 0.35)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - vx * 0.03, p.y - p.len); ctx.stroke();
      }
      if (p.x < -40 || p.x > W + 40 || p.y > H + 30 || p.y < -60) {
        const np = newPart(p.kind, false);
        if (p.kind === "dust") { np.x = w.vx >= 0 ? -20 : W + 20; np.y = Math.random() * H; }
        else { np.x = Math.random() * (W + 200) - 100; }
        parts[i] = np;
      }
    });
    requestAnimationFrame(frame);
  }
  function start() {
    const active = wx.dust > 0 || wx.rain > 0 || wx.heat > 0 || wx.night;
    canvas.style.display = active ? "" : "none";
    if (!active || reduce) { running = false; if (!active) ctx.clearRect(0, 0, W, H); return; }
    if (!running) { running = true; last = 0; requestAnimationFrame(frame); }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) running = false; else start();
  });
  window.addEventListener("resize", () => { resize(); });

  const DIRS = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
  async function loadWeather() {
    const lat = typeof BISMAYAH_LAT !== "undefined" ? BISMAYAH_LAT : 33.193;
    const lon = typeof BISMAYAH_LON !== "undefined" ? BISMAYAH_LON : 44.618;
    const [w, a] = await Promise.all([
      fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&wind_speed_unit=ms&current=temperature_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m`),
      fetchJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=dust,pm10`),
    ]);
    const c = (w && w.current) || {}, q = (a && a.current) || {};
    wx.raw = { temp: c.temperature_2m, feel: c.apparent_temperature, isDay: c.is_day, gust: c.wind_gusts_10m, dust: q.dust, pm10: q.pm10, wind: c.wind_speed_10m, dir: c.wind_direction_10m };
    window.hseWx = wx.raw;
    window.dispatchEvent(new CustomEvent("hse-weather", { detail: wx.raw }));
    const code = c.weather_code || 0;
    const rainy = (c.precipitation || 0) > 0.05 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
    wx.dust = Math.max(0, Math.min(1, ((q.dust || 0) - 40) / 200, ((q.pm10 || 0) - 120) / 300));
    wx.rain = rainy ? 1 : 0;
    wx.heat = c.temperature_2m >= 40 ? Math.min(1, (c.temperature_2m - 38) / 8) : 0;
    wx.night = c.is_day === 0;
    wx.windTo = ((c.wind_direction_10m || 270) + 180) % 360;
    wx.windSpeed = c.wind_speed_10m || 3;
    applyForced();
    resize(); start(); updateChip(); checkAlerts();
  }
  function applyForced() {
    if (forced.has("dust")) wx.dust = Math.max(wx.dust, 0.85);
    if (forced.has("rain")) wx.rain = 1;
    if (forced.has("heat")) wx.heat = 1;
    if (forced.has("night")) wx.night = true;
  }
  function updateChip() {
    const r = wx.raw || {};
    const tags = [];
    if (wx.dust > 0) tags.push("모래바람");
    if (wx.rain) tags.push("비");
    if (wx.heat > 0) tags.push("폭염 아지랑이");
    if (wx.night) tags.push("밤");
    if (!tags.length) { chip.hidden = true; return; }
    const dir = r.dir != null ? DIRS[Math.round(r.dir / 45) % 8] + "풍 " : "";
    chip.hidden = false;
    chip.innerHTML = `<i></i>현장 실시간 효과 · ${tags.join(" · ")}${r.temp != null ? ` · ${Math.round(r.temp)}℃` : ""}${r.wind != null ? ` · ${dir}${r.wind.toFixed(1)}m/s` : ""}${forced.size ? " <b>(미리 보기)</b>" : ""}`;
  }

  /* ---------- 5) 경보 테두리 ---------- */
  const glow = document.createElement("div");
  glow.className = "alert-glow";
  glow.hidden = true;
  const glowChip = document.createElement("div");
  glowChip.className = "alert-chip";
  glowChip.hidden = true;
  document.body.appendChild(glow);
  document.body.appendChild(glowChip);
  async function checkAlerts() {
    const reasons = [];
    const [kd, fi] = await Promise.all([fetchJson("kdca-infectious.json"), fetchJson("fires.json")]);
    if (kd && kd.grade1Recent && kd.grade1Recent.length) reasons.push(`제1급 감염병 신고: ${kd.grade1Recent.map((g) => g.name).join(", ")}`);
    if (fi && fi.nearby && fi.nearby.count > 0) reasons.push(`현장 ${fi.nearby.radiusKm}km 내 신규 화재 ${fi.nearby.count}건`);
    const r = wx.raw || {};
    if (r.gust > 10) reasons.push(`순간풍속 ${r.gust.toFixed(1)}m/s (크레인 작업 제한)`);
    if (r.dust > 150) reasons.push("모래폭풍 수준 먼지");
    // 최근 48시간 현장 반경 300km 안 규모 5.0 이상 지진
    try {
      const since = new Date(Date.now() - 2 * 86400000).toISOString();
      const lat = typeof BISMAYAH_LAT !== "undefined" ? BISMAYAH_LAT : 33.193, lon = typeof BISMAYAH_LON !== "undefined" ? BISMAYAH_LON : 44.618;
      const eq = await fetchJson(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${since}&latitude=${lat}&longitude=${lon}&maxradiuskm=300&minmagnitude=5`);
      if (eq && eq.features && eq.features.length) reasons.push(`현장 300km 내 규모 ${Math.max(...eq.features.map((f) => f.properties.mag)).toFixed(1)} 지진`);
    } catch (e) { /* 무시 */ }
    if (forced.has("alert") && !reasons.length) reasons.push("경보 미리 보기");
    const on = reasons.length > 0;
    glow.hidden = !on; glowChip.hidden = !on;
    glow.classList.toggle("still", reduce);
    if (on) glowChip.innerHTML = `<b>경보</b> ${reasons.map((x) => `<span>${x}</span>`).join("")}`;
  }

  /* ---------- 4) 첫 화면 인트로 ---------- */
  /* 인트로 사진 슬라이드: assets/intro-1.jpg ~ intro-6.jpg (또는 .webp) 를 넣으면 로고 앞에 순서대로 나온다.
     자막은 아래 목록 순서대로 붙는다 (사진 수보다 적으면 남는 사진은 자막 없이). */
  const INTRO_CAPTIONS = [
    { big: "SAFETY", small: "안전" },
    { big: "HEALTH", small: "보건" },
    { big: "ENVIRONMENT", small: "환경" },
    { big: "FIRE", small: "소방" },
    { big: "BISMAYAH", small: "비스마야 신도시" },
    { big: "ZERO ACCIDENT", small: "무재해" },
  ];
  const SLIDE_MS = 1300;

  /* 위성사진 타임랩스: 착공 후 매년 한 장씩 비스마야를 찍은 위성사진(Esri Wayback 보관본)을 인트로 맨 앞에 보여 준다.
     2014년부터 보관본이 있어 그 해부터 올해까지 나온다. 끄려면 false 로. */
  const INTRO_SATELLITE = true;
  const SAT_CENTER = [33.192, 44.622], SAT_ZOOM = 15, SAT_COLS = 4, SAT_ROWS = 3;
  const CONSTRUCTION_YEAR = 2012;

  function satTileXY(lat, lon, z) {
    const n = 2 ** z, rad = (lat * Math.PI) / 180;
    return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)];
  }

  // 받은 위성사진은 여기 쌓인다 (시간 안에 다 못 받아도 받은 만큼은 보여 주기 위해)
  const satDone = [];
  // 직접 넣은 연도별 위성사진: assets/sat-2012.jpg … sat-2026.jpg (.webp 도 가능)
  // 구글 어스 프로의 '과거 이미지'로 캡처한 사진 등을 넣으면 그 해는 이 사진을 우선 쓴다 (2012·2013년도 가능)
  async function loadManualSatYears() {
    const thisYear = new Date().getFullYear();
    const load = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
    const out = {};
    await Promise.all(Array.from({ length: thisYear - CONSTRUCTION_YEAR + 1 }, (_, k) => CONSTRUCTION_YEAR + k).map(async (y) => {
      const im = (await load(`assets/sat-${y}.jpg`)) || (await load(`assets/sat-${y}.webp`));
      if (!im) return;
      const cv = document.createElement("canvas");
      cv.width = im.naturalWidth; cv.height = im.naturalHeight;
      cv.getContext("2d").drawImage(im, 0, 0);
      out[y] = { year: y, canvas: cv, manual: true };
    }));
    return out;
  }

  // 위성 타일이 이전 해와 똑같은지(그 사이 새 위성사진이 없었는지) 확인용 지문
  async function tileFingerprint(url) {
    try {
      const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
      let h = 2166136261;
      for (let i = 0; i < buf.length; i += 7) { h ^= buf[i]; h = Math.imul(h, 16777619); }
      return `${buf.length}:${h >>> 0}`;
    } catch (e) { return null; } // 확인이 안 되면 그냥 보여 준다
  }

  async function loadSatelliteYears(onProgress) {
    if (!INTRO_SATELLITE) return [];
    const manual = await loadManualSatYears();
    if (Object.keys(manual).length) console.info("[인트로] 직접 넣은 위성사진 연도:", Object.keys(manual).join(", "));
    Object.values(manual).forEach((f) => satDone.push(f)); // 시간이 모자라도 직접 넣은 사진은 꼭 나오게
    let cfg;
    try {
      cfg = await (await fetch("https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json")).json();
      console.info("[인트로] 위성 보관본 목록 받음:", Object.keys(cfg).length, "개");
    } catch (e) {
      console.warn("[인트로] 위성 보관본 목록을 못 받음 (네트워크/보안 차단 가능)", e);
      return Object.values(manual).sort((a, b) => a.year - b.year);
    }
    // 해마다 7월 1일에 가장 가까운 보관본 하나씩
    const rel = Object.entries(cfg).map(([num, v]) => {
      const m = String(v.itemTitle || "").match(/(\d{4})-(\d{2})-(\d{2})/);
      return m ? { num, date: new Date(`${m[1]}-${m[2]}-${m[3]}`), year: +m[1], url: v.itemURL } : null;
    }).filter(Boolean);
    const thisYear = new Date().getFullYear();
    let picks = [];
    for (let y = CONSTRUCTION_YEAR; y <= thisYear; y++) {
      if (manual[y]) continue; // 직접 넣은 사진이 있는 해는 건너뜀
      const c = rel.filter((r) => r.year === y);
      if (!c.length) continue;
      const target = new Date(`${y}-07-01`).getTime();
      picks.push(c.sort((a, b) => Math.abs(a.date - target) - Math.abs(b.date - target))[0]);
    }
    const [cx, cy] = satTileXY(SAT_CENTER[0], SAT_CENTER[1], SAT_ZOOM);
    const x0 = cx - Math.floor(SAT_COLS / 2), y0 = cy - Math.floor(SAT_ROWS / 2);
    // 보관본이 해마다 있어도 현장 위성사진은 몇 년에 한 번만 바뀌는 경우가 많다.
    // 가운데 타일의 지문을 비교해서, 앞 해와 똑같은 사진인 해는 뺀다 (같은 장면 반복 방지)
    const fps = await Promise.all(picks.map((p) => tileFingerprint(p.url.replace("{level}", SAT_ZOOM).replace("{row}", cy).replace("{col}", cx))));
    let lastFp = null;
    picks = picks.filter((p, i) => {
      if (fps[i] && fps[i] === lastFp) { console.info(`[인트로] ${p.year}년은 앞 해와 같은 위성사진이라 건너뜀`); return false; }
      if (fps[i]) lastFp = fps[i];
      return true;
    });
    const loadImg = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
    console.info("[인트로] 사용할 연도:", picks.map((p) => p.year).join(", "));
    const frames = await Promise.all(picks.map(async (p) => {
      const tiles = [];
      for (let r = 0; r < SAT_ROWS; r++) for (let c = 0; c < SAT_COLS; c++) {
        const url = p.url.replace("{level}", SAT_ZOOM).replace("{row}", y0 + r).replace("{col}", x0 + c);
        tiles.push(loadImg(url).then((im) => ({ im, r, c })));
      }
      const got = await Promise.all(tiles);
      if (got.some((t) => !t.im)) return null;
      const cv = document.createElement("canvas");
      cv.width = SAT_COLS * 256; cv.height = SAT_ROWS * 256;
      const g = cv.getContext("2d");
      got.forEach((t) => g.drawImage(t.im, t.c * 256, t.r * 256));
      const fr = { year: p.year, canvas: cv };
      satDone.push(fr);
      if (onProgress) onProgress(satDone.length, picks.length);
      return fr;
    }));
    const all = frames.filter(Boolean).concat(Object.values(manual)).sort((a, b) => a.year - b.year);
    console.info("[인트로] 위성사진 준비 완료:", all.map((f) => f.year + (f.manual ? "(직접)" : "")).join(", "));
    return all;
  }

  function loadIntroImages() {
    // 사진을 미리 받아서 '디코딩'까지 끝내 둔다 (슬라이드 도중 버벅이지 않게)
    const tryLoad = (src) => new Promise((res) => {
      const im = new Image();
      im.onload = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => res(src));
      im.onerror = () => res(null);
      im.src = src;
    });
    return Promise.all([1, 2, 3, 4, 5, 6].map(async (n) =>
      (await tryLoad(`assets/intro-${n}.jpg`)) || (await tryLoad(`assets/intro-${n}.webp`))))
      .then((list) => list.filter(Boolean));
  }

  function intro() {
    // index.html 머리말이 첫 화면을 가려 둔 표시(intro-pending)를 인트로가 뜨는 순간(또는 안 뜨면 바로) 지운다
    const unhide = () => document.documentElement.classList.remove("intro-pending");
    let seen = false;
    try { seen = sessionStorage.getItem("hseIntroSeen") === "1"; } catch (e) {}
    if ((seen && params.get("intro") !== "1") || reduce) { unhide(); return; }
    try { sessionStorage.setItem("hseIntroSeen", "1"); } catch (e) {}
    const el = document.createElement("div");
    el.className = "hse-intro";
    el.innerHTML = `<div class="hse-intro-slides"></div><div class="hse-intro-capbox"></div><div class="hse-intro-flash"></div>
    <div class="hse-intro-inner">
      <img class="hse-intro-logo" src="assets/hanwha-logo.jpg" alt="Hanwha">
      <div class="hse-intro-title">비스마야 안전보건환경 상황실</div>
      <div class="hse-intro-sub">BISMAYAH NEW CITY PROJECT · HSE SITUATION ROOM</div>
      <div class="hse-intro-line"></div>
    </div>`;
    document.body.appendChild(el);
    unhide();
    let finished = false, timers = [];
    const done = () => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      el.classList.add("out");
      setTimeout(() => el.remove(), 900);
      // 숫자를 0부터 다시 올린다 (인트로에 가려 처음 올라가는 걸 못 봤으므로)
      ["incidentFreeDays", "constructionDays"].forEach((id) => {
        const n = document.getElementById(id);
        const target = n ? parseInt(String(n.textContent).replace(/[^\d]/g, ""), 10) : 0;
        if (n && target > 0 && typeof animateCount === "function") animateCount(n, target);
      });
      if (window.hsePlayEnter) window.hsePlayEnter();
    };
    el.addEventListener("click", done, { once: true });
    const showLogo = () => { el.classList.add("show-logo"); timers.push(setTimeout(done, 2300)); };

    // 페이지 첫 로딩(지도·데이터 준비)이 끝난 뒤 시작해야 화면 전환이 매끄럽다
    const pageReady = new Promise((res) => {
      if (document.readyState === "complete") res(); else window.addEventListener("load", res, { once: true });
      setTimeout(res, 2500); // 너무 오래 걸리면 그냥 시작
    });
    // 위성사진은 받는 데 시간이 걸릴 수 있어 최대 12초까지 기다리고, 그때까지 받은 해만 보여 준다
    const status = document.createElement("div");
    status.className = "sat-status";
    status.textContent = INTRO_SATELLITE ? "위성사진 불러오는 중…" : "";
    el.appendChild(status);
    const satReady = Promise.race([
      loadSatelliteYears((n, total) => { status.textContent = `위성사진 불러오는 중… ${n} / ${total}`; }),
      new Promise((r) => setTimeout(() => r(null), 12000)),
    ]).then((res) => {
      status.remove();
      const list = (res || satDone).filter(Boolean).sort((a, b) => a.year - b.year);
      if (!res) console.warn("[인트로] 12초 안에 다 못 받아서 받은 것만 사용:", list.length, "장");
      return list.length >= 2 ? list : [];
    });
    // 3D 지구본 준비 (지도 그리기 도구 + 세계 지도). 5초 안에 안 되면 지구본은 건너뜀
    // (지구본 코드는 파일 뒤쪽에 있어서, 이 줄이 실행된 '다음 순간'에 찾아야 한다)
    const globeReady = Promise.race([
      Promise.resolve().then(() => (window.hseLoadGlobe ? window.hseLoadGlobe() : null)),
      new Promise((r) => setTimeout(() => r(null), 5000)),
    ]);
    Promise.all([loadIntroImages(), satReady, pageReady, globeReady]).then(([imgs, sats, , globe]) => new Promise((r) => setTimeout(() => r([imgs, sats, globe]), 150))).then(([imgs, sats, globe]) => {
      if (finished) return;
      const goPhotos = () => runPhotoSlides(imgs);
      const goSat = () => { if (sats && sats.length) runSatellite(sats, goPhotos); else goPhotos(); };
      if (globe && window.hseRunGlobe) window.hseRunGlobe(el, globe, goSat, () => finished); else goSat();
    });

    // 위성사진 타임랩스: 해마다 0.9초씩, 연도를 크게
    function runSatellite(sats, next) {
      const box = el.querySelector(".hse-intro-slides");
      const capbox = el.querySelector(".hse-intro-capbox");
      const credit = document.createElement("div");
      credit.className = "sat-credit";
      credit.textContent = sats.some((f) => f.manual)
        ? "위성사진: Google Earth (Airbus·Maxar 등) · 비스마야 신도시"
        : "위성사진: Esri World Imagery Wayback (Maxar 등) · 비스마야 신도시";
      el.appendChild(credit);
      let i = 0;
      const step = () => {
        if (finished) return;
        if (i >= sats.length) { credit.remove(); next(); return; }
        const s = sats[i];
        const wrap = document.createElement("div");
        wrap.className = "sat-frame";
        wrap.appendChild(s.canvas);
        box.appendChild(wrap);
        while (box.children.length > 2) box.removeChild(box.firstChild);
        const yrs = s.year - CONSTRUCTION_YEAR;
        capbox.innerHTML = `<div class="hse-intro-cap sat"><b>${s.year}</b><span>${yrs <= 0 ? "착공" : `착공 ${yrs}년차`}</span></div>`;
        i++;
        // 장 수가 많으면 한 장을 짧게 (전체가 8초 안팎이 되도록, 한 장 0.45~0.9초)
        const per = Math.max(450, Math.min(900, Math.round(8000 / sats.length)));
        timers.push(setTimeout(step, i === sats.length ? 1500 : per));
      };
      step();
    }

    function runPhotoSlides(imgs) {
      if (finished) return;
      if (!imgs.length) {
        el.querySelector(".hse-intro-slides").classList.add("fade");
        el.querySelector(".hse-intro-capbox").innerHTML = "";
        return showLogo();
      }
      const box = el.querySelector(".hse-intro-slides");
      const flash = el.querySelector(".hse-intro-flash");
      const dirs = ["dir-l", "dir-r", "dir-u", "dir-d"]; // 슬라이드마다 다른 방향으로 확대·이동
      // 슬라이드를 하나씩 이어서 보여 준다. 다음 장은 '이번 장 화면 전환이 실제로 시작된 때'부터 시간을 잰다
      // (컴퓨터가 바쁠 때 전환이 늦게 시작돼도 장면이 겹치거나 건너뛰지 않게)
      const capbox = el.querySelector(".hse-intro-capbox");
      const showSlide = (i) => {
        if (finished) return;
        if (i >= imgs.length) {
          box.classList.add("fade"); capbox.innerHTML = ""; showLogo();
          return;
        }
        const cap = INTRO_CAPTIONS[i];
        const sl = document.createElement("div");
        sl.className = `hse-intro-slide ${dirs[i % dirs.length]}`;
        sl.style.backgroundImage = `url('${imgs[i]}')`;
        box.appendChild(sl);
        capbox.innerHTML = cap ? `<div class="hse-intro-cap"><b>${cap.big}</b><span>${cap.small}</span></div>` : "";
        flash.classList.remove("on"); void flash.offsetWidth; flash.classList.add("on");
        while (box.children.length > 2) box.removeChild(box.firstChild);
        let scheduled = false;
        const next = () => { if (scheduled) return; scheduled = true; timers.push(setTimeout(() => showSlide(i + 1), SLIDE_MS)); };
        sl.addEventListener("animationstart", next, { once: true });
        timers.push(setTimeout(next, 800)); // 만일을 위해
      };
      showSlide(0);
    }
  }

  /* ---------- 2) 상황실 순환 모드 ---------- */
  const caption = document.createElement("div");
  caption.className = "kiosk-caption";
  caption.hidden = true;
  document.body.appendChild(caption);
  const $t = (id) => { const el = document.getElementById(id); return el ? el.textContent.trim() : "–"; };
  let kdcaCache = null, saCache = null, fireCache = null;
  const SLIDES = [
    { cls: "bg-dashboard", label: "종합현황", text: () => `무재해 <b>${$t("incidentFreeDays")}</b>일 · 착공 <b>${$t("constructionDays")}</b>일째` },
    { cls: "bg-safety", label: "오늘 작업", text: () => `작업 <b>${$t("twTotal")}</b>건 · 투입 <b>${$t("twCrew")}</b>명 · 위험작업 <b>${$t("twRisk")}</b>건` },
    { cls: "bg-env", label: "현장 날씨", text: () => { const r = wx.raw || {}; return r.temp != null ? `현재 <b>${Math.round(r.temp)}℃</b> · 바람 <b>${(r.wind || 0).toFixed(1)}</b>m/s · 순간 <b>${(r.gust || 0).toFixed(1)}</b>m/s${r.dust != null ? ` · 모래먼지 <b>${Math.round(r.dust)}</b>㎍/㎥` : ""}` : "현장 날씨 확인 중"; } },
    { cls: "bg-safety", label: "국내 중대재해", text: () => saCache ? `${saCache.period} 사고사망자 <b>${(saCache.byIndustry || []).reduce((a, x) => a + (x.total || 0), 0)}</b>명` : "국내 중대재해 현황" },
    { cls: "bg-health", label: "국내 감염병", text: () => kdcaCache ? `${kdcaCache.baseWeek.label} 법정감염병 <b>${kdcaCache.totalBase.toLocaleString()}</b>건 · 제1급 <b>${kdcaCache.grades["제1급"].base}</b>건` : "국내 감염병 현황" },
    { cls: "bg-fire", label: "화재 현황", text: () => fireCache && fireCache.nearby ? `현장 ${fireCache.nearby.radiusKm}km 내 최근 24시간 신규 화재 <b>${fireCache.nearby.count}</b>건` : "이라크 화재 현황" },
    { cls: "bg-etc", label: "해상·항공", text: () => "중동 상공 항공기 · 걸프만 선박 실시간 모니터링" },
  ];
  const kiosk = {
    running: false, idx: 0, timer: null, prevClass: "",
    async start() {
      if (this.running) return;
      this.running = true;
      this.prevClass = document.body.className;
      [kdcaCache, saCache, fireCache] = await Promise.all([fetchJson("kdca-infectious.json"), fetchJson("serious-accidents.json"), fetchJson("fires.json")]);
      if (!this.running) return;
      if (window.hseSetReveal) window.hseSetReveal(true, false);
      caption.hidden = false;
      this.idx = 0; this.show();
      this.timer = setInterval(() => { this.idx = (this.idx + 1) % SLIDES.length; this.show(); }, 12000);
    },
    show() {
      const s = SLIDES[this.idx];
      crossfadeSnapshot();
      document.body.className = `${s.cls} bg-reveal kiosk-on`;
      caption.classList.remove("in"); void caption.offsetWidth;
      caption.innerHTML = `<div class="kiosk-label">${s.label}</div><div class="kiosk-text">${s.text()}</div>
        <div class="kiosk-dots">${SLIDES.map((_, i) => `<i class="${i === this.idx ? "on" : ""}"></i>`).join("")}</div>`;
      caption.classList.add("in");
    },
    stop() {
      if (!this.running) return;
      this.running = false;
      clearInterval(this.timer);
      caption.hidden = true;
      crossfadeSnapshot();
      document.body.className = this.prevClass.replace(/\s*(bg-reveal|kiosk-on)\b/g, "");
      if (window.hseSetReveal) window.hseSetReveal(false, false);
    },
  };
  window.hseKiosk = kiosk;
  window.hseFx = { set: (k) => { forced.add(k); applyForced(); resize(); start(); updateChip(); checkAlerts(); }, kiosk };
  if (params.get("kiosk") === "1") setTimeout(() => kiosk.start(), 1500);

  // 시작
  resize();
  intro();
  loadWeather();
  setInterval(loadWeather, 10 * 60 * 1000);
})();

/* 스크롤을 내리면 배경 사진도 따라 내려가 아래쪽이 보이도록 (맨 위 0% → 맨 아래 100%) */
(function scrollBackground() {
  const root = document.documentElement;
  let ticking = false;
  function update() {
    ticking = false;
    const max = root.scrollHeight - window.innerHeight;
    const y = max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0;
    root.style.setProperty("--bg-y", y.toFixed(2) + "%");
  }
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  // 탭을 바꾸면 페이지 길이가 달라지므로 다시 계산
  document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => setTimeout(update, 50)));
  update();
})();


/* ---------------- 탭별 관련 뉴스 (topic-news.json) ---------------- */
let topicNewsData = null;
async function loadTopicNews(key) {
  const list = document.querySelector(`.topic-news-list[data-topic="${key}"]`);
  if (!list) return;
  if (!topicNewsData) {
    try {
      const r = await fetch("topic-news.json", { cache: "no-store" });
      if (!r.ok) throw new Error();
      topicNewsData = await r.json();
    } catch (e) {
      list.innerHTML = '<li class="skeleton">아직 뉴스가 없습니다. GitHub Actions에서 "Update topic news"를 한 번 실행하면 표시됩니다.</li>';
      return;
    }
  }
  const items = (topicNewsData[key] && topicNewsData[key].items) || [];
  const ago = (iso) => {
    if (!iso) return "";
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    return m < 60 ? `${Math.max(1, m)}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`;
  };
  list.innerHTML = items.length ? items.map((n) => `
    <li><a href="${escapeHtml(n.link)}" target="_blank" rel="noopener noreferrer">
      <span class="tn-title">${escapeHtml(n.title)}</span>
      <span class="tn-meta">${escapeHtml(n.source || "")}${n.source ? " · " : ""}${escapeHtml(ago(n.date))}</span>
    </a></li>`).join("") : '<li class="skeleton">최근 관련 뉴스가 없습니다.</li>';
  const meta = list.parentElement.querySelector(".topic-news-meta");
  if (meta && topicNewsData.generatedAt) {
    meta.textContent = "구글 뉴스 검색 연동 · 기사를 누르면 언론사 원문으로 이동 · 마지막 수집: " +
      new Intl.DateTimeFormat("ko-KR", { timeZone: TIMEZONE, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(topicNewsData.generatedAt));
  }
}
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.view === "view-sa") loadTopicNews("sa");
    if (btn.dataset.view === "view-health-kdca") loadTopicNews("infect");
    if (btn.dataset.view === "view-embassy") loadTopicNews("embassy");
  });
});


/* ==========================================================
   환경 > 모래폭풍 예보 (Open-Meteo 시간별 5일 예보)
   ========================================================== */
let dustLoadedAt = 0;
const DUST_BANDS = [[80, "보통"], [150, "나쁨"], [300, "매우 나쁨"], [Infinity, "모래폭풍"]];
function dustLevel(v) {
  if (v == null) return { name: "–", cls: "" };
  if (v < 80) return { name: "보통 이하", cls: "ok" };
  if (v < 150) return { name: "나쁨", cls: "warn" };
  if (v < 300) return { name: "매우 나쁨", cls: "bad" };
  return { name: "모래폭풍", cls: "storm" };
}

async function loadDustForecast() {
  if (Date.now() - dustLoadedAt < 30 * 60 * 1000) return;
  const q = `latitude=${BISMAYAH_LAT}&longitude=${BISMAYAH_LON}&timezone=${encodeURIComponent(TIMEZONE)}`;
  let aq, wx;
  try {
    [aq, wx] = await Promise.all([
      fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&hourly=dust,pm10&forecast_days=5`).then((r) => r.json()),
      fetch(`https://api.open-meteo.com/v1/forecast?${q}&wind_speed_unit=ms&hourly=wind_gusts_10m,visibility&forecast_days=5`).then((r) => r.json()),
    ]);
  } catch (e) {
    document.getElementById("dustAlert").textContent = "예보를 불러오지 못했습니다.";
    return;
  }
  dustLoadedAt = Date.now();
  const times = (aq.hourly && aq.hourly.time) || [];
  const dust = (aq.hourly && aq.hourly.dust) || [];
  const gustMap = {};
  ((wx.hourly && wx.hourly.time) || []).forEach((t, i) => { gustMap[t] = wx.hourly.wind_gusts_10m[i]; });
  const pts = times.map((t, i) => ({ t, d: dust[i], g: gustMap[t] })).filter((p) => p.d != null);
  if (!pts.length) { document.getElementById("dustAlert").textContent = "예보 자료가 없습니다."; return; }

  // 날짜별 요약
  const byDay = {};
  pts.forEach((p) => {
    const day = p.t.slice(0, 10);
    const o = byDay[day] || (byDay[day] = { max: 0, at: "", gust: 0 });
    if (p.d > o.max) { o.max = p.d; o.at = p.t.slice(11, 13); }
    if ((p.g || 0) > o.gust) o.gust = p.g;
  });
  const wd = ["일", "월", "화", "수", "목", "금", "토"];
  document.getElementById("dustDays").innerHTML = Object.entries(byDay).map(([day, o]) => {
    const lv = dustLevel(o.max);
    const d = new Date(day + "T00:00:00");
    return `<div class="dust-day ${lv.cls}">
      <div class="dd-date">${d.getMonth() + 1}/${d.getDate()} (${wd[d.getDay()]})</div>
      <div class="dd-val">${Math.round(o.max)}<small>㎍/㎥</small></div>
      <div class="dd-lv">${lv.name}</div>
      <div class="dd-sub">최고 ${o.at}시경 · 순간풍속 최대 ${o.gust.toFixed(1)}m/s</div>
    </div>`;
  }).join("");

  // 다음 모래폭풍(매우 나쁨 이상) 구간 찾기
  const nowKey = new Intl.DateTimeFormat("sv-SE", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(" ", "T");
  const future = pts.filter((p) => p.t >= nowKey.slice(0, 13));
  let alertTxt = "", alertCls = "ok";
  const startIdx = future.findIndex((p) => p.d >= 150);
  if (startIdx >= 0) {
    let endIdx = startIdx;
    while (endIdx + 1 < future.length && future[endIdx + 1].d >= 150) endIdx++;
    const s = future[startIdx], e = future[endIdx];
    const peak = Math.max(...future.slice(startIdx, endIdx + 1).map((p) => p.d));
    const f = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}(${wd[d.getDay()]}) ${t.slice(11, 13)}시`; };
    alertCls = peak >= 300 ? "storm" : "bad";
    alertTxt = `${peak >= 300 ? "🌪 모래폭풍" : "😷 먼지 매우 나쁨"} 예상: ${f(s.t)} ~ ${f(e.t)} · 최고 ${Math.round(peak)}㎍/㎥ · 옥외작업 계획 조정, 방진마스크 준비`;
  } else {
    alertTxt = "앞으로 5일 동안 '매우 나쁨'(150㎍/㎥) 이상의 모래먼지는 예보되지 않았습니다";
  }
  const al = document.getElementById("dustAlert");
  al.className = `dust-alert ${alertCls}`;
  al.textContent = alertTxt;

  drawDustChart(pts, nowKey);
  document.getElementById("dustMeta").textContent =
    `Open-Meteo 대기질(CAMS)·날씨 예보 · 비스마야 현장 좌표 기준 시간별 예보 · 예보는 실제와 다를 수 있습니다 · 30분마다 갱신`;
}

function drawDustChart(pts, nowKey) {
  const svg = document.getElementById("dustChart");
  const W = 1000, H = 300, L = 46, R = 46, T = 14, B = 34;
  const maxD = Math.max(320, ...pts.map((p) => p.d)) * 1.05;
  const maxG = Math.max(15, ...pts.map((p) => p.g || 0)) * 1.1;
  const x = (i) => L + (i / (pts.length - 1)) * (W - L - R);
  const yD = (v) => T + (1 - v / maxD) * (H - T - B);
  const yG = (v) => T + (1 - v / maxG) * (H - T - B);
  let g = "";
  // 기준선
  [[80, "#8bd35f"], [150, "#f2a93b"], [300, "#e5484d"]].forEach(([v, c]) => {
    g += `<line x1="${L}" x2="${W - R}" y1="${yD(v)}" y2="${yD(v)}" stroke="${c}" stroke-dasharray="6 6" stroke-width="1" opacity="0.7"/>
      <text x="${L - 6}" y="${yD(v) + 4}" text-anchor="end" class="ax">${v}</text>`;
  });
  // 날짜 구분선
  pts.forEach((p, i) => {
    if (p.t.endsWith("T00:00") && i > 0) {
      const d = new Date(p.t);
      g += `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}" stroke="rgba(255,255,255,0.08)"/>
        <text x="${x(i) + 4}" y="${H - B + 18}" class="ax">${d.getMonth() + 1}/${d.getDate()}</text>`;
    }
  });
  // 먼지 면적
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${yD(p.d).toFixed(1)}`).join(" ");
  g += `<defs><linearGradient id="dustGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9964f" stop-opacity="0.75"/><stop offset="1" stop-color="#c9964f" stop-opacity="0.05"/></linearGradient></defs>
    <polygon points="${x(0)},${H - B} ${line} ${x(pts.length - 1)},${H - B}" fill="url(#dustGrad)"/>
    <polyline points="${line}" fill="none" stroke="#e0b070" stroke-width="2"/>`;
  // 순간풍속 선
  const gl = pts.map((p, i) => (p.g == null ? null : `${x(i).toFixed(1)},${yG(p.g).toFixed(1)}`)).filter(Boolean).join(" ");
  g += `<polyline points="${gl}" fill="none" stroke="#4fb4ff" stroke-width="1.5" opacity="0.85"/>`;
  [0, 5, 10, 15, 20].filter((v) => v <= maxG).forEach((v) => { g += `<text x="${W - R + 6}" y="${yG(v) + 4}" class="ax">${v}</text>`; });
  // 지금 시각
  const ni = pts.findIndex((p) => p.t >= nowKey.slice(0, 13));
  if (ni >= 0) g += `<line x1="${x(ni)}" x2="${x(ni)}" y1="${T}" y2="${H - B}" stroke="#35d0c0" stroke-width="1.5"/><text x="${x(ni) + 4}" y="${T + 10}" class="ax now">지금</text>`;
  svg.innerHTML = g;
}

/* ==========================================================
   환경 > 중동 지진 현황 (USGS)
   ========================================================== */
let quakeMap = null, quakeLayer = null, quakeLoadedAt = 0;
function kmBetween(a, b, c, d) {
  const R = 6371, rad = Math.PI / 180;
  const x = Math.sin(((c - a) * rad) / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(((d - b) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
async function loadQuakes() {
  if (!quakeMap) {
    quakeMap = L.map("quakeMap", { zoomSnap: 0.5 }).setView([31, 47], 4.5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors", maxZoom: 10,
    }).addTo(quakeMap);
    L.marker([BISMAYAH_LAT, BISMAYAH_LON], { icon: L.divIcon({ className: "map-label-wrap", html: '<span class="site-star">★</span>', iconSize: [0, 0] }) })
      .bindPopup("비스마야 현장").addTo(quakeMap);
    L.circle([BISMAYAH_LAT, BISMAYAH_LON], { radius: 300000, color: "#35d0c0", weight: 1, dashArray: "6 6", fill: false }).addTo(quakeMap);
    quakeLayer = L.layerGroup().addTo(quakeMap);
  }
  setTimeout(() => quakeMap.invalidateSize(), 100);
  if (Date.now() - quakeLoadedAt < 10 * 60 * 1000) return;
  const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const box = "minlatitude=12&maxlatitude=42&minlongitude=30&maxlongitude=63&minmagnitude=2.5";
  let feats = null, src = "";
  try {
    const d = await (await fetch(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${start}&${box}&orderby=time&limit=300`)).json();
    feats = d.features || []; src = "미국지질조사국(USGS)";
  } catch (e) {
    console.warn("[지진] USGS 실패 → EMSC로 다시 시도", e);
    try {
      const d = await (await fetch(`https://www.seismicportal.eu/fdsnws/event/1/query?format=json&starttime=${start}&${box}&orderby=time&limit=300`)).json();
      feats = d.features || []; src = "유럽지중해지진센터(EMSC)";
    } catch (e2) { console.warn("[지진] EMSC도 실패", e2); }
  }
  if (!feats) {
    document.getElementById("quakeSummary").textContent = "지진 정보를 불러오지 못했습니다. (USGS·EMSC 모두 접속 실패)";
    return;
  }
  quakeLoadedAt = Date.now();
  const now = Date.now();
  const qs = feats.map((f) => {
    const p = f.properties || {}, c = f.geometry.coordinates;
    return {
      mag: Number(p.mag), place: p.place || p.flynn_region || "", time: typeof p.time === "number" ? p.time : Date.parse(p.time),
      lon: c[0], lat: c[1], depth: Math.abs(c[2] != null ? c[2] : p.depth || 0),
      dist: kmBetween(BISMAYAH_LAT, BISMAYAH_LON, c[1], c[0]),
    };
  }).filter((q) => isFinite(q.mag) && isFinite(q.time));
  quakeLayer.clearLayers();
  const fmt = (t) => new Intl.DateTimeFormat("ko-KR", { timeZone: TIMEZONE, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(t));
  qs.slice().reverse().forEach((q) => {
    const age = now - q.time;
    const color = age < 86400000 ? "#e5484d" : age < 7 * 86400000 ? "#f2a93b" : "#8a94a3";
    L.circleMarker([q.lat, q.lon], {
      radius: Math.max(3, (q.mag - 2) * 4), color, weight: 1, fillColor: color, fillOpacity: age < 86400000 ? 0.7 : 0.4,
    }).bindPopup(`<b>규모 ${q.mag.toFixed(1)}</b><br>${escapeHtml(q.place)}<br>${fmt(q.time)} (바그다드) · 깊이 ${Math.round(q.depth)}km<br>현장에서 ${Math.round(q.dist)}km`).addTo(quakeLayer);
  });
  const near = qs.filter((q) => q.dist <= 300);
  const big = qs.reduce((m, q) => (!m || q.mag > m.mag ? q : m), null);
  const day = qs.filter((q) => now - q.time < 86400000).length;
  document.getElementById("quakeSummary").innerHTML = `최근 30일 <b>${qs.length}</b>회 · 24시간 <b>${day}</b>회 · 현장 반경 300km <b>${near.length}</b>회` +
    (big ? ` · 최대 <b>규모 ${big.mag.toFixed(1)}</b> (${escapeHtml(big.place)}, ${fmt(big.time)})` : "");
  document.getElementById("quakeTable").innerHTML = `
    <thead><tr><th>발생 시각 (바그다드)</th><th>규모</th><th>위치</th><th>깊이</th><th>현장까지</th></tr></thead>
    <tbody>${qs.slice(0, 15).map((q) => `<tr class="${q.mag >= 5 ? "big" : ""}">
      <td>${fmt(q.time)}</td><td class="mag">${q.mag.toFixed(1)}</td><td>${escapeHtml(q.place)}</td>
      <td>${Math.round(q.depth)}km</td><td>${Math.round(q.dist).toLocaleString()}km</td></tr>`).join("") || '<tr><td colspan="5">최근 지진 없음</td></tr>'}</tbody>`;
  document.getElementById("quakeMeta").textContent = `${src} 실시간 지진 정보 · 위치는 영문 원문 · 10분마다 갱신 · 점선 원 = 현장 반경 300km`;
}

/* ==========================================================
   기타 정보 > 주변국 여행경보 (travel-alarm.json)
   ========================================================== */
let travelMap = null;
const TRAVEL_COLORS = { 0: "#2a3442", 1: "#4fb4ff", 2: "#ffd166", 3: "#f2a93b", 4: "#e5484d" };
const TRAVEL_FOCUS = ["IQ", "IR", "SY", "JO", "SA", "KW", "TR", "LB", "IL", "PS", "EG", "AE", "QA", "BH", "OM", "YE", "AF", "PK", "AZ", "AM", "GE", "CY", "LY", "SD", "IN", "BD"];
// 한 나라 안에서 '나라 대부분'에 걸린 단계(base)와 '가장 높은 단계'(top)를 나눈다.
// 예) 일본: 후쿠시마 원전 30km만 3단계 → base 0(경보 없음), top 3 → 지도에 빗금으로 표시
function travelShape(c) {
  if (!c || !c.level) return { base: 0, top: 0, partial: false };
  const regs = (c.regions || []).filter((r) => r.level);
  const whole = regs.find((r) => r.region === "전체" && /^전\s?지역$/.test(String(r.remark || "").trim()));
  if (whole && whole.level === c.level) return { base: c.level, top: c.level, partial: false };
  // '…을 제외한 지역', '…이외 지역', '…외 전 지역'처럼 나머지 땅 전체를 가리키는 줄
  const rest = regs.filter((r) => r.region === "전체" || /제외한|제외\s*전|이외|외\s?전\s?지역|발령 지역 외/.test(String(r.remark || "")));
  let base;
  if (rest.length) base = Math.min(...rest.map((r) => r.level));
  else if (new Set(regs.map((r) => r.level)).size > 1) base = Math.min(...regs.map((r) => r.level));
  else base = 0; // 일부 지역에만 경보가 있고 나머지는 경보 없음
  return { base, top: c.level, partial: c.level > base };
}

function travelStateText(c) {
  if (!c || !c.level) return "경보 없음";
  const sh = travelShape(c);
  if (!sh.partial) return `${c.level}단계 ${c.levelName}`;
  const LV = { 1: "여행유의", 2: "여행자제", 3: "출국권고", 4: "여행금지" };
  return `일부 지역 ${sh.top}단계 ${LV[sh.top] || c.levelName} · 그 외 ${sh.base ? `${sh.base}단계 ${LV[sh.base]}` : "경보 없음"}`;
}

// 빗금 무늬: 바탕 = 나라 대부분의 단계, 빗금 = 일부 지역의 높은 단계
function travelAddPatterns(map) {
  const svg = map.getPanes().overlayPane.querySelector("svg");
  if (!svg || svg.querySelector("#trp-defs")) return;
  const ns = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(ns, "defs");
  defs.id = "trp-defs";
  for (let b = 0; b <= 3; b++) for (let t = b + 1; t <= 4; t++) {
    const pat = document.createElementNS(ns, "pattern");
    pat.setAttribute("id", `trp-${b}-${t}`);
    pat.setAttribute("patternUnits", "userSpaceOnUse");
    pat.setAttribute("width", "7"); pat.setAttribute("height", "7");
    pat.setAttribute("patternTransform", "rotate(45)");
    pat.innerHTML = `<rect width="7" height="7" fill="${TRAVEL_COLORS[b]}"/><rect width="3" height="7" fill="${TRAVEL_COLORS[t]}"/>`;
    defs.appendChild(pat);
  }
  svg.insertBefore(defs, svg.firstChild);
}

async function loadTravel() {
  if (travelMap) { setTimeout(() => travelMap.invalidateSize(), 100); return; }
  let alarm = null, world = null;
  try {
    [alarm, world] = await Promise.all([
      fetch("travel-alarm.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      // 브라우저에 남아 있는 예전 지도 파일(나라 코드 없는 판)을 쓰지 않도록 항상 새로 확인
      fetch("world-map.json?v=iso2", { cache: "no-cache" }).then((r) => r.json()),
    ]);
  } catch (e) { /* 아래에서 처리 */ }
  travelMap = L.map("travelMap", { zoomSnap: 0.5, minZoom: 3, maxZoom: 7, attributionControl: true }).setView([29, 47], 4);
  travelMap.attributionControl.setPrefix(false);
  travelMap.attributionControl.addAttribution("지도: Natural Earth · 여행경보: 외교부");
  const C = (alarm && alarm.countries) || {};
  if (world) {
    L.geoJSON(world, {
      style: (f) => {
        const c = C[f.properties.iso2];
        const sh = travelShape(c);
        const fill = sh.partial ? `url(#trp-${sh.base}-${sh.top})` : TRAVEL_COLORS[sh.top];
        return { color: "#0f1720", weight: 0.8, fillColor: fill, fillOpacity: sh.top ? (sh.partial ? 0.85 : 0.75) : 0.9 };
      },
      onEachFeature: (f, lyr) => {
        const c = C[f.properties.iso2];
        const sh = travelShape(c);
        const where = sh.partial
          ? (c.regions || []).filter((r) => r.level === sh.top).map((r) => r.remark).filter(Boolean).join(" / ")
          : "";
        lyr.bindTooltip(`<b>${escapeHtml(f.properties.ko)}</b> · ${escapeHtml(travelStateText(c))}` +
          (where ? `<br><span style="opacity:.75">${sh.top}단계 지역: ${escapeHtml(where.slice(0, 120))}${where.length > 120 ? "…" : ""}</span>` : ""), { sticky: true });
      },
    }).addTo(travelMap);
    travelAddPatterns(travelMap);   // 지도 SVG가 생긴 뒤에 빗금 무늬 정의를 넣는다
  }
  setTimeout(() => travelMap.invalidateSize(), 100);
  const list = document.getElementById("travelList");
  if (!alarm || !Object.keys(alarm.countries || {}).length) {
    list.innerHTML = '<p class="skeleton">아직 여행경보 자료가 없습니다. 외교부 여행경보 API 활용신청 후 GitHub Actions에서 "Update travel alarm"을 실행하면 표시됩니다.</p>';
    return;
  }
  const rows = TRAVEL_FOCUS.map((k) => C[k]).filter(Boolean).sort((a, b) => b.level - a.level);
  list.innerHTML = rows.map((c) => `
    <div class="travel-row" style="--c:${TRAVEL_COLORS[c.level]}">
      <span class="tr-lv">${c.level ? c.level + "단계" : "–"}</span>
      <span class="tr-name">${escapeHtml(c.name)}</span>
      <span class="tr-state">${escapeHtml(travelStateText(c))}</span>
      ${c.regions.length ? `<details><summary>지역별</summary>${c.regions.map((r) => `<p><b>${r.level}단계</b> ${escapeHtml(r.region || "")} ${escapeHtml(r.remark || "")}</p>`).join("")}</details>` : ""}
    </div>`).join("");
  document.getElementById("travelMeta").textContent = "출처: 외교부 해외안전여행(0404.go.kr) 국가·지역별 여행경보 · 나라 대부분에 걸린 단계로 칠하고, 일부 지역에만 더 높은 단계가 있으면 그 색을 빗금으로 표시 · 마지막 수집: " +
    new Intl.DateTimeFormat("ko-KR", { timeZone: TIMEZONE, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(alarm.generatedAt));
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.view === "view-env-dust") loadDustForecast();
    if (btn.dataset.view === "view-env-quake") loadQuakes();
    if (btn.dataset.view === "view-travel") loadTravel();
  });
});


/* ==========================================================
   보여 주기용 효과 묶음
   A) 인트로 3D 지구본: 서울 → 비스마야 비행선 + 현장으로 확대
   B) 날씨에 반응하는 마스코트 (폭염 땀, 모래먼지 마스크, 강풍)
   C) 공항 전광판식 숫자판 (무재해·착공 일수)
   D) 무재해 기념일 축하 (폭죽·꽃가루)
   E) 실시간 하늘색 배너 (해·달이 배너를 가로지름)
   미리 보기: ?mascot=heat|dust|wind|night  ?celebrate=1  ?sky=dawn|day|dusk|night
   ========================================================== */
(function hseWow() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const params = new URLSearchParams(location.search);
  const SITE = [44.618, 33.193];   // [경도, 위도] 비스마야
  const SEOUL = [126.978, 37.566];

  /* ---------------- A) 인트로 3D 지구본 ---------------- */
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  window.hseLoadGlobe = async function () {
    try {
      if (!(window.d3 && window.d3.geoOrthographic)) {
        await loadScript("https://cdn.jsdelivr.net/npm/d3-array@3/dist/d3-array.min.js");
        await loadScript("https://cdn.jsdelivr.net/npm/d3-geo@3/dist/d3-geo.min.js");
      }
      const world = await (await fetch("world-map.json?v=iso2", { cache: "no-cache" })).json();
      return { d3: window.d3, world };
    } catch (e) {
      console.warn("[인트로] 지구본 준비 실패, 건너뜀", e);
      return null;
    }
  };

  window.hseRunGlobe = function (el, globe, next, isFinished) {
    const { d3, world } = globe;
    const box = el.querySelector(".hse-intro-slides");
    const capbox = el.querySelector(".hse-intro-capbox");
    const cv = document.createElement("canvas");
    cv.className = "globe-canvas";
    box.appendChild(cv);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    const R0 = Math.min(W, H) * 0.4;
    const proj = d3.geoOrthographic().translate([W / 2, H / 2]).scale(R0).clipAngle(90).precision(0.6);
    const path = d3.geoPath(proj, ctx);
    const grat = d3.geoGraticule10();
    const iraq = world.features.find((f) => f.properties.iso === "IRQ");
    const korea = world.features.find((f) => f.properties.iso === "KOR");
    const interp = d3.geoInterpolate(SEOUL, SITE);
    const distKm = Math.round(d3.geoDistance(SEOUL, SITE) * 6371);
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    const T1 = 2600, T2 = 1900; // 1단계: 서울→비스마야 비행 / 2단계: 현장으로 확대
    let start = 0, handed = false;
    capbox.innerHTML = `<div class="hse-intro-cap globe"><b id="globeKm">0 km</b><span>SEOUL → BISMAYAH · 서울에서 비스마야까지</span></div>`;
    const kmEl = capbox.querySelector("#globeKm");

    function label(lonlat, text, color) {
      if (d3.geoDistance(lonlat, proj.invert([W / 2, H / 2])) > Math.PI / 2 - 0.05) return;
      const [x, y] = proj(lonlat);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.font = "700 14px 'JetBrains Mono', monospace";
      ctx.fillStyle = "#fff";
      ctx.fillText(text, x + 10, y - 8);
    }

    function frame(now) {
      if (isFinished()) return;
      if (!start) start = now;
      const t = now - start;
      let center, k = 1, arcT = 1;
      if (t < T1) {
        const e = ease(Math.min(1, t / T1));
        arcT = e;
        center = interp(Math.min(1, e * 1.05)); // 비행기 머리를 따라 지구가 돈다
      } else {
        center = SITE;
        const e = ease(Math.min(1, (t - T1) / T2));
        k = Math.pow(22, e); // 현장으로 22배 확대 (더 키우면 지도가 각져 보임)
      }
      proj.rotate([-center[0], -center[1]]).scale(R0 * k);

      ctx.clearRect(0, 0, W, H);
      // 바다 + 대기 빛
      const R = proj.scale();
      const g = ctx.createRadialGradient(W / 2 - R * 0.3, H / 2 - R * 0.3, R * 0.1, W / 2, H / 2, R);
      g.addColorStop(0, "#0e2238"); g.addColorStop(1, "#040c16");
      ctx.save();
      ctx.shadowColor = "rgba(53,208,192,0.55)"; ctx.shadowBlur = 40;
      ctx.beginPath(); path({ type: "Sphere" }); ctx.fillStyle = g; ctx.fill();
      ctx.restore();
      ctx.beginPath(); path(grat); ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 0.6; ctx.stroke();
      ctx.beginPath(); path(world); ctx.fillStyle = "#3a5068"; ctx.fill();
      ctx.strokeStyle = "rgba(53,208,192,0.35)"; ctx.lineWidth = 0.5; ctx.stroke();
      if (korea) { ctx.beginPath(); path(korea); ctx.fillStyle = "rgba(53,208,192,0.55)"; ctx.fill(); }
      if (iraq) { ctx.beginPath(); path(iraq); ctx.fillStyle = "rgba(242,169,59,0.55)"; ctx.fill(); }

      // 비행선
      const n = 80, pts = [];
      for (let i = 0; i <= n * arcT; i++) pts.push(interp(i / n));
      if (pts.length > 1) {
        ctx.save();
        ctx.beginPath(); path({ type: "LineString", coordinates: pts });
        ctx.strokeStyle = "#ffd166"; ctx.lineWidth = 2.5; ctx.shadowColor = "#ffd166"; ctx.shadowBlur = 12; ctx.stroke();
        ctx.restore();
        const head = pts[pts.length - 1];
        if (d3.geoDistance(head, center) < Math.PI / 2) {
          const [hx, hy] = proj(head);
          ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(hx, hy, 4, 0, Math.PI * 2); ctx.fill();
        }
      }
      label(SEOUL, "SEOUL", "#35d0c0");
      if (arcT > 0.95) {
        const pulse = 6 + 4 * Math.sin(now / 150);
        if (d3.geoDistance(SITE, center) < Math.PI / 2) {
          const [sx, sy] = proj(SITE);
          ctx.strokeStyle = "rgba(242,169,59,0.9)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(sx, sy, pulse + 6, 0, Math.PI * 2); ctx.stroke();
        }
        label(SITE, "BISMAYAH", "#f2a93b");
      }
      kmEl.textContent = `${Math.round(distKm * arcT).toLocaleString()} km`;

      // 확대 막바지에 위성사진으로 넘겨 준다 (지구본은 서서히 사라짐)
      if (!handed && t > T1 + T2 * 0.6) {
        handed = true;
        cv.classList.add("fade");
        setTimeout(() => cv.remove(), 900);
        next();
        return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };

  /* ---------------- B) 날씨에 반응하는 마스코트 ---------------- */
  function setupMascotMood() {
    const runner = document.querySelector(".mascot-runner");
    const step = runner && runner.querySelector(".mascot-step");
    if (!step) return false;
    if (!step.querySelector(".mx-mask")) {
      step.insertAdjacentHTML("beforeend",
        '<div class="mx-mask"></div><div class="mx-sweat"><i></i><i></i></div><div class="mx-wind"><i></i><i></i><i></i></div>');
    }
    let lastMood = "";
    function apply(w) {
      const forced = params.get("mascot");
      const heat = forced === "heat" || (w && ((w.feel != null && w.feel >= 40) || (w.temp != null && w.temp >= 40)));
      const dust = forced === "dust" || (w && ((w.dust != null && w.dust > 150) || (w.pm10 != null && w.pm10 > 250)));
      const wind = forced === "wind" || (w && w.gust != null && w.gust > 10);
      const night = forced === "night" || (w && w.isDay === 0);
      runner.classList.toggle("mood-heat", !!heat);
      runner.classList.toggle("mood-dust", !!dust);
      runner.classList.toggle("mood-wind", !!wind);
      const feel = w && w.feel != null ? Math.round(w.feel) : null;
      const gust = w && w.gust != null ? w.gust.toFixed(1) : null;
      const lines = [];
      if (dust) lines.push("모래먼지 많아요! 마스크 착용!", "시야 확보 주의!", "장비 운전 천천히!");
      if (heat) lines.push(feel ? `체감 ${feel}℃! 물 꼭 드세요` : "폭염! 물 꼭 드세요", "그늘에서 쉬어 가요!", "무리하지 않기!");
      if (wind) lines.push(gust ? `순간풍속 ${gust}m/s! 턱끈 꽉!` : "강풍! 턱끈 꽉!", "고소작업 주의!", "자재 날림 주의!");
      if (night) lines.push("야간작업 조명 확인!", "피곤하면 쉬어 가요!");
      window.hseMascotLines = lines;
      const mood = [heat && "heat", dust && "dust", wind && "wind"].filter(Boolean).join(",");
      if (mood && mood !== lastMood && window.hseMascotSay) window.hseMascotSay(lines[0]); // 상태가 바뀌면 바로 한마디
      lastMood = mood;
    }
    window.addEventListener("hse-weather", (e) => apply(e.detail));
    apply(window.hseWx || null);
    return true;
  }
  // 마스코트는 페이지가 뜬 뒤에 만들어지므로 잠시 기다렸다 연결
  (function waitMascot(n) { if (!setupMascotMood() && n < 40) setTimeout(() => waitMascot(n + 1), 250); })(0);

  /* ---------------- C) 공항 전광판식 숫자판 ---------------- */
  const FLAP_IDS = new Set(["incidentFreeDays", "constructionDays"]);
  function flapTo(el, target, onDone) {
    const text = Number(target).toLocaleString("ko-KR");
    el.dataset.value = target;
    el.setAttribute("aria-label", text);
    el.classList.add("flapboard");
    el.innerHTML = [...text].map((ch) => (/\d/.test(ch) ? `<span class="flap">0</span>` : `<span class="flap-sep">${ch}</span>`)).join("");
    const tiles = [...el.querySelectorAll(".flap")];
    const digits = [...text].filter((c) => /\d/.test(c));
    const t0 = performance.now();
    const settleAt = tiles.map((_, i) => 500 + i * 140);
    const done = new Array(tiles.length).fill(false);
    const timer = setInterval(() => {
      const t = performance.now() - t0;
      tiles.forEach((tile, i) => {
        if (done[i]) return;
        const v = t >= settleAt[i] ? digits[i] : String(Math.floor(Math.random() * 10));
        if (tile.textContent !== v) {
          tile.textContent = v;
          tile.classList.remove("flip"); void tile.offsetWidth; tile.classList.add("flip");
        }
        if (t >= settleAt[i]) done[i] = true;
      });
      if (done.every(Boolean)) { clearInterval(timer); if (onDone) onDone(target); }
    }, 70);
  }
  if (!reduce && typeof animateCount === "function") {
    const original = animateCount;
    // eslint-disable-next-line no-global-assign
    animateCount = function (el, target) {
      if (el && FLAP_IDS.has(el.id)) return flapTo(el, target, el.id === "incidentFreeDays" ? checkMilestone : null);
      return original(el, target);
    };
  }
  // 바그다드 자정이 지나면 두 숫자를 하루씩 올린다 (전광판이 넘어가는 장면)
  const dayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
  let today = dayKey();
  setInterval(() => {
    const k = dayKey();
    if (k === today) return;
    today = k;
    FLAP_IDS.forEach((id) => {
      const el = document.getElementById(id);
      const v = el && parseInt(el.dataset.value || String(el.textContent).replace(/[^\d]/g, ""), 10);
      if (v > 0) flapTo(el, v + 1, id === "incidentFreeDays" ? checkMilestone : null);
    });
  }, 60 * 1000);

  /* ---------------- D) 무재해 기념일 축하 ---------------- */
  let celebrated = false;
  function isMilestone(d) { return d > 0 && (d % 100 === 0 || d % 365 === 0 || d === 30 || d === 50); }
  function checkMilestone(days) {
    if (celebrated) return;
    const forced = params.get("celebrate") === "1";
    if (!forced && !isMilestone(days)) return;
    celebrated = true;
    // 인트로가 끝난 뒤에 터뜨린다
    (function wait() {
      if (document.querySelector(".hse-intro")) return setTimeout(wait, 400);
      celebrate(days);
    })();
  }
  function celebrate(days) {
    const yearsTxt = days % 365 === 0 ? ` (${days / 365}년)` : "";
    const banner = document.createElement("div");
    banner.className = "celebrate-banner";
    banner.innerHTML = `<b>무재해 ${days.toLocaleString()}일 달성${yearsTxt}</b><span>함께 지켜 주신 모든 분께 감사드립니다</span><button type="button" aria-label="닫기">×</button>`;
    document.body.appendChild(banner);
    banner.querySelector("button").onclick = () => banner.remove();
    if (reduce) return;
    const cv = document.createElement("canvas");
    cv.className = "confetti-canvas";
    document.body.appendChild(cv);
    const ctx = cv.getContext("2d");
    const W = (cv.width = window.innerWidth), H = (cv.height = window.innerHeight);
    const colors = ["#35d0c0", "#f2a93b", "#ffd166", "#ff7e79", "#4fb4ff", "#ffffff"];
    const parts = [];
    const burst = (x, y, n) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 9;
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 4, r: 3 + Math.random() * 4, c: colors[i % colors.length], rot: Math.random() * 6, life: 1 });
      }
    };
    // 폭죽 몇 발 + 위에서 꽃가루
    [[0.2, 0.35], [0.8, 0.3], [0.5, 0.22], [0.35, 0.45], [0.65, 0.42]].forEach(([fx, fy], i) => setTimeout(() => burst(W * fx, H * fy, 70), i * 450));
    for (let i = 0; i < 160; i++) parts.push({ x: Math.random() * W, y: -Math.random() * H, vx: (Math.random() - 0.5) * 1.5, vy: 1.5 + Math.random() * 2.5, r: 3 + Math.random() * 4, c: colors[i % colors.length], rot: Math.random() * 6, life: 1, flake: true });
    const t0 = performance.now();
    (function tick(now) {
      const t = now - t0;
      ctx.clearRect(0, 0, W, H);
      parts.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.rot += 0.1;
        if (!p.flake) { p.vy += 0.18; p.vx *= 0.985; p.life -= 0.008; } else { p.x += Math.sin(now / 300 + p.r) * 0.6; }
        ctx.save(); ctx.globalAlpha = Math.max(0, p.life) * (t > 6000 ? Math.max(0, 1 - (t - 6000) / 1500) : 1);
        ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
        ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore();
      });
      if (t < 7500) requestAnimationFrame(tick); else cv.remove();
    })(t0);
  }
  if (params.get("celebrate") === "1") {
    // 미리 보기: 숫자가 늦게 오더라도 축하가 나오게
    setTimeout(() => { const el = document.getElementById("incidentFreeDays"); checkMilestone(parseInt((el && el.dataset.value) || (el && el.textContent.replace(/[^\d]/g, "")) || "100", 10) || 100); }, 3000);
  }

  /* ---------------- E) 실시간 하늘색 배너 ---------------- */
  const bar = document.querySelector(".topbar");
  if (bar) {
    const sky = document.createElement("div");
    sky.className = "sky-layer";
    sky.innerHTML = '<div class="sky-body"></div>';
    bar.prepend(sky);
    const body = sky.querySelector(".sky-body");
    const rad = Math.PI / 180;
    // 간단한 태양 위치 계산 (NOAA 근사식)
    function sunInfo(date, lat, lon) {
      const start = Date.UTC(date.getUTCFullYear(), 0, 0);
      const doy = (date - start) / 86400000;
      const g = (2 * Math.PI / 365) * (doy - 1);
      const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
      const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
      const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
      const ha = ((utcMin + eqt + 4 * lon) / 4 - 180) * rad;
      const alt = Math.asin(Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(ha)) / rad;
      const h0 = Math.acos(Math.min(1, Math.max(-1, Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl)))) / rad;
      const noon = 720 - 4 * lon - eqt; // UTC 분
      return { alt, rise: noon - 4 * h0, set: noon + 4 * h0, utcMin };
    }
    const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    const hex = (c) => `rgb(${c.join(",")})`;
    const STOPS = [ // [고도, 위쪽색, 아래쪽색]
      [-18, [6, 10, 26], [12, 20, 46]],
      [-8, [22, 24, 64], [70, 42, 92]],
      [-2, [52, 40, 96], [196, 96, 64]],
      [4, [40, 70, 120], [232, 150, 80]],
      [15, [28, 88, 148], [120, 170, 210]],
      [40, [22, 96, 160], [80, 160, 220]],
    ];
    function colorsAt(alt) {
      if (alt <= STOPS[0][0]) return [STOPS[0][1], STOPS[0][2]];
      for (let i = 1; i < STOPS.length; i++) {
        if (alt <= STOPS[i][0]) {
          const t = (alt - STOPS[i - 1][0]) / (STOPS[i][0] - STOPS[i - 1][0]);
          return [mix(STOPS[i - 1][1], STOPS[i][1], t), mix(STOPS[i - 1][2], STOPS[i][2], t)];
        }
      }
      const last = STOPS[STOPS.length - 1];
      return [last[1], last[2]];
    }
    function update() {
      const forced = params.get("sky");
      let info = sunInfo(new Date(), SITE[1], SITE[0]);
      if (forced) info = { ...info, alt: { dawn: -3, day: 45, dusk: 2, night: -25 }[forced] ?? info.alt,
        utcMin: forced === "night" ? info.set + 180 : forced === "dawn" ? info.rise + 5 : forced === "dusk" ? info.set - 20 : (info.rise + info.set) / 2 };
      const [top, bottom] = colorsAt(info.alt);
      sky.style.background = `linear-gradient(180deg, ${hex(top)}, ${hex(bottom)})`;
      // 해: 해 뜰 때 왼쪽 → 질 때 오른쪽 / 달: 밤 동안 같은 방향으로
      const day = info.utcMin >= info.rise && info.utcMin <= info.set;
      let p;
      if (day) p = (info.utcMin - info.rise) / (info.set - info.rise);
      else {
        const nightLen = 1440 - (info.set - info.rise);
        const since = (info.utcMin - info.set + 1440) % 1440;
        p = since / nightLen;
      }
      body.className = `sky-body ${day ? "sun" : "moon"}`;
      body.style.left = `${4 + p * 92}%`;
      body.style.top = `${70 - Math.sin(Math.PI * p) * 55}%`;
    }
    update();
    setInterval(update, 60 * 1000);
  }
})();


/* ==========================================================
   첫 화면 깜빡임 막기
   - 달력·환율·언어 버튼은 위치 계산이 끝나기 전엔 숨겨 두었다가, 제자리에 놓인 뒤 서서히 보인다
   - 카드 영역도 글꼴과 기본 자료(무재해 일수 등)가 준비된 뒤 한 번에 나타난다 (최대 1.5초)
   ========================================================== */
(function antiFlicker() {
  const root = document.documentElement;
  const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  const pageLoaded = new Promise((r) => (document.readyState === "complete" ? r() : window.addEventListener("load", r, { once: true })));
  const dataReady = new Promise((r) => {
    const t0 = Date.now();
    (function check() {
      const el = document.getElementById("incidentFreeDays");
      const v = el && (el.dataset.value || el.textContent.replace(/[^\d]/g, ""));
      if ((v && v !== "0") || Date.now() - t0 > 1500) return r();
      setTimeout(check, 50);
    })();
  });
  // 옆 위젯: 글꼴이 정해진 뒤 위치를 한 번 더 잡고 보여 준다 (최대 1.2초)
  Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1200))]).then(() => {
    requestAnimationFrame(() => {
      if (typeof alignSideWidgets === "function") alignSideWidgets();
      requestAnimationFrame(() => root.classList.add("side-ready"));
    });
  });
  // 카드 영역
  Promise.race([Promise.all([fontsReady, dataReady]), new Promise((r) => setTimeout(r, 1500))]).then(() => {
    root.classList.add("page-ready");
    if (window.hsePlayEnter) window.hsePlayEnter();
  });
  pageLoaded.then(() => { if (typeof alignSideWidgets === "function") alignSideWidgets(); });
})();


/* ==========================================================
   보건 > 현장 클리닉 현황 (구글 시트 '클리닉' 탭 → Apps Script action=clinic)
   - 이름·사번은 Apps Script에서 이미 가려서 보내 준다
   ========================================================== */
// 화면 언어: 오른쪽 위 ENG·아랍어 버튼을 누르면 구글 번역 쿠키가 생긴다.
// 구글 번역은 나중에 그려지는 내용(클리닉 기록 등)을 놓치는 경우가 있어서, 이런 부분은 직접 영어로 그린다.
const UI_LANG = (document.cookie.match(/googtrans=\/[^/]*\/([a-zA-Z-]+)/) || [])[1] || "ko";
const UI_EN = UI_LANG !== "ko";
// 주의: 이름을 L 로 하면 지도 도구(Leaflet)의 L 을 가려서 모든 지도가 멈춘다
const TT = (ko, en) => (UI_EN ? en : ko);
const CLINIC_EN = {
  "질병": "Illness", "부상(업무 중)": "Injury (on duty)", "부상(업무 외)": "Injury (off duty)", "온열질환": "Heat illness",
  "건강상담": "Consultation", "기타": "Other", "투약": "Medication", "경과 관찰": "Observation", "처치": "Treatment",
  "휴식 후 복귀": "Rest & return", "외부 병원 후송": "Hospital transfer",
  "두통": "Headache", "근육통": "Muscle pain", "요통": "Back pain", "소화불량": "Indigestion", "감기": "Cold", "발열": "Fever",
  "찰과상": "Abrasion", "열상": "Laceration", "열사병 의심": "Suspected heatstroke", "탈수": "Dehydration",
  "눈 이물질": "Foreign body in eye", "복통": "Stomachache", "설사": "Diarrhea", "어지러움": "Dizziness", "기침": "Cough",
  "한화": "Hanwha", "협력사": "Subcontractor",
};
// 값 번역: 사전에 있으면 영어로, 쉼표로 나뉜 증상은 하나씩, 없으면 원문 그대로
const clinicTr = (v) => {
  if (!UI_EN || !v) return v || "";
  return String(v).split(/\s*,\s*/).map((t) => CLINIC_EN[t] || t.replace(/^협력사/, "Subcontractor ").replace(/^한화/, "Hanwha")).join(", ");
};

// 클리닉 안내: 운영 시간·연락처는 여기서 고치면 됩니다 (영어 화면용 문구도 함께)
const CLINIC_INFO = {
  hours: "매일 00:00 ~ 00:00 (24시간)",
  place: "BNCP 캠프 클리닉",
  contact: "0780-926-2446",
};
const CLINIC_INFO_EN = {
  hours: "Daily 00:00 – 00:00 (24 hours)",
  place: "BNCP Camp Clinic",
  contact: "0780-926-2446",
};
const CLINIC_CAT_COLOR = { "질병": "#4fb4ff", "부상(업무 중)": "#e5484d", "부상(업무 외)": "#ff7e79", "온열질환": "#f2a93b", "건강상담": "#35d0c0", "기타": "#8996a6" };
let clinicLoadedAt = 0;
// 증상 분류 (신체 계통 8가지). 한 사람이 여러 계통일 수 있어(예: 고혈압+당뇨) 여러 개를 쉼표로 저장한다
const SYMCATS = [
  ["호흡기계", "Respiratory", "#4fb4ff", /감기|기침|가래|콧물|코막힘|인후|목\s*아|편도|호흡|천식|폐렴|독감|인플루엔자|비염|cold|cough|flu|sore throat/i],
  ["근골격계", "Musculoskeletal", "#c792ea", /근육|요통|허리|어깨|무릎|관절|염좌|삠|담\s*결|근골|통풍|back pain|muscle|joint|sprain/i],
  ["소화기계", "Digestive", "#a3d977", /복통|배\s*아|설사|변비|소화|구토|구역|메스꺼|속쓰림|위염|장염|복부|식중독|역류|diarrh|vomit|stomach|nausea/i],
  ["신경계", "Neurological", "#ffcf5c", /두통|머리\s*아|편두통|어지러|현기증|실신|저림|마비|headache|dizz|faint/i],
  ["심혈관계", "Cardiovascular", "#ff6b6b", /고혈압|혈압|흉통|가슴|두근|부정맥|심장|협심|chest|blood pressure|hypertens|palpit/i],
  ["내분비계", "Endocrine", "#f2a93b", /당뇨|혈당|인슐린|갑상선|고지혈|콜레스테롤|diabet|glucose|thyroid/i],
  ["비뇨기계", "Urinary", "#5ad1e0", /소변|배뇨|빈뇨|혈뇨|요로|방광|신장|결석|전립선|urin|kidney|bladder/i],
  ["기타", "Other", "#8996a6", /./],
];
// 예전에 쓰던 분류 이름 → 지금 이름
const SYMCAT_OLD = { "호흡기": "호흡기계", "소화기": "소화기계", "신경계(두통·어지럼)": "신경계", "심혈관(흉통·혈압)": "심혈관계" };
// 기록 하나의 분류 목록 (저장된 값이 있으면 그것, 없으면 증상 글자로 자동 판단 — 여러 개 나올 수 있음)
function symCatsOf(x) {
  const saved = String(x.symCat || "").split(/\s*,\s*/).map((v) => SYMCAT_OLD[v] || v)
    .filter((v) => SYMCATS.some((c) => c[0] === v));
  if (saved.length) return [...new Set(saved)];
  const t = String(x.symptom || "");
  const hit = SYMCATS.slice(0, -1).filter((c) => c[3].test(t)).map((c) => c[0]);
  return hit.length ? hit : ["기타"];
}
const symCatOf = (x) => symCatsOf(x)[0];
// 부상 분류 (산업재해 통계 기준): 상해 종류(여러 개) · 발생 형태(하나)
const INJ_TYPES = [["찰과상","Abrasion"],["열상·베임","Laceration/cut"],["찔림","Puncture"],["타박상","Contusion"],["염좌·좌상","Sprain/strain"],["골절·탈구","Fracture/dislocation"],["화상","Burn"],["눈 손상","Eye injury"],["압궤·끼임 손상","Crush injury"],["절단","Amputation"],["기타","Other"]];
const INJ_CAUSES = [["떨어짐","Fall from height"],["넘어짐","Slip/trip"],["부딪힘","Collision"],["물체에 맞음","Struck by object"],["끼임","Caught in/between"],["깔림·뒤집힘","Crushed/overturned"],["절단·베임·찔림","Cut/stab"],["무너짐","Collapse"],["감전","Electric shock"],["화재·폭발","Fire/explosion"],["이상온도 접촉","Hot/cold contact"],["화학물질 접촉","Chemical contact"],["무리한 동작","Overexertion"],["교통사고","Vehicle accident"],["기타","Other"]];
const symCatInfo = (name) => SYMCATS.find((c) => c[0] === name) || SYMCATS[SYMCATS.length - 1];

async function loadClinic(force) {
  if (!force && Date.now() - clinicLoadedAt < 5 * 60 * 1000) return;
  document.getElementById("clinicInfo").innerHTML =
    (() => { const I = UI_EN ? CLINIC_INFO_EN : CLINIC_INFO;
      return `<span><b>${TT("운영", "Hours")}</b> ${escapeHtml(I.hours)}</span><span><b>${TT("위치", "Location")}</b> ${escapeHtml(I.place)}</span><span><b>${TT("연락", "Contact")}</b> ${escapeHtml(I.contact)}</span>`; })();
  const cards = document.getElementById("clinicCards");
  let rows;
  try {
    const url = await getAppsScriptUrl();
    if (!url) throw new Error("Apps Script 주소가 없습니다");
    const r = await (await fetch(url + (url.includes("?") ? "&" : "?") + "action=clinic&t=" + Date.now())).json();
    if (!r.ok) throw new Error(r.error || "불러오기 실패");
    rows = r.rows || [];
  } catch (e) {
    cards.innerHTML = `<p class="skeleton">${TT("진료 현황을 불러오지 못했습니다", "Could not load clinic data")} (${escapeHtml(e.message)})</p>`;
    return;
  }
  clinicLoadedAt = Date.now();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
  const dayMs = 86400000, tD = new Date(today + "T00:00:00Z");
  const daysAgo = (d) => Math.round((tD - new Date(d + "T00:00:00Z")) / dayMs);
  const inRange = (a, b) => rows.filter((x) => { const n = daysAgo(x.date); return n >= a && n <= b; });
  const todayRows = inRange(0, 0), week = inRange(0, 6), prevWeek = inRange(7, 13), month = inRange(0, 29);
  const referred = week.filter((x) => /후송/.test(x.action || "")).length;
  const heat = week.filter((x) => /온열/.test(x.cat || "")).length;
  const injury = week.filter((x) => /부상/.test(x.cat || "")).length;
  const diff = week.length - prevWeek.length;

  cards.innerHTML = `
    <div class="clinic-card"><span>${TT("오늘 진료", "Visits today")}</span><b>${todayRows.length}</b><small>${TT("건", "")}</small></div>
    <div class="clinic-card"><span>${TT("최근 7일", "Last 7 days")}</span><b>${week.length}</b><small>${TT("건", "")}</small>
      <em class="${diff > 0 ? "up" : diff < 0 ? "down" : ""}">${TT("전주 대비", "vs prev. week")} ${diff > 0 ? "▲" : diff < 0 ? "▼" : ""} ${Math.abs(diff)}</em></div>
    <div class="clinic-card ${injury ? "warn" : ""}"><span>${TT("부상 (7일)", "Injuries (7d)")}</span><b>${injury}</b><small>${TT("건", "")}</small></div>
    <div class="clinic-card ${heat ? "heat" : ""}"><span>${TT("온열질환 (7일)", "Heat illness (7d)")}</span><b>${heat}</b><small>${TT("건", "")}</small></div>
    <div class="clinic-card ${referred ? "danger" : ""}"><span>${TT("외부 병원 후송 (7일)", "Hospital transfers (7d)")}</span><b>${referred}</b><small>${TT("건", "")}</small></div>`;

  // 주별 추이 (구분별로 쌓기)
  const weeks = [3, 2, 1, 0].map((w) => ({ label: w === 0 ? TT("이번 주", "This week") : TT(`${w}주 전`, `${w}w ago`), rows: inRange(w * 7, w * 7 + 6) }));
  const max = Math.max(1, ...weeks.map((w) => w.rows.length));
  document.getElementById("clinicTrend").innerHTML = weeks.map((w) => {
    const byCat = {};
    w.rows.forEach((x) => { byCat[x.cat || "기타"] = (byCat[x.cat || "기타"] || 0) + 1; });
    return `<div class="ct-col"><div class="ct-bar" style="height:${(w.rows.length / max) * 100}%">${Object.entries(byCat).map(([c, n]) =>
      `<i style="flex:${n};background:${CLINIC_CAT_COLOR[c] || "#8996a6"}" title="${escapeHtml(clinicTr(c))} ${n}"></i>`).join("")}</div>
      <b>${w.rows.length}</b><span>${w.label}</span></div>`;
  }).join("") + `<div class="ct-legend">${Object.entries(CLINIC_CAT_COLOR).map(([c, col]) => `<span><i style="background:${col}"></i>${escapeHtml(clinicTr(c))}</span>`).join("")}</div>`;

  // 증상 분류별 (최근 30일): 막대 + 각 분류에서 많이 나온 세부 증상
  const byCat = {}, sym = {};
  month.forEach((x) => {
    const parts = String(x.symptom || "").split(/[,·/]/).map((t) => t.trim()).filter(Boolean);
    symCatsOf(x).forEach((c) => {
      (byCat[c] = byCat[c] || { n: 0, sub: {} }).n++;
      parts.forEach((t) => { byCat[c].sub[t] = (byCat[c].sub[t] || 0) + 1; });
    });
    parts.forEach((t) => { sym[t] = (sym[t] || 0) + 1; });
  });
  const catRows = Object.entries(byCat).sort((a, b) => b[1].n - a[1].n);
  const catMax = Math.max(1, ...catRows.map(([, v]) => v.n));
  document.getElementById("clinicTop").innerHTML = catRows.length
    ? catRows.map(([c, v]) => {
        const info = symCatInfo(c);
        const subs = Object.entries(v.sub).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => escapeHtml(clinicTr(t))).join(", ");
        const pct = Math.round((v.n / month.length) * 100);
        return `<li class="sc-row"><span class="sc-name"><i style="background:${info[2]}"></i>${escapeHtml(UI_EN ? info[1] : info[0])}</span>
          <span class="sc-bar"><b style="width:${(v.n / catMax) * 100}%;background:${info[2]}"></b></span>
          <span class="sc-n">${v.n}${TT("건", "")} <small>${pct}%</small></span>
          ${subs ? `<span class="sc-sub">${subs}</span>` : ""}</li>`;
      }).join("")
    : `<li>${TT("최근 30일 기록 없음", "No records in the last 30 days")}</li>`;

  // 부상 분석 (최근 30일): 상해 종류·발생 형태별 건수
  (function injuryStats() {
    const box = document.getElementById("clinicInjStats");
    if (!box) return;
    const inj = month.filter((x) => /부상/.test(x.cat || ""));
    if (!inj.length) { box.innerHTML = `<p class="cis-empty">${TT("최근 30일 부상 기록이 없습니다", "No injuries in the last 30 days")}</p>`; return; }
    const count = (getter) => { const m = {}; inj.forEach((x) => getter(x).forEach((v) => { m[v] = (m[v] || 0) + 1; })); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
    const types = count((x) => String(x.injType || "").split(/\s*,\s*/).filter(Boolean));
    const causes = count((x) => (x.injCause ? [x.injCause] : []));
    const onDuty = inj.filter((x) => /업무 중/.test(x.cat || "")).length;
    const tr = (list, v) => { const f = list.find((r) => r[0] === v); return UI_EN && f ? f[1] : v; };
    const bars = (rows, list, color) => rows.length ? rows.slice(0, 6).map(([v, n]) => `
      <li class="sc-row"><span class="sc-name"><i style="background:${color}"></i>${escapeHtml(tr(list, v))}</span>
      <span class="sc-n">${n}${TT("건", "")}</span>
      <span class="sc-bar"><b style="width:${(n / rows[0][1]) * 100}%;background:${color}"></b></span></li>`).join("")
      : `<li class="cis-none">${TT("입력된 내용 없음", "Not entered")}</li>`;
    box.innerHTML = `<p class="cis-sum">${TT("부상", "Injuries")} <b>${inj.length}</b>${TT("건", "")} · ${TT("업무 중", "on duty")} <b>${onDuty}</b> · ${TT("업무 외", "off duty")} <b>${inj.length - onDuty}</b></p>
      <div class="cis-cols"><div><div class="cis-h">${TT("상해 종류", "Injury type")}</div><ul class="clinic-top">${bars(types, INJ_TYPES, "#ff7e79")}</ul></div>
      <div><div class="cis-h">${TT("발생 형태", "Accident type")}</div><ul class="clinic-top">${bars(causes, INJ_CAUSES, "#f2a93b")}</ul></div></div>`;
  })();

  // 최근 기록 (가려진 이름·사번)
  const recent = rows.slice().sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || ""))).slice(0, 25);
  document.getElementById("clinicTable").innerHTML = `
    <thead><tr><th>${TT("날짜", "Date")}</th><th>${TT("시간", "Time")}</th><th>${TT("이름", "Name")}</th><th>${TT("사번", "ID")}</th><th>${TT("소속", "Company")}</th><th>${TT("구분", "Type")}</th><th>${TT("증상", "Symptoms")}</th><th>${TT("조치", "Action")}</th><th></th></tr></thead>
    <tbody>${recent.map((x) => `<tr>
      <td>${escapeHtml(x.date.slice(5).replace("-", "/"))}</td><td>${escapeHtml(x.time || "")}</td>
      <td>${escapeHtml(x.name || "")}</td><td class="mono">${escapeHtml(x.id || "")}</td><td>${escapeHtml(clinicTr(x.dept))}</td>
      <td><span class="clinic-cat" style="--c:${CLINIC_CAT_COLOR[x.cat] || "#8996a6"}">${escapeHtml(clinicTr(x.cat))}</span></td>
      <td>${/부상/.test(x.cat || "") && (x.injType || x.injCause)
        ? String(x.injType || "").split(/\s*,\s*/).filter(Boolean).map((v) => `<span class="sc-tag" style="--c:#ff7e79">${escapeHtml(UI_EN ? ((INJ_TYPES.find((r) => r[0] === v) || [])[1] || v) : v)}</span>`).join("")
          + (x.injCause ? `<span class="sc-tag" style="--c:#f2a93b">${escapeHtml(UI_EN ? ((INJ_CAUSES.find((r) => r[0] === x.injCause) || [])[1] || x.injCause) : x.injCause)}</span>` : "")
        : ""}${symCatsOf(x).map((c) => `<span class="sc-tag" style="--c:${symCatInfo(c)[2]}">${escapeHtml(UI_EN ? symCatInfo(c)[1] : c)}</span>`).join("")} ${escapeHtml(clinicTr(x.symptom))}</td><td class="${/후송/.test(x.action || "") ? "ref" : ""}">${escapeHtml(clinicTr(x.action))}</td>
      <td><button type="button" class="clinic-del" data-row="${x.row}" data-date="${escapeHtml(x.date)}" title="이 기록 삭제">×</button></td></tr>`).join("") ||
      `<tr><td colspan="9">${TT("아직 진료 기록이 없습니다. '+ 진료 기록 추가'로 입력해 주세요.", "No clinic records yet. Use '+ Add record' to enter one.")}</td></tr>`}</tbody>`;
  // 입력 도우미: 지금까지 쓴 소속·증상을 자동완성 목록으로
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].slice(0, 30);
  document.getElementById("clinicDeptList").innerHTML = uniq(rows.map((x) => x.dept)).map((v) => `<option value="${escapeHtml(v)}">`).join("");
  document.getElementById("clinicSymList").innerHTML = uniq(["두통", "근육통", "요통", "소화불량", "감기", "발열", "찰과상", "열상", "열사병 의심", "탈수", "눈 이물질", ...Object.keys(sym)])
    .map((v) => `<option value="${escapeHtml(v)}">`).join("");
  document.querySelectorAll(".clinic-del").forEach((b) => b.onclick = async () => {
    if (!confirm(TT("이 진료 기록을 삭제할까요? (시트에서도 지워집니다)", "Delete this record? (It will also be removed from the sheet)"))) return;
    b.disabled = true;
    try { await clinicCall("clinicDel", { row: Number(b.dataset.row), date: b.dataset.date }); await loadClinic(true); }
    catch (e) { alert(TT("삭제하지 못했습니다: ", "Could not delete: ") + e.message); b.disabled = false; }
  });
  document.getElementById("clinicMeta").textContent =
    TT(`구글 시트 '클리닉' 탭에서 불러옵니다 (최근 60일) · 이름과 사번은 일부를 가려서 표시합니다 · 불러온 시각 `, `From the 'Clinic' Google Sheet (last 60 days) · Names and IDs are partially masked · Updated `) + `${new Intl.DateTimeFormat(UI_EN ? "en-GB" : "ko-KR", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
}
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => { if (btn.dataset.view === "view-health-clinic") loadClinic(false); });
});

/* 클리닉: 사이트에서 바로 진료 기록 넣기 */
async function clinicCall(action, payload) {
  const url = await getAppsScriptUrl();
  if (!url) throw new Error("Apps Script 주소가 없습니다");
  let pw = "";
  try { pw = localStorage.getItem("wzPass") || ""; } catch (e) {}
  const go = async (p) => {
    const q = `action=${action}&payload=${encodeURIComponent(JSON.stringify({ ...payload, passcode: p }))}&t=${Date.now()}`;
    const r = await (await fetch(url + (url.includes("?") ? "&" : "?") + q)).json();
    if (!r.ok) throw new Error(r.error || "실패");
    return r;
  };
  try { return await go(pw); }
  catch (e) {
    if (!/암호/.test(e.message)) throw e;
    const p = prompt("저장 암호를 입력하세요") || "";
    try { localStorage.setItem("wzPass", p); } catch (er) {}
    return go(p);
  }
}
(function clinicForm() {
  const form = document.getElementById("clinicForm");
  const btn = document.getElementById("clinicAddBtn");
  if (!form || !btn) return;
  const msg = document.getElementById("clinicFormMsg");
  const reset = () => {
    const now = new Date();
    form.reset();
    form.querySelectorAll(".cf-cat.on").forEach((b) => b.classList.remove("on"));
    const ib = document.getElementById("clinicInj"); if (ib) ib.hidden = true;
    form.date.value = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(now);
    form.time.value = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  };
  btn.onclick = () => { form.hidden = !form.hidden; if (!form.hidden) { reset(); form.name.focus(); } msg.textContent = ""; };
  form.querySelectorAll(".cf-cat").forEach((b) => b.addEventListener("click", () => b.classList.toggle("on")));
  const injBox = document.getElementById("clinicInj");
  const syncInj = () => { if (injBox) injBox.hidden = !/부상/.test(form.cat.value); };
  form.cat.addEventListener("change", syncInj);
  // 시간 입력 쉽게: 숫자만 쳐도 되고(0930, 930, 14), 자동으로 '09:30' 꼴로 맞춘다. 24시간 기준
  const t = form.elements.time;
  const fmtTime = (raw) => {
    const d = String(raw).replace(/[^0-9]/g, "").slice(0, 4);
    if (!d) return "";
    let h, m;
    if (d.length <= 2) { h = +d; m = 0; }
    else if (d.length === 3) { h = +d[0]; m = +d.slice(1); }
    else { h = +d.slice(0, 2); m = +d.slice(2); }
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };
  t.addEventListener("input", () => {
    // 치는 동안: 숫자 4개가 되면 가운데 ':' 를 넣어 보여 준다
    const d = t.value.replace(/[^0-9]/g, "").slice(0, 4);
    t.value = d.length > 2 ? d.slice(0, d.length - 2) + ":" + d.slice(-2) : d;
    t.classList.remove("bad");
  });
  t.addEventListener("blur", () => {
    if (!t.value) return;
    const v = fmtTime(t.value);
    if (v === null) t.classList.add("bad"); else t.value = v;
  });
  const nowTime = () => new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  form.querySelectorAll(".cf-chip").forEach((c) => c.addEventListener("click", () => {
    if (c.hasAttribute("data-now")) { t.value = nowTime(); t.classList.remove("bad"); return; }
    const day = new Date(Date.now() + Number(c.dataset.day) * 86400000);
    form.date.value = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(day);
  }));
  document.getElementById("clinicCancel").onclick = () => { form.hidden = true; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (form.time.value) {
      const v = (function (raw) { const d = String(raw).replace(/[^0-9]/g, "").slice(0, 4); if (!d) return ""; let h, m;
        if (d.length <= 2) { h = +d; m = 0; } else if (d.length === 3) { h = +d[0]; m = +d.slice(1); } else { h = +d.slice(0, 2); m = +d.slice(2); }
        return h > 23 || m > 59 ? null : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; })(form.time.value);
      if (v === null) { msg.textContent = TT("시간을 확인해 주세요 (예: 0930, 14:20)", "Check the time (e.g. 0930, 14:20)"); msg.className = "err"; form.time.focus(); return; }
      form.time.value = v;
    }
    const data = Object.fromEntries(new FormData(form).entries());
    const picked = [...form.querySelectorAll(".cf-cat.on:not(.cf-injt)")].map((b) => b.dataset.v);
    data.symCat = (picked.length ? picked : symCatsOf({ symptom: data.symptom })).join(", ");
    if (/부상/.test(data.cat || "")) {
      data.injType = [...form.querySelectorAll(".cf-injt.on")].map((b) => b.dataset.v).join(", ");
    } else { data.injType = ""; data.injCause = ""; }
    const save = form.querySelector('button[type="submit"]');
    save.disabled = true; msg.textContent = TT("저장 중…", "Saving…"); msg.className = "";
    try {
      await clinicCall("clinicAdd", data);
      msg.textContent = TT(`저장했습니다 (${data.name.slice(0, 1)}*)`, `Saved (${data.name.slice(0, 1)}*)`); msg.className = "ok";
      reset(); form.name.focus();          // 이어서 다음 사람 입력
      await loadClinic(true);
    } catch (err) {
      msg.textContent = TT("저장하지 못했습니다: ", "Could not save: ") + err.message; msg.className = "err";
    } finally { save.disabled = false; }
  };
})();

/* 클리닉 화면의 고정 글자를 영어 화면에서 영어로 (입력칸 안내 글자는 구글 번역이 못 바꿈) */
(function clinicStaticEnglish() {
  if (!UI_EN) return;
  const panel = document.querySelector(".clinic-panel");
  if (!panel) return;
  panel.classList.add("notranslate"); // 직접 영어로 그리므로 구글 번역이 다시 손대지 않게
  const set = (sel, txt) => { const el = panel.querySelector(sel); if (el) el.textContent = txt; };
  set(".panel-label", "SITE CLINIC · Clinic visits");
  const subs = panel.querySelectorAll(".clinic-sub");
  if (subs[0]) subs[0].textContent = "Visits by week (last 4 weeks)";
  if (subs[1]) subs[1].textContent = "By body system (last 30 days, multiple counted)";
  if (subs[2] && subs[2].textContent.includes("부상")) subs[2].textContent = "Injury analysis (last 30 days)";
  if (subs[2]) subs[2].firstChild.nodeValue = "Recent records ";
  set("#clinicAddBtn", "+ Add record");
  const form = panel.querySelector("#clinicForm");
  const labels = { date: "Date", time: "Time", name: "Name", id: "Employee ID", dept: "Company", cat: "Type", symptom: "Symptoms (detail)", action: "Action", note: "Note (not shown on site)" };
  SYMCATS.forEach(([ko, en]) => { CLINIC_EN[ko] = en; });
  INJ_TYPES.forEach(([k, e]) => form.querySelectorAll(`.cf-injt[data-v="${k}"]`).forEach((b) => { b.textContent = e; }));
  form.querySelectorAll(".cf-cat:not(.cf-injt)").forEach((b) => { b.textContent = CLINIC_EN[b.dataset.v] || b.dataset.v; });
  form.querySelectorAll('select[name="injCause"] option').forEach((o) => { if (o.value) { const f = INJ_CAUSES.find((r) => r[0] === o.value); if (f) o.textContent = f[1]; } else o.textContent = "Not selected"; });
  const injLab = form.querySelector("#clinicInj .cf-cats-label"); if (injLab) injLab.innerHTML = "Injury type <small>multiple allowed</small>";
  const causeLab = form.querySelector(".cf-cause"); if (causeLab && causeLab.firstChild.nodeType === 3) causeLab.firstChild.nodeValue = "Accident type";
  const catLabel = form.querySelector(".cf-cats-label");
  if (catLabel) catLabel.innerHTML = "Symptom group <small>multiple allowed · auto if none selected</small>";
  const ph = { name: "e.g. Mohammed Ali", id: "e.g. 1234567", dept: "e.g. Hanwha, Subcontractor", symptom: "e.g. Headache, Muscle pain (comma-separated)", note: "Internal memo" };
  Object.entries(labels).forEach(([k, v]) => {
    const input = form.elements[k];
    if (!input) return;
    const lab = input.closest("label");
    if (lab && lab.firstChild && lab.firstChild.nodeType === 3) lab.firstChild.nodeValue = v;
    if (ph[k]) input.placeholder = ph[k];
  });
  // 고르기 목록: 시트에는 한국어 값으로 저장되도록 value 는 그대로, 보이는 글자만 영어로
  form.querySelectorAll("select option").forEach((o) => { o.value = o.hasAttribute("value") ? o.value : o.textContent; o.textContent = CLINIC_EN[o.value] ?? o.value; });
  form.querySelectorAll(".cf-chip").forEach((c) => { c.textContent = c.hasAttribute("data-now") ? "Now" : c.dataset.day === "0" ? "Today" : "Yesterday"; });
  if (form.elements.time) form.elements.time.placeholder = "e.g. 0930 → 09:30";
  const btns = form.querySelectorAll(".clinic-form-actions button");
  if (btns[0]) btns[0].textContent = "Save";
  if (btns[1]) btns[1].textContent = "Close";
})();


/* ==========================================================
   AI 법령 도우미 (오른쪽 아래 💬)
   질문·현장 사진 → 구글 Apps Script(doPost, action=chat) → 관련 조문 검색 + Gemini 답변
   한국 산업안전보건법령(kr-laws.json)과 이라크 법령(Apps Script 안의 자료)을 근거로 답한다.
   ========================================================== */
(function hseAssistant() {
  let scriptUrl = "";
  const history = [];          // {role, text}
  let pendingImage = null;     // {mime, data, url}
  let busy = false;

  const esc = (v) => String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // 간단한 마크다운 → HTML (### 제목, - 목록, **굵게**, [조문] 표시)
  function md(text) {
    const lines = esc(text).split(/\n/);
    let html = "", inList = false;
    const inline = (t) => t
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]\n]{2,40}?제\d+조[^\]\n]{0,20})\]/g, '<span class="ai-cite">$1</span>');
    for (const raw of lines) {
      const ln = raw.trim();
      const h = ln.match(/^#{2,4}\s*(.+)$/);
      const li = ln.match(/^[-*•]\s+(.+)$/) || ln.match(/^\d+[.)]\s+(.+)$/);
      if (li) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
      if (inList) { html += "</ul>"; inList = false; }
      if (h) html += /AI 검색 보충|참고:/.test(h[1]) ? `<h5 class="ai-h-ref">${inline(h[1])}</h5>` : `<h5>${inline(h[1])}</h5>`;
      else if (ln) html += `<p>${inline(ln)}</p>`;
    }
    if (inList) html += "</ul>";
    return html;
  }

  const SUGGEST = [
    "고소작업 안전난간 설치 기준",
    "밀폐공간 작업 전에 할 일",
    "현장 클리닉에 의사가 몇 명 필요해?",
    "이라크 연장근로 한도는?",
    "건설 분진 날림 방지 의무",
  ];

  const root = document.createElement("div");
  root.className = "ai-assist";
  root.innerHTML = `
    <button type="button" class="ai-fab" aria-label="AI 법령 도우미 열기">
      <img src="assets/mascot.png" alt="" draggable="false"><span>법령 도우미</span>
    </button>
    <section class="ai-panel" role="dialog" aria-label="AI 법령 도우미" hidden>
      <header class="ai-head">
        <div>
          <b>HSE 법령 도우미</b>
          <small>한국 산업안전보건법령 · 이라크 노동·환경법 근거로 답해요</small>
        </div>
        <button type="button" class="ai-close" aria-label="닫기">✕</button>
      </header>
      <div class="ai-log" aria-live="polite">
        <div class="ai-msg ai-bot ai-hello">
          <p>질문하거나 📷 현장 사진을 올려 보세요. 관련 조문을 찾아 <b>한국 법</b>과 <b>이라크 법</b>을 나란히 알려 드려요.</p>
          <div class="ai-sugs">${SUGGEST.map((q) => `<button type="button">${esc(q)}</button>`).join("")}</div>
        </div>
      </div>
      <div class="ai-preview" hidden><img alt="첨부한 사진"><button type="button" aria-label="사진 빼기">✕</button></div>
      <form class="ai-form">
        <label class="ai-photo" title="현장 사진 올리기">📷<input type="file" accept="image/*" hidden></label>
        <textarea rows="1" placeholder="예) 비계 작업발판 폭 기준은?" maxlength="800"></textarea>
        <button type="submit" class="ai-send" aria-label="보내기">➤</button>
      </form>
      <p class="ai-foot">참고용 답변이에요. 법적 판단은 원문을 확인하세요 · 사진에 얼굴·이름표·간판·도면이 크게 나오지 않게 해 주세요</p>
    </section>`;
  document.body.appendChild(root);

  const $ = (sel) => root.querySelector(sel);
  const panel = $(".ai-panel"), log = $(".ai-log"), ta = $("textarea"), form = $(".ai-form");
  const fileIn = $(".ai-photo input"), preview = $(".ai-preview");

  function open(v) {
    panel.hidden = !v;
    root.classList.toggle("is-open", v);
    if (v) setTimeout(() => ta.focus(), 50);
  }
  $(".ai-fab").onclick = () => open(panel.hidden);
  $(".ai-close").onclick = () => open(false);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) open(false); });

  root.querySelectorAll(".ai-sugs button").forEach((b) => b.onclick = () => { ta.value = b.textContent; send(); });
  ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(120, ta.scrollHeight) + "px"; });
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  form.addEventListener("submit", (e) => { e.preventDefault(); send(); });

  // 사진: 긴 변 1280px JPEG로 줄여 보낸다 (다시 그리면 위치정보 등 사진 속 정보도 지워짐)
  fileIn.addEventListener("change", async () => {
    const f = fileIn.files && fileIn.files[0];
    fileIn.value = "";
    if (!f) return;
    try {
      const url = URL.createObjectURL(f);
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const dataUrl = c.toDataURL("image/jpeg", 0.82);
      pendingImage = { mime: "image/jpeg", data: dataUrl.split(",")[1], url: dataUrl };
      preview.querySelector("img").src = dataUrl;
      preview.hidden = false;
      ta.placeholder = "사진에 대해 물어보세요 (비워 두면 위험요소를 찾아 드려요)";
    } catch (e) {
      alert("사진을 읽지 못했습니다. 다른 사진으로 해 주세요.");
    }
  });
  preview.querySelector("button").onclick = () => { pendingImage = null; preview.hidden = true; ta.placeholder = "예) 비계 작업발판 폭 기준은?"; };

  function bubble(role, html) {
    const d = document.createElement("div");
    d.className = `ai-msg ai-${role}`;
    d.innerHTML = html;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  async function getUrl() {
    if (scriptUrl) return scriptUrl;
    const r = await fetch("work-zones.json", { cache: "no-store" });
    const j = await r.json();
    scriptUrl = String(j.appsScriptUrl || "").trim();
    if (!scriptUrl) throw new Error("work-zones.json 에 appsScriptUrl 이 없습니다");
    return scriptUrl;
  }

  async function send() {
    const q = ta.value.trim();
    if (busy || (!q && !pendingImage)) return;
    const img = pendingImage;
    bubble("user", (img ? `<img class="ai-thumb" src="${img.url}" alt="첨부 사진">` : "") + (q ? `<p>${esc(q)}</p>` : ""));
    ta.value = ""; ta.style.height = "auto";
    pendingImage = null; preview.hidden = true;
    ask(q, img, null);
  }

  // 질문을 보내고 답을 그린다. 붐빌 때는 조금 기다렸다가 자동으로 한 번 더 시도하고,
  // 그래도 조문만 받았으면 "AI 답변 다시 받기" 버튼을 붙인다.
  async function ask(q, img, target) {
    if (busy) return;
    busy = true;
    const waitHtml = (t) => `<p><span class="ai-dots"><i></i><i></i><i></i></span> ${t}</p>`;
    const wait = target || bubble("bot ai-wait", "");
    wait.className = "ai-msg ai-bot ai-wait";
    wait.innerHTML = waitHtml(img ? "사진을 살펴보고 관련 조문을 찾는 중…" : "관련 조문을 찾는 중…");
    const call = async () => {
      const url = await getUrl();
      let pass = "";
      try { pass = localStorage.getItem("wzPass") || ""; } catch (e) {}
      let res;
      if (!img) {
        // 글 질문은 GET 으로 보낸다 (작업구역·클리닉과 같은 방식이라 가장 안정적).
        // 주소 길이를 줄이려고 내용을 base64(웹 안전)로 바꿔 넣는다.
        const body = JSON.stringify({ q, history: history.slice(-4).map((h) => ({ role: h.role, text: String(h.text).slice(0, 300) })), passcode: pass });
        const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(body))).replace(/\+/g, "-").replace(/\//g, "_");
        res = await fetch(url + (url.includes("?") ? "&" : "?") + "action=chat&p=" + encodeURIComponent(b64) + "&t=" + Date.now());
      } else {
        res = await fetch(url, {
          method: "POST",
          body: JSON.stringify({ action: "chat", q, history: history.slice(-6), image: { mime: img.mime, data: img.data }, passcode: pass }),
        });
      }
      const raw = await res.text();
      let j;
      try { j = JSON.parse(raw); } catch (e) {
        // Apps Script가 JSON 대신 오류 화면(HTML)을 보낸 경우: 화면 속 오류 문장을 꺼내 보여 준다
        const msg = (raw.match(/<div[^>]*>([^<]{8,200})<\/div>/) || raw.match(/<title>([^<]+)<\/title>/) || [])[1] || "";
        throw new Error("Apps Script가 오류 화면을 보냈습니다" + (msg ? ` (${msg.trim()})` : "") +
          (img ? ". 사진 질문 연결에 문제가 있어요. 글로 질문하면 답을 받을 수 있어요."
               : ". Apps Script의 Code.gs 에 chat 한 줄을 넣고 '배포 관리 → 새 버전 배포'를 했는지 확인해 주세요."));
      }
      return j;
    };
    try {
      let j = await call();
      // 붐빔: 8초 쉬고 자동으로 한 번 더
      if ((j.ok && j.degraded) || (!j.ok && /붐빕니다/.test(j.error || ""))) {
        wait.innerHTML = waitHtml("AI 서버가 붐벼서 잠시 후 다시 시도하는 중…");
        await new Promise((r) => setTimeout(r, 8000));
        const j2 = await call();
        if (j2.ok || !j.ok) j = j2;
      }
      if (!j.ok) throw new Error(j.error || "답을 받지 못했습니다");
      const src = (j.sources || []);
      const cited = src.slice(0, Math.max(j.citedCount || 0, 0));
      const others = src.slice(cited.length);
      const chip = (s) => `<a class="ai-src ${s.kr ? "kr" : "iq"}" href="${esc(s.link)}" target="_blank" rel="noopener noreferrer" title="${esc(s.name)}${s.t ? " · " + esc(s.t) : ""}"><i>${s.kr ? "한국" : "이라크"}</i>${esc(s.law.replace(/^이라크\s*/, ""))} ${esc(s.no)}</a>`;
      wait.className = "ai-msg ai-bot" + (j.degraded ? " ai-degraded" : "");
      wait.innerHTML = md(j.answer) +
        (cited.length ? `<div class="ai-srcs"><span>근거 조문</span>${cited.map(chip).join("")}</div>` : "") +
        ((j.web || []).length ? `<div class="ai-srcs ai-web"><span>웹 출처</span>${j.web.map((w) => `<a class="ai-src web" href="${esc(w.uri)}" target="_blank" rel="noopener noreferrer"><i>웹</i>${esc(String(w.title).slice(0, 40))}</a>`).join("")}</div>` : "") +
        (others.length ? `<details class="ai-more"><summary>${j.degraded ? "찾은 조문 전체" : "함께 찾은 조문"} ${others.length}개</summary><div class="ai-srcs">${others.map(chip).join("")}</div></details>` : "") +
        (j.degraded ? `<button type="button" class="ai-retry">AI 답변 다시 받기</button>` : "");
      if (j.degraded) {
        wait.querySelector(".ai-retry").onclick = () => ask(q, img, wait);
      } else {
        history.push({ role: "user", text: q || "(사진 점검)" }, { role: "bot", text: j.answer });
      }
    } catch (err) {
      wait.className = "ai-msg ai-bot ai-err";
      wait.innerHTML = `<p>답을 받지 못했어요. ${esc(err.message || err)}</p><button type="button" class="ai-retry">다시 시도</button>`;
      wait.querySelector(".ai-retry").onclick = () => ask(q, img, wait);
    } finally {
      busy = false;
      log.scrollTop = log.scrollHeight;
    }
  }
})();


/* ==========================================================
   탭 배경 사진 미리 받기
   첫 화면이 다 뜬 뒤 다른 탭 사진도 미리 받아 '디코딩'까지 해 둔다.
   그래야 탭을 눌렀을 때 사진이 한참 뒤에 바뀌지 않고 바로 부드럽게 넘어간다.
   ========================================================== */
(function preloadTabBackgrounds() {
  const names = ["dashboard", "safety", "health", "env", "fire", "etc"];
  const keep = [];   // 받은 사진을 잡아 두어 브라우저가 버리지 않게
  const run = () => names.forEach((n, i) => setTimeout(() => {
    const im = new Image();
    im.decoding = "async";
    im.src = `assets/bg-${n}-opt.webp`;
    if (im.decode) im.decode().catch(() => {});
    keep.push(im);
  }, i * 300));
  const start = () => (window.requestIdleCallback ? requestIdleCallback(run, { timeout: 3000 }) : setTimeout(run, 800));
  if (document.readyState === "complete") start(); else window.addEventListener("load", start, { once: true });
})();
