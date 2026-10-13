// 비스마야 관련 유튜브 영상을 유튜브 검색 결과(최신순)에서 모아 bismayah-videos.json 으로 저장한다.
// GitHub Actions에서 6시간마다 실행. API 키 없이 공개 검색 화면만 읽는다.
//
// - 검색어: 비스마야 / Bismayah·Bismaya / بسماية
// - 제목이나 설명에 비스마야가 실제로 들어간 영상만 남긴다 (검색이 엉뚱한 영상을 섞어 주기 때문)
// - 아랍어·영어 제목은 한국어로 번역해 붙인다
// - 이전 파일에 있던 영상은 남기고(검색에 잠깐 안 잡혀도 목록이 비지 않게), 2년 지난 것은 뺀다
// - 화면에는 썸네일(유튜브 공식 썸네일 주소)과 링크만 쓴다. 영상은 유튜브에서 열린다.

const fs = require("fs");
const OUT = "bismayah-videos.json";
const MAX_ITEMS = 48;
const KEEP_DAYS = 730;
const QUERIES = [
  { q: "비스마야", hl: "ko", gl: "KR" },
  { q: "비스마야 신도시", hl: "ko", gl: "KR" },
  { q: "Bismayah", hl: "en", gl: "US" },
  { q: "Bismaya Iraq", hl: "en", gl: "US" },
  { q: "بسماية", hl: "ar", gl: "IQ" },
  { q: "مدينة بسماية", hl: "ar", gl: "IQ" },
];
// 'Besmaya'는 스페인 가수 이름이라 단독으로는 인정하지 않는다
const REL = /비스마야|비스야마|비스마이야|bismay|basmaya|بسماي|بسمايه/i;
const BESMAYA = /besmaya/i, IRAQ = /iraq|baghdad|العراق|بغداد|이라크/i;
const UA = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8,ar;q=0.7",
  Cookie: "CONSENT=YES+1; SOCS=CAI",
};

const txt = (o) => !o ? "" : o.simpleText != null ? String(o.simpleText) : (o.runs || []).map((r) => r.text).join("");

// '3일 전' · '2 weeks ago' · 'منذ 3 أيام' → 대략의 날짜
function relDate(s, now) {
  s = String(s || "");
  const n = Number((s.match(/\d+/) || [1])[0]);
  const U = [
    [/초|second|ثاني/i, 1e3], [/분|minute|دقيق/i, 6e4], [/시간|hour|ساع/i, 36e5],
    [/주|week|أسبوع|أسابيع/i, 7 * 864e5], [/개월|달|month|شهر|أشهر/i, 30 * 864e5],
    [/년|year|سنة|سنوات|عام/i, 365 * 864e5], [/일|day|يوم|أيام/i, 864e5],
  ];
  for (const [re, ms] of U) if (re.test(s)) return new Date(now - n * ms).toISOString();
  return "";
}

function walk(o, out) {
  if (!o || typeof o !== "object") return;
  if (Array.isArray(o)) { o.forEach((x) => walk(x, out)); return; }
  if (o.videoRenderer && o.videoRenderer.videoId) out.push(o.videoRenderer);
  for (const k in o) if (k !== "videoRenderer") walk(o[k], out);
}

function parseSearch(html, now) {
  const m = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s) || html.match(/ytInitialData"\]\s*=\s*(\{.+?\});/s);
  if (!m) return [];
  let data; try { data = JSON.parse(m[1]); } catch (e) { return []; }
  const vr = []; walk(data, vr);
  return vr.map((v) => {
    const snippet = (v.detailedMetadataSnippets || []).map((d) => txt(d.snippetText)).join(" ") || txt(v.descriptionSnippet);
    return {
      id: v.videoId,
      title: txt(v.title).trim(),
      channel: txt(v.ownerText || v.longBylineText).trim(),
      published: txt(v.publishedTimeText),
      date: relDate(txt(v.publishedTimeText), now),
      length: txt(v.lengthText),
      views: txt(v.viewCountText || v.shortViewCountText),
      _snip: snippet,
    };
  }).filter((v) => v.id && v.title && !/LIVE|실시간/.test(v.length) && v.published);   // 생방송 중·예정 영상은 뺀다
}

const relevant = (v) => {
  const t = v.title + " " + v._snip + " " + v.channel;
  return REL.test(t) || (BESMAYA.test(t) && IRAQ.test(t));
};
const langOf = (s) => /[؀-ۿ]/.test(s) ? "ar" : /[가-힣]/.test(s) ? "ko" : "en";

async function translate(text, from) {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=ko&dt=t&q=${encodeURIComponent(text.slice(0, 500))}`;
    const res = await fetch(url, { headers: { "User-Agent": UA["User-Agent"] } });
    if (!res.ok) return "";
    const j = await res.json();
    return (j[0] || []).map((x) => x[0]).join("").trim();
  } catch (e) { return ""; }
}

function loadPrev() {
  try { return JSON.parse(fs.readFileSync(OUT, "utf8")).items || []; } catch (e) { return []; }
}

// 시험용: node fetch-bismayah-videos.js --parse 파일.html → 뽑힌 영상만 출력
if (process.argv[2] === "--parse") {
  const r = parseSearch(fs.readFileSync(process.argv[3], "utf8"), Date.now());
  console.log(JSON.stringify(r.map((v) => ({ ...v, rel: relevant(v) })), null, 1));
  process.exit(0);
}

async function main() {
  const now = Date.now();
  const prev = loadPrev();
  const byId = new Map(prev.map((v) => [v.id, v]));
  let got = 0, ok = 0;
  for (const s of QUERIES) {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(s.q)}&sp=CAI%253D&hl=${s.hl}&gl=${s.gl}`;
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) { console.warn("검색 실패", s.q, res.status); continue; }
      const list = parseSearch(await res.text(), now);
      ok++;
      const rel = list.filter(relevant);
      console.log(`[${s.q}] 결과 ${list.length}개 · 비스마야 관련 ${rel.length}개`);
      for (const v of rel) {
        got++;
        const old = byId.get(v.id);
        const { _snip, ...keep } = v;
        // 날짜는 처음 본 때 계산한 값을 유지 ('1년 전'처럼 뭉뚱그려진 값이 매번 흔들리지 않게)
        byId.set(v.id, { ...(old || {}), ...keep, date: (old && old.date) || v.date, titleKo: old && old.title === v.title ? old.titleKo : undefined });
      }
    } catch (e) { console.warn("검색 오류", s.q, e.message); }
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!ok) { console.error("유튜브 검색을 하나도 못 읽었습니다. 이전 파일 그대로 둡니다."); process.exit(0); }

  const cut = now - KEEP_DAYS * 864e5;
  const items = [...byId.values()]
    .filter((v) => !v.date || new Date(v.date).getTime() >= cut)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, MAX_ITEMS);
  let tr = 0;
  for (const v of items) {
    v.lang = langOf(v.title);
    if (v.lang !== "ko" && !v.titleKo) { v.titleKo = await translate(v.title, v.lang); if (v.titleKo) tr++; await new Promise((r) => setTimeout(r, 300)); }
    if (v.lang === "ko") delete v.titleKo;
  }
  fs.writeFileSync(OUT, JSON.stringify({ updated: new Date(now).toISOString(), count: items.length, items }, null, 1));
  console.log(`저장 완료: ${items.length}개 (이번 검색에서 ${got}개 확인 · 새로 번역 ${tr}개)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
