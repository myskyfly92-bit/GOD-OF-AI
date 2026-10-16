/* 🧘 2분 스트레칭 — 사무직 근골격계 질환 예방
   · ⚙ 설정 메뉴에서 언제든 열 수 있고,
   · 화면을 켜 둔 지 50분이 지나면 왼쪽 아래에 작은 알림이 뜬다 (07~20시, 끌 수 있음).
   · 동작은 SVG 사람 그림을 CSS 애니메이션으로 움직여 보여준다. */
(function stretchBreak() {
  "use strict";
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const EVERY_MIN = 50, SNOOZE_MIN = 30, SEC_PER = 20;

  const EX = [
    { id: 1, t: "목 옆 늘리기", part: "목 · 승모근", rep: "좌우 각 10초 · 2회",
      d: "허리를 펴고 앉아 귀를 어깨 쪽으로 천천히 기울입니다. 반대쪽 어깨는 아래로 지그시 내리세요.",
      hot: [[86, 86, 8], [114, 86, 8]] },
    { id: 2, t: "뒷목 늘리기", part: "뒷목 · 등 윗부분", rep: "10초 · 2회",
      d: "양손 깍지를 뒤통수에 대고 턱을 가슴 쪽으로 천천히 당깁니다. 손으로 누르지 말고 팔 무게만 실으세요.",
      hot: [[100, 89, 10]] },
    { id: 3, t: "어깨 으쓱 → 툭", part: "어깨 · 승모근", rep: "5회",
      d: "숨을 들이마시며 어깨를 귀까지 끌어올려 3초 버티고, 내쉬면서 힘을 빼고 툭 떨어뜨립니다.",
      hot: [[80, 94, 11], [120, 94, 11]] },
    { id: 4, t: "가슴 펴기 (W 자세)", part: "가슴 · 날개뼈", rep: "10초 · 3회",
      d: "팔을 W 모양으로 들고 팔꿈치를 뒤·아래로 당겨 날개뼈를 모읍니다. 굽은 어깨와 거북목에 좋아요.",
      hot: [[100, 116, 16]] },
    { id: 5, t: "옆구리 기지개", part: "옆구리 · 허리", rep: "좌우 각 10초",
      d: "깍지를 끼고 팔을 머리 위로 쭉 뻗은 뒤, 몸을 좌우로 천천히 기울입니다. 엉덩이는 의자에 붙이세요.",
      hot: [[74, 134, 12], [126, 134, 12]] },
    { id: 6, t: "손목 젖히기", part: "손목 · 아래팔", rep: "위·아래 각 10초",
      d: "팔을 쭉 뻗어 손끝을 위로, 다음엔 아래로 젖혀 버팁니다. 마우스·키보드를 오래 쓰면 꼭 해 주세요.",
      hot: [[160, 97, 12]] },
  ];

  /* 사람 그림 — 팔은 어깨에서 회전하는 그룹(위팔) 안에 팔꿈치에서 회전하는 그룹(아래팔)이 들어 있다 */
  const SKIN = "#f2c39b", SHIRT = "#2f8f83", SHIRT_D = "#24736a", HAIR = "#3b2a20";
  function arm(side) {
    const x = side === "l" ? 74 : 126;
    return `<g transform="translate(${x} 96)"><g class="st-ua st-ua-${side}">
      <line x1="0" y1="0" x2="0" y2="34" stroke="${SHIRT}" stroke-width="12" stroke-linecap="round"/>
      <g transform="translate(0 34)"><g class="st-fa st-fa-${side}">
        <line x1="0" y1="0" x2="0" y2="28" stroke="${SKIN}" stroke-width="9" stroke-linecap="round"/>
        <g transform="translate(0 29)"><g class="st-hand st-hand-${side}">
          <rect x="-5.5" y="-2" width="11" height="13" rx="5" fill="${SKIN}" stroke="#d9a47c" stroke-width="1"/>
        </g></g>
      </g></g>
    </g></g>`;
  }
  function figure(ex, mini) {
    const hot = mini ? "" : ex.hot.map(([x, y, r]) => `<circle class="st-hot" cx="${x}" cy="${y}" r="${r}"/>`).join("");
    return `<svg class="st-fig st-ex${ex.id}" viewBox="0 0 200 200" aria-hidden="true">
      <g transform="translate(100 172)"><g class="st-up"><g transform="translate(-100 -172)">
        <path d="M68 104 Q68 92 82 90 L118 90 Q132 92 132 104 L134 176 L66 176 Z" fill="${SHIRT}"/>
        <g class="st-sh">${arm("l")}${arm("r")}</g>
        <g transform="translate(100 94)"><g class="st-head"><g transform="translate(-100 -94)">
          <rect x="94" y="72" width="12" height="22" rx="4" fill="${SKIN}"/>
          <circle cx="100" cy="58" r="18" fill="${SKIN}"/>
          <path d="M82 56 Q82 38 100 38 Q119 38 118 56 Q112 46 100 47 Q88 47 82 56 Z" fill="${HAIR}"/>
          <g class="st-face">
            <circle cx="93.5" cy="60" r="1.9" fill="#3a2a22"/><circle cx="106.5" cy="60" r="1.9" fill="#3a2a22"/>
            <path d="M95 67 Q100 70.5 105 67" fill="none" stroke="#a5583f" stroke-width="1.6" stroke-linecap="round"/>
            <circle cx="89.5" cy="65" r="2.4" fill="#f19a8b" opacity=".45"/><circle cx="110.5" cy="65" r="2.4" fill="#f19a8b" opacity=".45"/>
          </g>
        </g></g></g>
        <g class="st-sh"><path d="M66 106 Q66 90 84 88 L116 88 Q134 90 134 106 Q120 98 100 98 Q80 98 66 106 Z" fill="${SHIRT_D}"/></g>
        ${hot}
      </g></g></g>
      <rect x="0" y="168" width="200" height="32" rx="3" fill="#8a6a4c"/>
      <rect x="0" y="168" width="200" height="5" fill="#a3825f"/>
      <rect x="128" y="156" width="40" height="13" rx="2" fill="#cfd6dd"/><rect x="132" y="159" width="32" height="7" rx="1" fill="#9aa5b1"/>
    </svg>`;
  }

  /* ---------- 큰 팝업 ---------- */
  let bg = null, idx = 0, left = SEC_PER, paused = false, timer = null;
  const today = () => new Date().toISOString().slice(0, 10);
  function doneCount() { const v = (LS.get("stretchDone") || "").split("|"); return v[0] === today() ? +v[1] || 0 : 0; }

  function build() {
    bg = document.createElement("div");
    bg.className = "st-bg";
    bg.innerHTML = `<div class="st-box" role="dialog" aria-modal="true" aria-labelledby="stTitle">
      <button type="button" class="st-x" aria-label="닫기">✕</button>
      <div class="st-head-row">
        <div class="st-kicker">🧘 2분 스트레칭</div>
        <div class="st-sub">사무직 근골격계 질환 예방 · 50분 일하면 잠깐 풀어 주세요</div>
      </div>
      <div class="st-main">
        <div class="st-stage"></div>
        <div class="st-info">
          <div class="st-step"></div>
          <h3 id="stTitle" class="st-title"></h3>
          <div class="st-part"></div>
          <p class="st-desc"></p>
          <div class="st-rep"></div>
          <div class="st-ctrl">
            <div class="st-ring"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" class="st-ring-bg"/><circle cx="22" cy="22" r="19" class="st-ring-fg"/></svg><b class="st-sec"></b></div>
            <button type="button" class="st-btn st-prev" aria-label="이전 동작">◀</button>
            <button type="button" class="st-btn st-pause" aria-label="일시정지">⏸</button>
            <button type="button" class="st-btn st-next" aria-label="다음 동작">▶</button>
          </div>
        </div>
      </div>
      <div class="st-dots"></div>
      <div class="st-foot">
        <span>⚠️ 반동 없이 천천히 · 숨 참지 않기 · 통증이 느껴지면 바로 멈추세요</span>
        <label class="st-auto"><input type="checkbox"> 50분마다 알림</label>
      </div>
    </div>`;
    document.body.appendChild(bg);
    const $ = (s) => bg.querySelector(s);
    $(".st-x").onclick = close;
    bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
    $(".st-prev").onclick = () => go(idx - 1);
    $(".st-next").onclick = () => go(idx + 1);
    $(".st-pause").onclick = () => { paused = !paused; paint(); };
    $(".st-dots").innerHTML = EX.map((x, i) => `<button type="button" aria-label="${i + 1}. ${x.t}" data-i="${i}"></button>`).join("");
    $(".st-dots").onclick = (e) => { const b = e.target.closest("[data-i]"); if (b) go(+b.dataset.i); };
    const cb = $(".st-auto input");
    cb.checked = LS.get("stretchOff") !== "1";
    cb.onchange = () => LS.set("stretchOff", cb.checked ? "0" : "1");
  }
  function paint() {
    const ex = EX[idx], $ = (s) => bg.querySelector(s);
    if (!bg.dataset.shown || +bg.dataset.shown !== idx) { $(".st-stage").innerHTML = figure(ex); bg.dataset.shown = idx; }
    $(".st-step").textContent = `${idx + 1} / ${EX.length}`;
    $(".st-title").textContent = ex.t;
    $(".st-part").textContent = "🎯 " + ex.part;
    $(".st-desc").textContent = ex.d;
    $(".st-rep").textContent = "⏱ " + ex.rep;
    $(".st-sec").textContent = left;
    $(".st-ring-fg").style.strokeDashoffset = String(119.4 * (1 - left / SEC_PER));
    $(".st-pause").textContent = paused ? "▶︎ 계속" : "⏸";
    $(".st-pause").classList.toggle("wide", paused);
    bg.querySelector(".st-fig").classList.toggle("paused", paused);
    bg.querySelectorAll(".st-dots button").forEach((b, i) => { b.className = i === idx ? "on" : i < idx ? "done" : ""; });
  }
  function go(i) {
    if (i >= EX.length) return finish();
    idx = Math.max(0, i); left = SEC_PER; paused = false;
    bg.classList.remove("fin"); paint();
  }
  function finish() {
    clearInterval(timer); timer = null;
    const n = doneCount() + 1;
    LS.set("stretchDone", today() + "|" + n);
    LS.set("stretchLast", String(Date.now()));
    bg.classList.add("fin");
    bg.querySelector(".st-stage").innerHTML = `<div class="st-fin">👏</div>`;
    bg.querySelector(".st-step").textContent = "완료";
    bg.querySelector(".st-title").textContent = "수고하셨어요!";
    bg.querySelector(".st-part").textContent = `오늘 ${n}번째 스트레칭`;
    bg.querySelector(".st-desc").textContent = "물 한 잔 마시고, 20초 동안 먼 곳을 바라보며 눈도 쉬어 주세요. 다음 알림은 50분 뒤에 드릴게요.";
    bg.querySelector(".st-rep").innerHTML = `<button type="button" class="st-again">↻ 한 번 더</button>`;
    bg.querySelector(".st-again").onclick = () => { go(0); tick(); };
    bg.querySelectorAll(".st-dots button").forEach((b) => (b.className = "done"));
  }
  function tick() {
    clearInterval(timer);
    timer = setInterval(() => {
      if (!bg || paused || document.hidden) return;
      left -= 1;
      if (left <= 0) go(idx + 1); else paint();
    }, 1000);
  }
  function onKey(e) {
    if (!bg) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") go(idx + 1);
    else if (e.key === "ArrowLeft") go(idx - 1);
  }
  function open() {
    hideToast();
    if (bg) return;
    build(); idx = 0; left = SEC_PER; paused = false; paint(); tick();
    document.addEventListener("keydown", onKey);
    LS.set("stretchLast", String(Date.now()));
  }
  function close() {
    clearInterval(timer); timer = null;
    document.removeEventListener("keydown", onKey);
    if (bg) { bg.remove(); bg = null; }
  }

  /* ---------- 50분 알림 (왼쪽 아래 작은 카드) ---------- */
  let toast = null;
  function hideToast() { if (toast) { toast.remove(); toast = null; } }
  function showToast() {
    if (toast || bg) return;
    toast = document.createElement("div");
    toast.className = "st-toast";
    toast.setAttribute("role", "status");
    toast.innerHTML = `<div class="st-toast-fig">${figure(EX[2], true)}</div>
      <div class="st-toast-txt"><b>50분 지났어요 🙆</b><span>목·어깨가 굳기 전에 2분만 풀어 볼까요?</span>
        <div class="st-toast-btns"><button type="button" class="go">스트레칭 시작</button><button type="button" class="later">30분 뒤에</button><button type="button" class="off">오늘은 그만</button></div>
      </div>`;
    document.body.appendChild(toast);
    toast.querySelector(".go").onclick = open;
    toast.querySelector(".later").onclick = () => { LS.set("stretchLast", String(Date.now() - (EVERY_MIN - SNOOZE_MIN) * 60000)); hideToast(); };
    toast.querySelector(".off").onclick = () => { LS.set("stretchSkip", today()); hideToast(); };
  }
  function busy() {
    const b = document.body;
    return document.hidden || b.classList.contains("kiosk-on") || b.classList.contains("bg-reveal") ||
      document.querySelector(".ntc-pop-bg, .vc-win-bg, .desk-bg, .hse-guide, .hse-intro") ||
      window.innerWidth <= 768;
  }
  function check() {
    if (LS.get("stretchOff") === "1" || LS.get("stretchSkip") === today()) return;
    const h = new Date().getHours();
    if (h < 7 || h >= 20) return;
    let last = +LS.get("stretchLast") || 0;
    if (!last) { LS.set("stretchLast", String(Date.now())); return; }   // 첫 방문: 지금부터 50분
    if (Date.now() - last >= EVERY_MIN * 60000 && !busy()) showToast();
  }
  // 오래(3시간 넘게) 닫혀 있다가 다시 열면, 연 시점부터 50분을 센다
  if (Date.now() - (+LS.get("stretchLast") || 0) > 3 * 3600000) LS.set("stretchLast", String(Date.now()));
  setInterval(check, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(check, 1500); });

  /* ⚙ 설정 메뉴에 항목 추가 */
  function addMenuItem() {
    const slot = document.getElementById("setStretchSlot");
    if (!slot || slot.firstChild) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "set-item st-menu-btn"; b.id = "stretchOpen";
    b.innerHTML = "🧘 2분 스트레칭<small>목·어깨·허리·손목 풀기 (움직이는 그림)</small>";
    b.onclick = open;
    slot.appendChild(b);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addMenuItem); else addMenuItem();

  window.hseStretch = { open, close, check, showToast };
})();
