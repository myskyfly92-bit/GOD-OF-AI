// 이라크 주요 이슈 → '비스마야 현장에 무슨 의미인지' 판단 (규칙 기반 · 외부 AI 없음)
//   impact = { lv: 'r'(즉시 주의) | 'y'(지켜볼 것) | 'g'(참고), line: 현장 영향 한 줄, act: 권장 행동, place, km }
//   brief  = 최근 24시간 중 현장 관련(r·y) 상위 3건 → 화면 맨 위 '오늘의 현장 브리핑'
const SITE = [33.193, 44.618]; // 비스마야 신도시

// 장소 사전: 구체적인 곳을 먼저 (먼저 맞는 곳을 쓴다)
const PLACES = [
  ["비스마야", 33.193, 44.618, /비스마야|bismay|basmaya|بسماي/i],
  ["나흐라완", 33.32, 44.71, /나흐라완|nahrawan|النهروان/i],
  ["지스르 디얄라", 33.235, 44.505, /디얄라\s?다리|jisr diyala|diyala bridge|جسر ديالى/i],
  ["살만팍(마다인)", 33.1, 44.58, /살만\s?팍|마다인|salman pak|mada'?in|سلمان باك|المدائن/i],
  ["자파라니야", 33.26, 44.49, /자파라니|zafaraniy|الزعفرانية/i],
  ["바그다드 알자디다", 33.31, 44.48, /바그다드\s?(알)?자디다|new baghdad|baghdad al-?jadida|بغداد الجديدة/i],
  ["사드르시티", 33.39, 44.46, /사드르\s?시티|sadr city|مدينة الصدر/i],
  ["카라다", 33.3, 44.43, /카라다|karrada|الكرادة/i],
  ["도라", 33.25, 44.39, /도라\b|\bdora\b|الدورة/i],
  ["타흐리르 광장", 33.33, 44.4, /타흐리르|tahrir|التحرير/i],
  ["그린존", 33.3, 44.38, /그린\s?존|green zone|المنطقة الخضراء/i],
  ["카디미야", 33.38, 44.34, /카디미야|kadhimiya|kadhmiya|الكاظمية/i],
  ["아다미야", 33.37, 44.37, /아다미야|adhamiya|الأعظمية/i],
  ["만수르", 33.32, 44.33, /만수르|mansour|المنصور/i],
  ["바그다드 공항", 33.262, 44.234, /바그다드\s?(국제)?공항|baghdad (international )?airport|مطار بغداد/i],
  ["아부그라이브", 33.29, 44.06, /아부\s?그라이브|abu ghraib|أبو غريب/i],
  ["타지", 33.53, 44.25, /타지\b|\btaji\b|التاجي/i],
  ["타르미야", 33.67, 44.4, /타르미야|tarmiyah|الطارمية/i],
  ["바그다드", 33.315, 44.366, /바그다드|baghdad|بغداد/i],
  ["바쿠바(디얄라)", 33.75, 44.64, /바쿠바|baqubah|baquba|بعقوبة/i],
  ["디얄라주", 33.95, 45.0, /디얄라|diyala|ديالى/i],
  ["쿠트(와싯)", 32.51, 45.82, /쿠트\b|\bkut\b|와싯|wasit|الكوت|واسط/i],
  ["힐라(바빌)", 32.48, 44.43, /힐라|hilla|바빌|babil|babylon|الحلة|بابل/i],
  ["카르발라", 32.61, 44.02, /카르발라|karbala|كربلاء/i],
  ["나자프", 32.0, 44.33, /나자프|najaf|النجف/i],
  ["디와니야", 31.99, 44.92, /디와니야|diwaniy|الديوانية/i],
  ["팔루자", 33.35, 43.78, /팔루자|fallujah|الفلوجة/i],
  ["라마디", 33.42, 43.3, /라마디|ramadi|الرمادي/i],
  ["안바르", 33.4, 42.5, /안바르|anbar|الأنبار/i],
  ["사마라", 34.2, 43.87, /사마라|samarra|سامراء/i],
  ["티크리트(살라딘)", 34.6, 43.68, /티크리트|tikrit|살라(흐)?\s?앗?딘|salah al-?din|تكريت|صلاح الدين/i],
  ["키르쿠크", 35.47, 44.39, /키르쿠크|kirkuk|كركوك/i],
  ["신자르", 36.32, 41.87, /신자르|sinjar|سنجار/i],
  ["모술", 36.34, 43.13, /모술|mosul|니나와|nineveh|ninawa|الموصل|نينوى/i],
  ["에르빌", 36.19, 44.01, /에르빌|아르빌|erbil|arbil|أربيل/i],
  ["술라이마니야", 35.56, 45.43, /술라이마니|sulaymaniy|sulaimani|السليمانية/i],
  ["두호크", 36.87, 42.99, /두호크|duhok|dohuk|دهوك/i],
  ["아마라(마이산)", 31.84, 47.14, /아마라|amarah|마이산|maysan|العمارة|ميسان/i],
  ["나시리야(디카르)", 31.05, 46.26, /나시리야|nasiriy|디\s?카르|dhi qar|الناصرية|ذي قار/i],
  ["사마와(무산나)", 31.31, 45.28, /사마와|samawah|무산나|muthanna|السماوة|المثنى/i],
  ["바스라", 30.51, 47.78, /바스라|basra|البصرة/i],
];
const NATION = /전국|이라크 전역|모든 주|nationwide|all (iraqi )?provinces|across iraq|جميع المحافظات|عموم العراق|كافة المحافظات/i;

const R = {
  sec: /테러|폭발|폭탄|공격|드론|로켓|박격포|총격|교전|무장|납치|암살|공습|IED|attack|explosion|blast|bomb|rocket|mortar|drone strike|airstrike|gunfire|gunmen|clash|kidnap|assassinat|انفجار|تفجير|عبوة|هجوم|صاروخ|قصف|مسيرة|اشتباك|مسلحين|خطف|اغتيال/i,
  control: /통행금지|통금|도로\s?(봉쇄|통제|차단|폐쇄)|교량\s?(폐쇄|통제)|검문 강화|curfew|roads? (closed|closure|blocked)|bridge closed|حظر (ال)?تجوال|قطع (ال)?طر(ق|يق)|غلق (ال)?طر(ق|يق)|إغلاق (ال)?(طرق|جسر|شوارع)/i,
  protest: /시위|집회|농성|protest|demonstrat|sit-in|rally|تظاهر|احتجاج|اعتصام/i,
  holiday: /공휴일|휴무|관공서.{0,6}쉰|public holiday|official holiday|day off|suspend(s|ed)? (official )?work|عطلة رسمية|تعطيل الدوام|تعطل الدوام|عطلة الدوام/i,
  // 실제 공급 중단만 (전력 정책·발전소 계약 기사는 빼려고 '정전·단전·끊김' 같은 말이 있어야 함)
  power: /정전|단전|전력\s?(부족|공급\s?(중단|차질))|전기\s?(끊|공급 중단)|단수|급수\s?중단|연료\s?(부족|대란)|blackout|power (cut|outage|shortage)|outages?\b|load[- ]shedding|water (cut|shortage)|fuel (shortage|crisis)|انقطاع (التيار|الكهرباء|الماء|المياه)|قطع (الكهرباء|الماء)|شح (المياه|الوقود)|أزمة (الوقود|الكهرباء)/i,
  wx: /모래\s?폭풍|먼지\s?폭풍|황사|폭염|폭우|홍수|dust ?storm|sandstorm|heat ?wave|flood|heavy rain|عاصفة ترابية|غبار|موجة حر|فيضان|أمطار غزيرة/i,
  elect: /선거일|투표일|투표소|election day|polling|voting day|يوم الاقتراع|مراكز الاقتراع/i,
  econ: /디나르|환율|달러|유가|원유|휘발유값|dinar|exchange rate|dollar|oil price|crude|fuel price|الدينار|سعر الدولار|النفط|أسعار الوقود/i,
  korea: /한국|한화|대한민국|korea|hanwha|كوريا|هانوا/i,
  deval: /평가\s?절하|환율\s?(인상|인하|조정|변경)|공식\s?환율|devalu|official exchange rate|exchange rate (change|hike|cut|adjust)|تخفيض (قيمة )?الدينار|سعر الصرف الرسمي/i,
  past: /년 전|주년|기념|anniversary|years ago|ذكرى/i,
  // 실제 피해·사건을 뜻하는 말 (발언·정책 기사와 구분)
  evt: /사망|숨져|숨진|부상|다쳐|폭발(해|했|하여|로)|피격|공격(을)?\s?받|피습|납치(돼|된|됐)|killed|kills|dead|death toll|wounded|injur|exploded|explosion (in|at|near)|targeted|was attacked|were attacked|struck|hit by|abducted|قتل|مقتل|قتلى|إصابة|جرح|جرحى|استهدف|انفجرت|انفجار في|اختطاف/i,
  // 정책·회의·협력 기사 (사건이 아님)
  policy: /프로젝트|협력|계획|전략|회의|협약|논의|발표할|양해각서|project|cooperat|plan(s|ned)?\b|strategy|conference|agreement|talks|memorandum|vows?|pledge|مشروع|تعاون|خطة|اتفاق|مؤتمر|مذكرة تفاهم/i,
};

function km(a, b) {
  const t = Math.PI / 180, dLat = (b[0] - a[0]) * t, dLon = (b[1] - a[1]) * t;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)));
}
function findPlace(text) {
  for (const [name, lat, lon, re] of PLACES) if (re.test(text)) return { place: name, km: km(SITE, [lat, lon]) };
  return null;
}

function assess(n) {
  const t = [n.title, n.titleKo, n.body ? String(n.body).slice(0, 600) : "", n.bodyKo ? String(n.bodyKo).slice(0, 600) : ""].concat((n.related || []).map((r) => r.titleKo || "")).join(" ");
  const head = [n.title, n.titleKo].join(" ");
  // 장소는 제목에서 먼저 찾고, 없을 때만 본문에서 '구체적인 곳'만 (본문 첫머리 'BAGHDAD (통신사)' 같은 날짜줄은 무시)
  let p = findPlace(head);
  if (!p) { const b = findPlace(t); if (b && b.place !== "바그다드") p = b; }
  const nation = NATION.test(t);
  const near = (d) => p && p.km <= d;
  const at = p ? p.place : "";   // 거리는 화면에서 📍 표시로 따로 보여 준다
  const out = (lv, line, act) => ({ lv, line, act: act || "", place: p ? p.place : "", km: p ? p.km : null });
  if (R.past.test(head) && !R.control.test(head)) return out("g", "지난 사건 관련 보도 — 현장 직접 영향 없음");

  if (R.sec.test(head) && !R.evt.test(head)) return out("g", "치안 관련 발언·정책 — 현장 직접 영향 낮음");
  if (R.sec.test(head)) {
    if (near(40)) return out("r", `현장 가까운 치안 사건 (${at})`, "현장 밖 이동 자제 · 보안팀 공지와 출퇴근 경로 확인");
    if (near(120)) return out("y", `현장 주변 지역 치안 사건 (${at})`, "해당 지역 방문·경유 일정이 있으면 재검토");
    return out("g", p ? `먼 지역 치안 사건 (${at}) — 현장 직접 영향 낮음` : "치안 사건 — 발생 지역 확인 필요", p ? "" : "바그다드 인근이면 보안팀 확인");
  }
  if (R.control.test(head)) {
    if (nation || near(60) || !p) return out("r", `통행금지·도로 통제${at ? ` (${at})` : ""} — 출퇴근·공항 이동 지연 가능`, "외부 이동 일정 조정 · 현지 인력 출근 경로 확인");
    return out("g", `다른 지역 도로 통제 (${at}) — 현장 직접 영향 낮음`);
  }
  if (R.protest.test(head)) {
    if (near(60)) return out("y", `바그다드권 시위·집회 (${at}) — 시내·공항 이동 지연 가능`, "시위 시간대 시내 이동 피하기");
    return out("g", p ? `다른 지역 시위 (${at}) — 현장 직접 영향 낮음` : "시위 소식 — 장소 확인 필요");
  }
  if (R.holiday.test(head)) {
    if (!p || nation || near(60)) return out("y", "공휴일·관공서 휴무 — 현지 인력 출근·관공서 업무(통관·인허가) 차질 가능", "현지 인력 출근 여부와 통관·인허가 일정 확인");
    return out("g", `${p.place} 지역 휴무 — 현장 직접 영향 낮음`);
  }
  if (R.elect.test(head)) return out("y", "선거 관련 일정 — 투표일 전후 통행 제한·검문 강화 가능", "투표일 전후 외부 이동 최소화");
  if (R.power.test(head) && !R.policy.test(head)) {
    if (!p || nation || near(60)) return out("y", "전력·물·연료 공급 차질 — 숙소·현장 발전기와 비상 급수 영향 가능", "발전기 연료·비상 급수 재고 점검");
    return out("g", `다른 지역 공급 차질 (${at}) — 현장 직접 영향 낮음`);
  }
  if (R.wx.test(head) && !R.policy.test(head)) return out("y", "기상 악화 소식 — 옥외·고소·양중 작업 영향 가능", "상황실 날씨·모래폭풍 예보 확인 후 작업 조정");
  if (R.korea.test(head)) return out("y", "한국·한국 기업 관련 소식 — 한국인 직원 참고");
  if (R.deval.test(head)) return out("y", "디나르 환율 조정 — 현지 인력 급여 환산·현지 구매 단가 영향 가능", "현지 구매·용역 단가와 급여 환전 기준 확인");
  if (R.econ.test(head)) return out("g", "환율·유가 변동 — 현지 구매·환전 참고");
  return out("g", "현장 직접 영향 낮음");
}

// 오늘의 현장 브리핑: 최근 24시간(없으면 36시간) 중 r·y 상위 3건
function brief(list) {
  const rank = { r: 0, y: 1, g: 2 };
  for (const H of [24, 36]) {
    const lim = Date.now() - H * 3600000;
    const L = list.filter((n) => n.impact && n.impact.lv !== "g" && Date.parse(n.date) >= lim)
      .sort((a, b) => rank[a.impact.lv] - rank[b.impact.lv] || (b.count || 1) - (a.count || 1) || String(b.date).localeCompare(String(a.date)));
    if (!L.length && H < 36) continue;
    // 같은 영향(예: 디나르 평가절하 기사 여러 건)은 한 줄로 묶고 '관련 n건'으로
    const seen = {}, out = [];
    for (const n of L) {
      const k = n.impact.line;
      if (seen[k]) { seen[k].more++; continue; }
      seen[k] = { lv: n.impact.lv, titleKo: n.titleKo || n.title, line: n.impact.line, act: n.impact.act, km: n.impact.km, link: n.link, date: n.date, more: 0 };
      out.push(seen[k]);
    }
    return out.slice(0, 3);
  }
  return [];
}

module.exports = { assess, brief };
