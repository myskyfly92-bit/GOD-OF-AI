/* 비스마야 HSE 상황실 — 휴대폰 전용 화면
   PC 상황판과 같은 데이터(../*.json, Apps Script, Open-Meteo 등)를 그대로 읽어서
   휴대폰에 맞게 '요약 카드 + 목록'으로 다시 보여 준다. */
(function () {
  "use strict";
  const TZ = "Asia/Baghdad", LAT = 33.193, LON = 44.618;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString("en-US");
  const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} } };
  ls.set("hsePC", null);   // 모바일 화면을 직접 열었으면 'PC로 보기' 선택을 풀어 준다

  // JSON 은 10분 단위로 캐시를 깨서 최신본을 받는다
  const bust = () => Math.floor(Date.now() / 600000);
  const J = {};
  const getJ = (name) => J[name] || (J[name] = fetch("../" + name + "?t=" + bust()).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }));
  const ext = (url, ms) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms || 15000);
    return fetch(url, { signal: c.signal }).then((r) => r.json()).finally(() => clearTimeout(t)); };
  let scriptUrl = null;
  const gas = (q) => (scriptUrl || (scriptUrl = getJ("work-zones.json").then((w) => (w.appsScriptUrl || "").trim())))
    .then((u) => { if (!u) throw new Error("no script"); return ext(u + (u.includes("?") ? "&" : "?") + q + "&t=" + Date.now(), 20000); });

  const ago = (iso) => { const m = (Date.now() - Date.parse(iso)) / 60000; if (!(m >= 0)) return "";
    return m < 60 ? Math.max(1, Math.round(m)) + "분 전" : m < 1440 ? Math.round(m / 60) + "시간 전" : Math.round(m / 1440) + "일 전"; };
  const md = (iso) => { const d = String(iso || "").slice(0, 10).split("-"); return d.length === 3 ? `${+d[1]}/${+d[2]}` : ""; };
  const card = (id) => document.getElementById(id);
  const fill = (id, html) => { const c = card(id); const h = c.querySelector("h3"); c.innerHTML = (h ? h.outerHTML : "") + html; };
  const fail = (id, msg) => fill(id, `<p class="empty">${esc(msg || "지금은 불러오지 못했습니다. 잠시 뒤 다시 열어 보세요.")}</p>`);
  // 눌러서 펼치는 목록 (공지·사례·대사관 등)
  document.addEventListener("click", (e) => { const it = e.target.closest(".item.fold"); if (it && !e.target.closest("a")) it.classList.toggle("open"); });

  /* ---------------- 이름 가운데 글자 가리기 (PC 상황판과 같은 규칙) ---------------- */
  const NAME_KEEP = /^(성명|대리|과장|차장|부장|사원|주임|대표|소장|반장|팀장|조장|기사|이사|상무|전무|담당|감독|책임|선임|수석|매니저|관리자|기능공|협력사|한화|직영|외주|본사|현장|캠프|전원|미정|없음|휴무|안전|보건|환경|공무|관리|품질|공정|설비|전기|기계|토목|건축)$|(관리자|담당자?|팀장|반장|소장|조장|과장|부장|차장|대리|주임|사원|기사|감독관?|공|신호수|유도원|감시인|감시자|작업자|운전원|기능원|업체|건설|팀|조)$/;
  const KO_SURNAME = "남궁제갈선우독고김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예봉경사부황보";
  const maskName = (s) => String(s || "").replace(/[가-힣]+/g, (w) => {
    if (w.length < 2 || w.length > 4 || NAME_KEEP.test(w) || !KO_SURNAME.includes(w[0])) return w;
    return w.length === 2 ? w[0] + "○" : w[0] + "○".repeat(w.length - 2) + w[w.length - 1];
  });

  /* ---------------- 시계 ---------------- */
  const tf = (tz) => new Intl.DateTimeFormat("ko-KR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  function clock() { $("#clk").textContent = tf(TZ).format(new Date()); $("#clk2").textContent = "바그다드 · 한국 " + tf("Asia/Seoul").format(new Date()); }
  clock(); setInterval(clock, 15000);

  /* ---------------- 아래 탭 ---------------- */
  const loaded = {};
  const LOAD = { home: loadHome, safety: loadSafety, health: loadHealth, env: loadEnv, more: () => {} };
  function go(p) {
    document.querySelectorAll(".page").forEach((s) => s.classList.toggle("on", s.id === "p-" + p));
    document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.p === p));
    window.scrollTo(0, 0);
    if (!loaded[p]) { loaded[p] = true; LOAD[p](); }
    if (p === "more") showSub(null);
    ls.set("mTab", p);
  }
  $("#nav").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) go(b.dataset.p); });
  $("#toPc").addEventListener("click", () => ls.set("hsePC", "1"));
  document.querySelectorAll('a[href^="../?pc=1"]').forEach((a) => a.addEventListener("click", () => ls.set("hsePC", "1")));

  /* ---------------- 방문자 카운터 (PC 와 같은 집계) ---------------- */
  (function visit() {
    let vid = ls.get("vcSid"); if (!vid) { vid = Math.random().toString(36).slice(2, 12); ls.set("vcSid", vid); }
    const d = today(), hit = ls.get("vcDay") !== d;
    const tick = (h) => gas("action=visit&h=" + (h ? 1 : 0) + "&vid=" + vid).then((r) => {
      if (!r || !r.ok) return; if (h) ls.set("vcDay", d);
      $("#vc").innerHTML = `TODAY <b class="t">${fmt(r.today)}</b> · TOTAL <b>${fmt(r.total)}</b>` + (r.online > 0 ? ` · <b class="n">● ${r.online}</b>` : "");
    }).catch(() => {});
    tick(hit); setInterval(() => { if (!document.hidden) tick(false); }, 90000);
  })();

  /* ================================ 홈 ================================ */
  const KR_HOL = { "2026-10-03": "개천절", "2026-10-05": "개천절 대체공휴일", "2026-10-09": "한글날", "2026-12-25": "크리스마스", "2027-01-01": "신정" };
  const IQ_HOL = { "2026-10-03": "Iraqi National Day", "2026-12-10": "Victory Day", "2026-12-25": "Christmas Day", "2027-01-01": "New Year's Day", "2027-01-06": "Army Day" };
  const SITE_EV = { "2026-10-15": "얼음물 배부 종료", "2026-10-20": "안전보건교육 (이라크인·TCN 근로자)" };
  const HEAT = [
    { max: 35, key: "ok", label: "정상 작업", desc: "통상적인 수분 섭취 수칙을 지켜 주세요." },
    { max: 42, key: "caution", label: "주의 · 수분보충 강화", desc: "매시간 그늘 휴식과 수분 섭취를 의무화하세요." },
    { max: 46, key: "warn", label: "경고 · 옥외작업 단축", desc: "정오~오후 옥외작업을 줄이고 순환 근무를 적용하세요." },
    { max: Infinity, key: "danger", label: "위험 · 옥외작업 중지 권고", desc: "고온 노출 위험이 매우 높습니다." },
  ];
  const WX = (c) => c === 0 ? "☀️" : c <= 2 ? "⛅" : c === 3 ? "☁️" : c <= 48 ? "🌫️" : c <= 67 ? "🌧️" : c <= 77 ? "🌨️" : c <= 82 ? "🌦️" : "⛈️";
  const grade = (v, cuts) => v == null ? ["–", ""] : v <= cuts[0] ? ["좋음", "var(--cyan)"] : v <= cuts[1] ? ["보통", "var(--green)"] : v <= cuts[2] ? ["나쁨", "var(--amber)"] : ["매우나쁨", "var(--red)"];
  let WXDATA = null;
  const loadWx = () => WXDATA || (WXDATA = Promise.allSettled([
    ext(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&wind_speed_unit=ms&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,wind_gusts_10m&hourly=precipitation_probability&daily=sunrise,sunset,weathercode,temperature_2m_max,temperature_2m_min&forecast_days=7&timezone=${encodeURIComponent(TZ)}`),
    ext(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LON}&current=pm10,pm2_5,uv_index,dust&hourly=dust,pm10&forecast_days=3&timezone=${encodeURIComponent(TZ)}`),
  ]).then(([w, a]) => ({ w: w.status === "fulfilled" ? w.value : null, a: a.status === "fulfilled" ? a.value : null })));

  function loadHome() {
    // 무재해 · 공지 · 연락처
    getJ("data.json").then((d) => {
      const s = d.site || {};
      const days = (a) => Math.floor((Date.parse(today() + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
      if (s.lastIncidentDate) { $("#freeDays").innerHTML = fmt(days(s.lastIncidentDate)) + "<small>일</small>"; $("#lastInc").textContent = "최종 사고 기준일 " + s.lastIncidentDate; }
      if (s.constructionStartDate) $("#buildDays").innerHTML = fmt(days(s.constructionStartDate) + 1) + "<small>일째</small>";
      const rank = { "긴급": 0, "주의": 1, "안내": 2 };
      const ns = (d.notices || []).slice().sort((a, b) => (rank[a.level] ?? 3) - (rank[b.level] ?? 3));
      fill("noticeCard", ns.length ? `<ul class="list">${ns.map((n) => `<li class="item fold"><div class="t"><span class="tag ${n.level === "긴급" ? "red" : n.level === "주의" ? "amb" : ""}">${esc(n.level)}</span> ${esc(n.title)}</div>
        <div class="m">${esc(n.date)}</div><div class="b">${esc(n.body)}</div></li>`).join("")}</ul>` : `<p class="empty">새 공지가 없습니다.</p>`);
      if (d.iqdOfficial) J._iqd = d.iqdOfficial;
    }).catch(() => fail("noticeCard"));

    // 날씨·작업환경
    loadWx().then(({ w, a }) => {
      if (!w || !w.current) return fail("envCard", "날씨 서버가 잠시 응답하지 않습니다.");
      const c = w.current, ac = (a && a.current) || {};
      const ref = c.apparent_temperature ?? c.temperature_2m, lv = HEAT.find((t) => ref < t.max);
      const pm = grade(ac.pm10, [30, 80, 150]);
      const h = new Date().getHours();
      const rain = (w.hourly && w.hourly.precipitation_probability || []).slice(h, h + 12);
      const dd = w.daily || {};
      const days = (dd.time || []).map((t, i) => `<div class="day"><span>${i === 0 ? "오늘" : "일월화수목금토"[new Date(t + "T12:00:00Z").getUTCDay()]}</span><i>${WX(dd.weathercode[i])}</i><b>${Math.round(dd.temperature_2m_max[i])}°</b> <span>${Math.round(dd.temperature_2m_min[i])}°</span></div>`).join("");
      fill("envCard", `<div class="env-top"><div class="env-temp num">${c.temperature_2m.toFixed(0)}<small>°C</small></div>
        <div><span class="stage ${lv.key}">${esc(lv.label)}</span><div class="env-desc">체감 ${ref.toFixed(1)}°C · ${esc(lv.desc)}</div></div></div>
        <div class="stat-grid">
          <div class="stat"><span>습도</span><b>${c.relative_humidity_2m}<em>%</em></b></div>
          <div class="stat"><span>바람 (돌풍)</span><b>${c.wind_speed_10m.toFixed(1)}<em>(${(c.wind_gusts_10m ?? 0).toFixed(0)}) m/s</em></b></div>
          <div class="stat"><span>미세먼지 PM10</span><b style="color:${pm[1]}">${pm[0]}<em>${ac.pm10 != null ? Math.round(ac.pm10) : ""}</em></b></div>
          <div class="stat"><span>자외선</span><b>${ac.uv_index != null ? ac.uv_index.toFixed(0) : "–"}</b></div>
          <div class="stat"><span>강수 (12시간)</span><b>${rain.length ? Math.max(...rain) : 0}<em>%</em></b></div>
          <div class="stat"><span>일출 · 일몰</span><b style="font-size:13px">${(dd.sunrise || [""])[0].slice(11, 16)} · ${(dd.sunset || [""])[0].slice(11, 16)}</b></div>
        </div><div class="days">${days}</div><div class="src">Open-Meteo 실시간 · 체감온도 기준 단계 (35 / 42 / 46°C)</div>`);
    });

    // 오늘 작업
    loadWork().then((items) => {
      if (!items) return fail("workCard", "작업일정을 불러오지 못했습니다.");
      const t = today(), dow = "월화수목금토일"[(new Date(t + "T00:00:00Z").getUTCDay() + 6) % 7];
      const list = items.filter((x) => x.date ? x.date === t : x.day === dow).sort((a, b) => (b.risks.length > 0) - (a.risks.length > 0));
      const crew = list.reduce((s, x) => s + x.crew, 0), risky = list.filter((x) => x.risks.length).length;
      fill("workCard", `<div class="kpis"><div class="kpi cy"><span>오늘 작업</span><b class="num">${list.length}</b><small>건</small></div>
        <div class="kpi"><span>투입 인원</span><b class="num">${fmt(crew)}</b><small>명</small></div>
        <div class="kpi ${risky ? "red" : ""}"><span>⚠ 위험작업</span><b class="num">${risky}</b><small>건</small></div></div>
        ${list.length ? `<ul class="list" style="margin-top:10px">${list.slice(0, 6).map(workLi).join("")}</ul>` + (list.length > 6 ? `<p class="src">외 ${list.length - 6}건 · 안전 탭에서 이번 주 전체 보기</p>` : "") : `<p class="empty" style="margin-top:8px">오늘 등록된 작업이 없습니다.</p>`}`);
    });

    // 이라크 공휴일 선포 · 통행금지·도로 통제 (홈 맨 위)
    getJ("iraq-issues.json").then((d) => {
      const L = (d.alerts || []).filter((a) => Date.now() - Date.parse(a.date) < 36 * 3600000);
      if (!L.length) return;
      $("#iqAlert").innerHTML = L.map((a) => `<a class="alert ${a.kind === "holiday" ? "hol" : ""}" href="${esc(a.link)}" target="_blank" rel="noopener"><span class="ic">${a.kind === "holiday" ? "🗓️" : "⛔"}</span><span>
        <div class="m" style="font-weight:700">${a.kind === "holiday" ? "이라크 공휴일·휴무 발표" : "통행금지·도로 통제"}</div><div class="t">${esc(a.titleKo || a.title)}</div>
        <div class="m">${esc(a.source || "")}${a.count > 1 ? " 외 " + (a.count - 1) + "곳" : ""} · ${ago(a.date)}</div></span></a>`).join("");
    }).catch(() => {});

    // 중대재해 보도 (홈 위쪽 띠)
    getJ("sa-news.json").then((d) => {
      const it = (d.items || []).filter((x) => Date.now() - Date.parse(x.date) < 72 * 3600000);
      if (!it.length) return;
      const x = it[0];
      $("#homeAlert").innerHTML = `<a class="alert" href="#" id="alertGo"><span class="ic">🚨</span><span><div class="t">${x.company ? `<span class="co">${esc(x.company)}</span> · ` : ""}${esc(x.titleKo || x.title)}</div>
        <div class="m">중대재해 보도 · ${esc(x.source)}${x.count > 1 ? " 외 · 보도 " + x.count + "건" : ""} · ${ago(x.date)}${it.length > 1 ? ` · 최근 3일 ${it.length}건 보기 ›` : ""}</div></span></a>`;
      $("#alertGo").addEventListener("click", (e) => { e.preventDefault(); go("safety"); });
    }).catch(() => {});

    // 다가오는 일정
    const t0 = Date.parse(today() + "T00:00:00Z"), ev = [];
    const addAll = (o, kind) => Object.keys(o).forEach((k) => { const dt = Date.parse(k + "T00:00:00Z"); if (dt >= t0 && dt - t0 <= 60 * 86400000) ev.push([k, kind, o[k]]); });
    addAll(SITE_EV, "site"); addAll(KR_HOL, "kr"); addAll(IQ_HOL, "iq");
    ev.sort((a, b) => a[0].localeCompare(b[0]));
    fill("calCard", ev.length ? `<ul class="list">${ev.slice(0, 6).map(([k, kind, n]) => {
      const dd = Math.round((Date.parse(k + "T00:00:00Z") - t0) / 86400000);
      return `<li class="item"><div class="t">${kind === "site" ? "📌 " : kind === "kr" ? "🇰🇷 " : "🇮🇶 "}${esc(n)}</div><div class="m">${md(k)} (${"일월화수목금토"[new Date(k + "T00:00:00Z").getUTCDay()]}) · ${dd === 0 ? "오늘" : "D-" + dd}</div></li>`; }).join("")}</ul>
      <p class="src">이라크 이슬람력 공휴일은 달 관측에 따라 ±1일 바뀔 수 있습니다.</p>` : `<p class="empty">60일 안에 예정된 일정이 없습니다.</p>`);

    // 환율
    Promise.allSettled([getJ("market-fx.json"), getJ("data.json")]).then(([m, d]) => {
      const fx = m.value || {}, off = (d.value && d.value.iqdOfficial) || {};
      fill("fxCard", `<div class="kpis" style="grid-template-columns:1fr 1fr">
        <div class="kpi"><span>USD → IQD 공식고시</span><b class="num" style="font-size:20px">${fmt(off.rate || fx.usdIqdOfficial)}</b><small>디나르</small></div>
        <div class="kpi amb"><span>USD → IQD 시장</span><b class="num" style="font-size:20px">${fx.usdIqdParallel ? fmt(Math.round(fx.usdIqdParallel)) : "–"}</b><small>환전소 참고 · ${fx.generatedAt ? ago(fx.generatedAt) : ""}</small></div></div>`);
    });
  }

  function workLi(x) {
    return `<li class="item"><div class="t">${x.risks.length ? `<span class="tag red">⚠ ${esc(x.risks.join("·"))}</span> ` : ""}${esc(x.work)}</div>
      <div class="m">${[x.wtime && "🕒 " + esc(x.wtime), x.zone && "📍 " + esc(x.zone) + (x.loc ? " · " + esc(x.loc) : ""), x.part && esc(x.part), x.crew && "👥 " + x.crew + "명", x.person && "👷 " + esc(maskName(x.person))].filter(Boolean).join(" · ")}</div></li>`;
  }

  // 작업일정: Apps Script → 안 되면 시트 웹 게시 CSV
  let WORK = null;
  function loadWork() {
    if (WORK) return WORK;
    const parseCsv = (text) => { const rows = []; let row = [], cell = "", q = false;
      for (let i = 0; i < text.length; i++) { const ch = text[i];
        if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
        else if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; }
        else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += ch; }
      if (cell !== "" || row.length) { row.push(cell); rows.push(row); } return rows.filter((r) => r.some((c) => c.trim() !== "")); };
    const pDate = (v) => { v = (v || "").trim(); let m = v.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null; };
    return WORK = getJ("work-zones.json").then(async (w) => {
      let rows = null;
      if (w.appsScriptUrl) { try { const j = await gas("x=1"); if (j && j.ok) rows = j.rows; } catch (e) {} }
      if (!rows && w.sheetCsvUrl) { const r = await fetch(w.sheetCsvUrl + (w.sheetCsvUrl.includes("?") ? "&" : "?") + "t=" + Date.now()); rows = parseCsv(await r.text()); }
      if (!rows || !rows.length) return [];
      const head = rows[0].map((h) => String(h).replace(/\s|\(.*?\)/g, ""));
      // 이름 순서대로 찾는다 ('작업'으로 찾을 때 '작업시간·작업인원' 칸은 건너뜀)
      const col = (...n) => { for (const x of n) { const i = head.findIndex((h) => h.startsWith(x) && !(x === "작업" && /^작업(시간|인원)/.test(h))); if (i >= 0) return i; } return -1; };
      const c = { date: col("날짜", "일자"), day: col("요일"), zone: col("구역"), part: col("파트"), work: col("작업내용", "작업"), loc: col("세부위치", "위치"),
        risk: col("위험작업", "위험"), person: col("담당"), crew: col("작업인원", "인원"), wtime: col("작업시간") };
      const g = (r, i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : "");
      const DAYS = "월화수목금토일";
      return rows.slice(1).map((r) => { const date = pDate(g(r, c.date)); let day = g(r, c.day).replace("요일", "");
        if (date) day = DAYS[(new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7];
        const rt = g(r, c.risk);
        return { date, day, zone: g(r, c.zone), part: g(r, c.part), work: g(r, c.work), loc: g(r, c.loc), risks: rt ? rt.split(/[,/·\s]+/).filter(Boolean) : [],
          person: g(r, c.person), crew: parseInt(g(r, c.crew).replace(/[^\d]/g, ""), 10) || 0, wtime: g(r, c.wtime) }; })
        .filter((x) => x.work && (x.date || DAYS.includes(x.day)));
    }).catch(() => null);
  }

  /* ================================ 안전 ================================ */
  function loadSafety() {
    getJ("sa-news.json").then((d) => {
      const it = d.items || [];
      fill("saNewsCard", it.length ? `<ul class="list">${it.slice(0, 12).map((x) => `<li class="item"><a href="${esc(x.link || x.url)}" target="_blank" rel="noopener">
        <div class="t">${x.company ? `<span class="co">${esc(x.company)}</span> · ` : ""}${esc(x.titleKo || x.title)}</div>
        <div class="m">${esc(x.source)}${x.count > 1 ? ` 외 · <span class="tag red">보도 ${x.count}건</span>` : ""} · ${ago(x.date)}</div></a></li>`).join("")}</ul>
        <p class="src">언론 보도 제목을 그대로 옮긴 것입니다 · 첫 보도는 사실과 다를 수 있으니 원문과 고용노동부 발표를 확인하세요.</p>` : `<p class="empty">최근 7일 보도된 사고가 없습니다.</p>`);
    }).catch(() => fail("saNewsCard"));

    getJ("serious-accidents.json").then((d) => {
      const ind = d.byIndustry || [], tot = ind.reduce((s, x) => s + Number(x.total || 0), 0);
      const col = { construction: "amb", manufacturing: "", etc: "cy" };
      fill("saStatCard", `<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:10px"><b class="num" style="font-size:40px;color:#ff7a77;line-height:1">${fmt(tot)}</b><span style="color:var(--muted)">명 · ${esc(d.period)}</span>
        ${d.totalYoy != null ? `<span class="tag ${Number(d.totalYoy) < 0 ? "cy" : "red"}" style="margin-left:auto">전년 대비 ${Number(d.totalYoy) > 0 ? "+" : ""}${d.totalYoy}%</span>` : ""}</div>
        <div class="kpis">${ind.map((x) => `<div class="kpi ${col[x.key] || ""}"><span>${esc(x.name)}</span><b class="num">${x.total}</b><small>${tot ? Math.round(x.total / tot * 100) : 0}%</small></div>`).join("")}</div>
        ${(d.topFactors || []).length ? `<div style="margin-top:12px">${d.topFactors.map((f) => `<div class="prow"><span>${esc(f.axis.replace("별", ""))}</span><div><div style="font-size:12.5px;color:var(--text)">${esc(f.label)}</div><div class="bar"><i class="amb" style="width:${Math.min(100, f.pct)}%"></i></div></div><b>${f.pct}%</b></div>`).join("")}</div>` : ""}
        <p class="src">출처: ${esc(d.source)} · ${esc(d.updatedAt)} 반영</p>`);
    }).catch(() => fail("saStatCard"));

    loadWork().then((items) => {
      if (!items) return fail("weekCard", "작업일정을 불러오지 못했습니다.");
      const t = today(), base = new Date(t + "T00:00:00Z"), mon = new Date(base - ((base.getUTCDay() + 6) % 7) * 86400000);
      const DAYS = "월화수목금토일"; let html = "";
      for (let i = 0; i < 7; i++) { const dt = new Date(+mon + i * 86400000).toISOString().slice(0, 10);
        const list = items.filter((x) => x.date ? x.date === dt : x.day === DAYS[i]);
        html += `<div style="margin:${i ? 12 : 0}px 0 2px;font-size:12.5px;font-weight:700;color:${dt === t ? "var(--cyan)" : "var(--muted)"}">${DAYS[i]} ${md(dt)}${dt === t ? " · 오늘" : ""} <span style="color:var(--dim);font-weight:500">${list.length ? list.length + "건" : "작업 없음"}</span></div>`;
        if (list.length) html += `<ul class="list">${list.map(workLi).join("")}</ul>`; }
      fill("weekCard", html + `<p class="src">공사팀·관리재경팀 작업일정 시트 · 지도는 PC 화면 '작업구역'에서</p>`);
    });

    getJ("kosha-cases.json").then((d) => {
      const all = d.items || []; let f = "건설업";
      const draw = () => { const it = all.filter((x) => f === "전체" || x.business === f).slice(0, 15);
        fill("caseCard", `<div class="chips">${["건설업", "전체", "제조업"].map((c) => `<button class="chip ${c === f ? "on" : ""}" data-f="${c}">${c}</button>`).join("")}</div>
          <ul class="list">${it.map((x) => `<li class="item fold"><div class="t"><span class="tag amb">${esc(x.type)}</span> ${esc(x.title)}</div>
          <div class="m">${esc(x.business)} · ${esc(x.accidentDate)} · ${esc(x.place || "")}</div><div class="b">${esc(x.contents)}</div></li>`).join("")}</ul>
          <p class="src">출처: 안전보건공단 국내재해사례 · 눌러서 내용 보기</p>`);
        card("caseCard").querySelectorAll(".chip").forEach((b) => b.onclick = (e) => { e.stopPropagation(); f = b.dataset.f; draw(); }); };
      draw();
    }).catch(() => fail("caseCard"));

    getJ("kosha-guides.json").then((d) => {
      const all = d.guides || [];
      const draw = () => { const q = $("#guideQ").value.trim().toLowerCase();
        const it = (q ? all.filter((g) => (g.nm + " " + g.no + " " + g.cat).toLowerCase().includes(q)) : all).slice(0, 12);
        $("#guideList").innerHTML = it.map((g) => `<li class="item"><a href="${esc(g.url)}" target="_blank" rel="noopener"><div class="t">${esc(g.nm)}</div><div class="m"><span class="tag bl">${esc(g.no)}</span> ${esc(g.cat)} · ${esc(g.ymd)} · 내려받기 ↗</div></a></li>`).join("") || `<li class="empty">찾는 지침이 없습니다.</li>`; };
      $("#guideQ").addEventListener("input", draw); draw();
    }).catch(() => { $("#guideList").innerHTML = `<li class="empty">지침 목록을 불러오지 못했습니다.</li>`; });
  }

  /* ================================ 보건 ================================ */
  function loadHealth() {
    gas("action=emrStats").then((em) => {
      if (!em || !em.ok || !em.data || !Array.isArray(em.data.rows)) throw 0;
      const rows = []; em.data.rows.forEach((t) => { for (let i = 0; i < (Number(t[7]) || 1); i++) rows.push({ date: t[0], cat: t[1], sym: t[2], symptom: t[3], action: t[4] }); });
      const tD = Date.parse(today() + "T00:00:00Z"), ago = (d) => Math.round((tD - Date.parse(d + "T00:00:00Z")) / 86400000);
      const r = (a, b) => rows.filter((x) => { const n = ago(x.date); return n >= a && n <= b; });
      const t0 = r(0, 0), wk = r(0, 6), mo = r(0, 29);
      const cnt = {}; mo.forEach((x) => String(x.sym || "기타").split(/\s*,\s*/).forEach((k) => { if (k) cnt[k] = (cnt[k] || 0) + 1; }));
      const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 5), mx = top.length ? top[0][1] : 1;
      fill("clinicCard", `<div class="kpis"><div class="kpi cy"><span>오늘</span><b class="num">${t0.length}</b><small>건</small></div>
        <div class="kpi"><span>최근 7일</span><b class="num">${wk.length}</b><small>건</small></div>
        <div class="kpi ${wk.filter((x) => /후송/.test(x.action || "")).length ? "red" : ""}"><span>병원 후송 (7일)</span><b class="num">${wk.filter((x) => /후송/.test(x.action || "")).length}</b><small>건</small></div></div>
        ${top.length ? `<div style="margin-top:12px;font-size:12px;color:var(--muted)">최근 30일 많은 증상 계통</div>${top.map(([k, v]) => `<div class="prow"><span style="grid-column:span 1">${esc(k.replace("계", ""))}</span><div class="bar"><i style="width:${v / mx * 100}%"></i></div><b>${v}</b></div>`).join("")}` : ""}
        <p class="src">BNCP Clinic EMR 자동 집계 · 개인정보 없이 건수만 · 운영 24시간 · <a href="tel:07809262446" style="color:var(--cyan)">0780-926-2446</a></p>`);
    }).catch(() => fill("clinicCard", `<p class="empty">진료 통계를 불러오지 못했습니다.</p><p class="src">클리닉 24시간 운영 · <a href="tel:07809262446" style="color:var(--cyan)">0780-926-2446</a></p>`));

    getJ("medical-facilities.json").then((d) => {
      const it = (d.items || []).filter((x) => x.kind === "hospital" || x.emergency === true || x.emergency === "True").sort((a, b) => a.km - b.km).slice(0, 6);
      fill("medCard", `<ul class="list">${it.map((x) => `<li class="item"><div class="t">${esc(x.nameEn || x.name)} ${x.emergency === true || x.emergency === "True" ? '<span class="tag red">응급실</span>' : ""}</div>
        <div class="m">${[x.nameAr && x.nameAr !== x.nameEn ? esc(x.nameAr) : "", "직선 " + x.km + "km"].filter(Boolean).join(" · ")}</div>
        <a class="link" href="https://www.google.com/maps/dir/?api=1&destination=${x.lat},${x.lon}" target="_blank" rel="noopener">길찾기 ↗</a>${x.phone ? ` · <a class="link" href="tel:${esc(x.phone)}">전화</a>` : ""}</li>`).join("")}</ul>
        <p class="src">🚑 응급 시 먼저 현장 클리닉(0780-926-2446)과 이라크 긴급전화 911 · 출처 OpenStreetMap</p>`);
    }).catch(() => fail("medCard"));

    getJ("kdca-infectious.json").then((d) => {
      const g = d.grades || {};
      fill("kdcaCard", `<div class="kpis">${["제1급", "제2급", "제3급"].map((k, i) => { const x = g[k] || {}; const diff = (x.base || 0) - (x.prev || 0);
        return `<div class="kpi ${i === 0 ? (x.base > 0 ? "red" : "cy") : ""}"><span>${k}</span><b class="num">${fmt(x.base)}</b><small>${diff ? (diff > 0 ? "▲" : "▼") + fmt(Math.abs(diff)) : "–"}</small></div>`; }).join("")}</div>
        <ul class="list" style="margin-top:10px">${(d.top || []).slice(0, 5).map((x) => `<li class="item"><div class="t" style="font-size:13.5px">${esc(x.name)}</div><div class="m">${esc(x.grade)} · ${fmt(x.base)}건 (전주 ${fmt(x.prev)})${Number(x.outnatn) ? " · 해외유입 " + x.outnatn : ""}</div></li>`).join("")}</ul>
        <p class="src">질병관리청 · ${esc((d.baseWeek || {}).label || "")} 기준</p>`);
    }).catch(() => fail("kdcaCard"));

    getJ("health-issues.json").then((d) => {
      fill("hiCard", `<ul class="list">${(d.items || []).slice(0, 10).map((x) => `<li class="item"><a href="${esc(x.link || x.url)}" target="_blank" rel="noopener"><div class="t" style="font-size:14px">${esc(x.titleKo || x.title)}</div><div class="m">${esc(x.source)} · ${ago(x.date)}${x.lang && x.lang !== "ko" ? ' · <span class="tag">번역</span>' : ""}</div></a></li>`).join("")}</ul>`);
    }).catch(() => fail("hiCard"));
  }

  /* ================================ 환경 ================================ */
  function loadEnv() {
    loadWx().then(({ a }) => {
      if (!a || !a.hourly) return fail("dustCard", "대기질 예보를 불러오지 못했습니다.");
      const t = a.hourly.time, v = a.hourly.dust, pm = a.hourly.pm10;
      const now = Date.now(); let s = t.findIndex((x) => Date.parse(x + ":00+03:00") >= now - 3600000); if (s < 0) s = 0;
      const vals = v.slice(s, s + 48), times = t.slice(s, s + 48), mx = Math.max(50, ...vals.filter((x) => x != null));
      const peak = vals.reduce((b, x, i) => x > vals[b] ? i : b, 0);
      const lvl = (x) => x >= 300 ? ["매우 높음", "var(--red)"] : x >= 150 ? ["높음", "#ff8a3d"] : x >= 60 ? ["보통", "var(--amber)"] : ["낮음", "var(--green)"];
      const pk = lvl(vals[peak] || 0);
      const bars = vals.map((x, i) => `<rect x="${i * 6}" y="${60 - (x || 0) / mx * 58}" width="4.5" height="${(x || 0) / mx * 58 + 1}" rx="1.5" fill="${lvl(x || 0)[1]}" opacity="${i === peak ? 1 : .75}"/>`).join("");
      fill("dustCard", `<div style="display:flex;justify-content:space-between;align-items:baseline"><div><span style="font-size:12px;color:var(--muted)">48시간 최고</span><div style="font-size:22px;font-weight:800;color:${pk[1]}">${pk[0]} <span class="num" style="font-size:14px;color:var(--muted)">${Math.round(vals[peak] || 0)} ㎍/㎥</span></div></div>
        <div style="text-align:right;font-size:12px;color:var(--muted)">가장 높을 때<br><b style="color:var(--text)">${md(times[peak])} ${String(times[peak]).slice(11, 16)}</b></div></div>
        <svg viewBox="0 0 288 62" style="width:100%;height:80px;margin-top:10px">${bars}</svg>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--dim)"><span>지금</span><span>+24시간</span><span>+48시간</span></div>
        <p class="src">Open-Meteo 모래먼지(dust) 예보 · 현재 PM10 ${pm[s] != null ? Math.round(pm[s]) : "–"} ㎍/㎥ · 높을 때는 보안경·마스크 착용, 고소·크레인 작업 주의</p>`);
    });

    getJ("aqi-rank.json").then((d) => {
      const s = d.site || {}, iq = (d.countries || []).find((x) => x.iso2 === "IQ"), bg = (d.cities || []).find((x) => /바그다드/.test(x.city));
      fill("aqiCard", `<div class="kpis"><div class="kpi cy"><span>비스마야 현장</span><b class="num">${s.aqi ?? "–"}</b><small>AQI · ${esc(s.grade || "")}</small></div>
        <div class="kpi"><span>이라크 순위</span><b class="num">${iq ? iq.rank : "–"}</b><small>/ ${(d.countries || []).length}개국</small></div>
        <div class="kpi"><span>바그다드</span><b class="num">${bg ? bg.rank : "–"}</b><small>/ ${(d.cities || []).length}개 도시</small></div></div>
        <p class="src">AQI 미국 EPA 기준 · 숫자가 클수록 나쁨 · WAQI·Open-Meteo · ${d.generatedAt ? ago(d.generatedAt) : ""}</p>`);
    }).catch(() => fail("aqiCard"));

    getJ("fires.json").then((d) => {
      const nb = d.nearby || {};
      fill("fireCard", `<div class="kpis"><div class="kpi ${nb.count ? "red" : "cy"}"><span>현장 ${nb.radiusKm || 10}km 이내</span><b class="num">${nb.count || 0}</b><small>최근 24시간</small></div>
        <div class="kpi amb"><span>이라크 신규</span><b class="num">${fmt(d.newCount)}</b><small>48시간</small></div>
        <div class="kpi"><span>상시 열원</span><b class="num">${fmt(d.persistentCount)}</b><small>가스 플레어 등</small></div></div>
        ${(nb.closest || []).length ? `<ul class="list" style="margin-top:10px">${nb.closest.slice(0, 3).map((f) => `<li class="item"><div class="t">${f.distanceKm}km · 강도 ${f.frp}MW</div><div class="m">${ago(f.time)} · ${esc(f.sensor)}</div></li>`).join("")}</ul>` : ""}
        <p class="src">NASA FIRMS 위성 감지 · 위성 통과 시점 기준이라 수 시간 전 상황 · 지도는 PC 화면 '화재 현황'</p>`);
    }).catch(() => fail("fireCard"));

    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    ext(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${since}&latitude=${LAT}&longitude=${LON}&maxradiuskm=800&minmagnitude=3.5&orderby=time&limit=30`, 15000).then((d) => {
      const f = d.features || [];
      const km = (la, lo) => { const R = 6371, r = Math.PI / 180, dLa = (la - LAT) * r, dLo = (lo - LON) * r;
        return Math.round(2 * R * Math.asin(Math.sqrt(Math.sin(dLa / 2) ** 2 + Math.cos(LAT * r) * Math.cos(la * r) * Math.sin(dLo / 2) ** 2))); };
      fill("quakeCard", f.length ? `<ul class="list">${f.slice(0, 10).map((q) => { const p = q.properties, c = q.geometry.coordinates, m = p.mag;
        return `<li class="item"><div class="t"><span class="tag ${m >= 5 ? "red" : m >= 4.5 ? "amb" : ""}">규모 ${m.toFixed(1)}</span> ${esc(p.place || "")}</div><div class="m">현장에서 ${km(c[1], c[0])}km · ${ago(new Date(p.time).toISOString())}</div></li>`; }).join("")}</ul>
        <p class="src">미국지질조사국(USGS) · 현장 800km 안, 규모 3.5 이상</p>` : `<p class="empty">최근 30일 현장 800km 안에 규모 3.5 이상 지진이 없습니다.</p>`);
    }).catch(() => fail("quakeCard", "지진 정보 서버가 응답하지 않습니다."));
  }

  /* ================================ 더보기 ================================ */
  const SUBS = {
    bnews: ["비스마야 소식", () => getJ("bismayah-news.json").then((d) => { let f = "전체"; const all = d.items || [];
      const draw = () => { const it = all.filter((x) => f === "전체" || (f === "국내" ? x.lang === "ko" : x.lang !== "ko")).slice(0, 30);
        $("#subBody").innerHTML = `<div class="chips">${["전체", "국내", "이라크"].map((c) => `<button class="chip ${c === f ? "on" : ""}" data-f="${c}">${c}</button>`).join("")}</div>
        <div class="card"><ul class="list">${it.map((x) => `<li class="item"><a href="${esc(x.link || x.url)}" target="_blank" rel="noopener"><div class="t" style="font-size:14px">${esc(x.titleKo || x.title)}</div>
        <div class="m">${x.lang !== "ko" ? '<span class="tag cy">이라크</span>' : ""}${esc(x.source)} · ${md(x.date)} (${ago(x.date)})</div></a></li>`).join("")}</ul><p class="src">구글 뉴스 검색 · 아랍어·영어 제목은 자동 번역</p></div>`;
        $("#subBody").querySelectorAll(".chip").forEach((b) => b.onclick = () => { f = b.dataset.f; draw(); }); }; draw(); })],
    iraq: ["이라크 주요 이슈", () => getJ("iraq-issues.json").then((d) => { let f = "전체"; const all = d.items || [];
      const TC = { "치안·테러": "red", "시위·통제": "amb", "휴일·행사": "vio", "날씨·재난": "amb", "전력·생활": "cy" };
      const tags = ["전체"].concat(["치안·테러", "시위·통제", "휴일·행사", "정치·선거", "전력·생활", "날씨·재난", "경제·유가", "한국·외교", "기타"].filter((t) => all.some((x) => x.tag === t)));
      const draw = () => { const it = all.filter((x) => f === "전체" || x.tag === f).slice(0, 40);
        $("#subBody").innerHTML = `<div class="chips">${tags.map((c) => `<button class="chip ${c === f ? "on" : ""}" data-f="${c}">${c}</button>`).join("")}</div>
        <div class="card"><ul class="list">${it.map((x) => `<li class="item"><a href="${esc(x.link || x.url)}" target="_blank" rel="noopener"><div class="t" style="font-size:14px">${esc(x.titleKo || x.title)}</div>
        <div class="m">${x.tag ? `<span class="tag ${TC[x.tag] || ""}">${esc(x.tag)}</span> ` : ""}${x.count > 1 ? `보도 ${x.count}건 · ` : ""}${esc(x.source)} · ${md(x.date)} (${ago(x.date)})</div></a></li>`).join("") || '<li class="empty">최근 7일 기사가 없습니다.</li>'}</ul><p class="src">구글 뉴스 검색 · 최근 7일 · 분류는 제목으로 자동 판정 · 아랍어·영어 제목은 자동 번역</p></div>`;
        $("#subBody").querySelectorAll(".chip").forEach((b) => b.onclick = () => { f = b.dataset.f; draw(); }); }; draw(); })],
    embassy: ["대사관 안전공지", () => getJ("embassy-notices.json").then((d) => { let f = "이라크"; const all = d.items || [];
      const cs = ["이라크", "전체"].concat((d.countries || []).map((c) => c.name).filter((n) => n !== "이라크"));
      const draw = () => { const it = all.filter((x) => f === "전체" || x.country === f).slice(0, 30);
        $("#subBody").innerHTML = `<div class="chips">${cs.map((c) => `<button class="chip ${c === f ? "on" : ""}" data-f="${c}">${c}</button>`).join("")}</div>
        <div class="card"><ul class="list">${it.map((x) => `<li class="item fold"><div class="t" style="font-size:14px">${x.kind === "안전공지" ? '<span class="tag red">안전</span> ' : ""}${esc(String(x.title).replace(/ /g, " "))}</div>
        <div class="m">${esc(x.country)} · ${esc(x.date)}</div><div class="b">${esc(String(x.body || "").slice(0, 1200))}</div></li>`).join("") || '<li class="empty">공지가 없습니다.</li>'}</ul><p class="src">외교부 해외안전여행 · 눌러서 내용 보기</p></div>`;
        $("#subBody").querySelectorAll(".chip").forEach((b) => b.onclick = () => { f = b.dataset.f; draw(); }); }; draw(); })],
    travel: ["주변국 여행경보", () => getJ("travel-alarm.json").then((d) => {
      const ids = ["IQ", "IR", "SY", "JO", "KW", "SA", "TR", "LB", "IL", "PS", "YE", "AE", "QA", "BH", "OM", "EG"];
      const it = ids.map((k) => d.countries[k]).filter(Boolean).sort((a, b) => b.level - a.level);
      $("#subBody").innerHTML = `<div class="card"><ul class="list">${it.map((c) => `<li class="item" style="display:flex;align-items:center;gap:12px"><span class="lv lv${c.level}">${c.level}단계</span>
        <div><div class="t">${esc(c.name)}</div><div class="m">${esc(c.levelName)}${c.partial === true || c.partial === "True" ? " · 일부 지역 기준" : ""}</div></div></li>`).join("")}</ul>
        <p class="src">외교부 국가·지역별 여행경보 · 1 유의 · 2 자제 · 3 출국권고 · 4 금지</p></div>`; })],
    global: ["건설사 해외현장", () => Promise.all([getJ("overseas-projects.json"), getJ("dart-progress.json").catch(() => ({}))]).then(([o, g]) => {
      const cos = {}; (o.companies || []).forEach((c) => cos[c.id] = c); const pm = g.matches || {};
      const el = (p) => { const m = String(p.period || "").match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/); if (!m) return null;
        const a = Date.parse(m[1]), b = Date.parse(m[2]); return Math.max(0, Math.min(100, Math.round((Date.now() - a) / (b - a) * 100))); };
      const ps = (o.projects || []).slice().sort((a, b) => (b.company === "hanwha") - (a.company === "hanwha") || (pm[b.name] ? 1 : 0) - (pm[a.name] ? 1 : 0));
      $("#subBody").innerHTML = `<div class="card"><ul class="list">${ps.slice(0, 40).map((p) => { const e = el(p), pr = pm[p.name];
        const rows = (e != null ? `<div class="prow"><span>기간</span><div class="bar"><i class="gray" style="width:${e}%"></i></div><b>${e}%</b></div>` : "") +
          (pr && pr.parts ? pr.parts.map((x) => `<div class="prow"><span>${esc(x.label)}</span><div class="bar"><i class="amb" style="width:${x.rate}%"></i></div><b>${x.rate}%</b></div>`).join("")
            : pr ? `<div class="prow"><span>공정</span><div class="bar"><i style="width:${Math.round(pr.rate)}%"></i></div><b>${Math.round(pr.rate)}%</b></div>` : "");
        return `<li class="item"><div class="t" style="font-size:14px">${esc(p.name)}</div><div class="m"><span class="tag">${esc((cos[p.company] || {}).name || p.company)}</span>${esc(p.country)} · ${esc(p.amount || "")}</div>${rows}</li>`; }).join("")}</ul>
        <p class="src">DART 전자공시 · 공정률은 정기보고서 기준</p></div>`; })],
    contacts: ["연락처", () => getJ("data.json").then((d) => {
      const cs = (d.emergencyContacts || []).filter((c) => c.phone && !/^0+[-0]*$/.test(c.phone.replace(/\s/g, "")));
      $("#subBody").innerHTML = `<div class="card"><h3>긴급</h3>
        <div class="call"><span>현장 클리닉 (24시간)</span><a href="tel:07809262446">0780-926-2446</a></div>
        <div class="call"><span>이라크 긴급전화</span><a href="tel:911">911</a></div>
        ${cs.map((c) => `<div class="call"><span>${esc(c.role)}</span><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></div>`).join("")}</div>
        <p class="src">번호를 누르면 바로 전화가 걸립니다.</p>`; })],
  };
  function showSub(key) {
    $("#moreHome").hidden = !!key; $("#moreSub").hidden = !key;
    if (!key) return;
    $("#subTitle").textContent = SUBS[key][0]; $("#subBody").innerHTML = `<div class="card"><div class="skel"></div><div class="skel"></div></div>`;
    window.scrollTo(0, 0);
    SUBS[key][1]().catch(() => { $("#subBody").innerHTML = `<div class="card"><p class="empty">불러오지 못했습니다. 잠시 뒤 다시 열어 보세요.</p></div>`; });
  }
  document.querySelectorAll("[data-sub]").forEach((b) => b.addEventListener("click", () => showSub(b.dataset.sub)));
  $("#subBack").addEventListener("click", () => showSub(null));

  /* ---------------- 사고·응급 신고 (위치 공유) ----------------
     누른 순간 GPS 를 한 번 읽어 구글 지도 링크가 들어간 신고 문구를 만들고,
     문자·왓츠앱·전화 앱을 내용이 채워진 채로 열어 준다. 보내기는 사람이 직접 누른다. */
  (function sos() {
    const box = $("#sos"), bg = $("#sosBg"), msg = $("#sosMsg"), loc = $("#sosLoc");
    let kind = "부상자 발생", pos = null, edited = false;
    const stamp = () => new Intl.DateTimeFormat("ko-KR", { timeZone: TZ, month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    const text = () => `[🚨 비스마야 현장 사고·응급 신고]\n- 상황: ${kind}\n- 시각: ${stamp()} (바그다드)\n- 위치: ` +
      (pos ? `https://maps.google.com/?q=${pos.lat.toFixed(6)},${pos.lon.toFixed(6)} (오차 약 ${Math.round(pos.acc)}m)` : "위치 확인 불가 — 장소를 직접 적어 주세요") +
      `\n- 세부 위치/내용: `;
    const sync = () => {
      if (!edited) msg.value = text();
      const enc = encodeURIComponent(msg.value);
      $("#sosSms").href = "sms:?&body=" + enc;
      $("#sosWa").href = "https://wa.me/?text=" + enc;
    };
    msg.addEventListener("input", () => { edited = true; sync(); });
    $("#sosKind").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return;
      kind = b.dataset.k; $("#sosKind").querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === b));
      if (edited) msg.value = msg.value.replace(/- 상황: .*/, "- 상황: " + kind); sync(); });
    function locate() {
      pos = null; loc.className = "sos-loc"; loc.textContent = "📍 위치 확인 중… (처음이면 '위치 허용'을 눌러 주세요)"; sync();
      if (!navigator.geolocation) { loc.className = "sos-loc bad"; loc.textContent = "이 휴대폰에서는 위치를 읽을 수 없습니다. 장소를 직접 적어 주세요."; return; }
      navigator.geolocation.getCurrentPosition((p) => {
        pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
        loc.innerHTML = `📍 확인됨 · 오차 약 ${Math.round(pos.acc)}m · <a href="https://maps.google.com/?q=${pos.lat},${pos.lon}" target="_blank" rel="noopener">지도에서 보기</a>`;
        sync();
      }, (err) => {
        loc.className = "sos-loc bad";
        loc.innerHTML = (err.code === 1 ? "위치 사용이 꺼져 있습니다 (휴대폰 설정 또는 브라우저 권한)." : "위치를 찾지 못했습니다 (실내·지하는 잘 안 잡힐 수 있음).") +
          ' 장소를 직접 적어 주세요. <a href="#" id="sosRetry">다시 시도</a>';
        $("#sosRetry").onclick = (e) => { e.preventDefault(); locate(); };
        sync();
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    }
    const open = () => { edited = false; box.hidden = false; bg.hidden = false; document.body.style.overflow = "hidden"; locate(); };
    const close = () => { box.hidden = true; bg.hidden = true; document.body.style.overflow = ""; };
    document.querySelectorAll("[data-sos]").forEach((b) => b.addEventListener("click", open));
    $("#sosClose").addEventListener("click", close); bg.addEventListener("click", close);
    // 카카오톡: 카카오 개발자 앱(JavaScript 키, 등록 도메인 myskyfly92-bit.github.io)으로 카카오톡을 바로 연다.
    //   카카오 메시지의 링크는 등록 도메인만 허용 → 위치 버튼은 우리 사이트의 m/go.html 을 거쳐 구글 지도로 간다.
    //   SDK 를 못 불러오면 휴대폰 '공유하기' 창 → 그것도 없으면 복사 안내
    const KAKAO_KEY = "1f5c36ace6d178373c7e7d611eca9741";
    let kakaoP = null;
    const loadKakao = () => kakaoP || (kakaoP = new Promise((res, rej) => {
      if (window.Kakao) return res(window.Kakao);
      const sc = document.createElement("script");
      sc.src = "https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js"; sc.crossOrigin = "anonymous";
      sc.onload = () => window.Kakao ? res(window.Kakao) : rej(new Error("no Kakao"));
      sc.onerror = () => { kakaoP = null; rej(new Error("load fail")); };
      document.head.appendChild(sc);
    }));
    const fallbackShare = () => {
      if (navigator.share) navigator.share({ text: msg.value }).catch(() => {});
      else { $("#sosCopy").click(); alert("카카오톡을 바로 열지 못했습니다. 내용이 복사됐으니 카카오톡 대화방에 붙여 넣어 주세요."); }
    };
    $("#sosKakao").addEventListener("click", () => {
      loadKakao().then((K) => {
        if (!K.isInitialized()) K.init(KAKAO_KEY);
        const site = location.origin + location.pathname.replace(/[^/]*$/, "");
        const mapUrl = pos ? site + "go.html?q=" + pos.lat.toFixed(6) + "," + pos.lon.toFixed(6) : site;
        let text = msg.value.replace(/https:\/\/maps\.google\.com\/\?q=[\d.,-]+/, "아래 '위치 보기' 버튼");
        if (text.length > 200) text = text.slice(0, 197) + "…";
        K.Share.sendDefault({ objectType: "text", text: text, link: { mobileWebUrl: mapUrl, webUrl: mapUrl },
          buttonTitle: pos ? "📍 위치 보기" : "상황판 열기" });
      }).catch(fallbackShare);
    });
    $("#sosCopy").addEventListener("click", () => {
      const done = () => { $("#sosCopy").textContent = "✅ 복사됨 — 원하는 곳에 붙여 넣으세요"; setTimeout(() => { $("#sosCopy").textContent = "📋 내용 복사"; }, 2500); };
      if (navigator.clipboard) navigator.clipboard.writeText(msg.value).then(done, () => { msg.select(); document.execCommand("copy"); done(); });
      else { msg.select(); document.execCommand("copy"); done(); }
    });
  })();

  // 처음: 지난번 보던 탭 (없으면 홈)
  const first = ls.get("mTab");
  loaded.home = true; loadHome();
  if (first && first !== "home" && LOAD[first]) go(first);
})();
