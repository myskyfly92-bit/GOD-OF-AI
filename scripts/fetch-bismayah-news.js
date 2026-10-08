// 비스마야 신도시 관련 뉴스를 구글 뉴스 검색(한국어·아랍어·영어)으로 모아
// bismayah-news.json 으로 저장한다. GitHub Actions에서 6시간마다 실행.
//
// - 검색어: 비스마야 / بسماية / Bismayah·Bismaya
// - 아랍어·영어 제목은 한국어로 번역해 붙인다 (구글 번역 무료 주소 → 안 되면 MyMemory)
// - 이전 파일에 있던 기사도 기간 안이면 남겨서, 검색에 잠깐 안 잡혀도 목록이 비지 않게 한다

const fs = require("fs");
const OUT = "bismayah-news.json";
const KEEP_DAYS = 60;   // 이 기간 안의 기사만 남긴다
const MAX_ITEMS = 60;   // 최대 몇 건까지 보여 줄지

const SEARCHES = [
  { lang: "ko", q: "비스마야 when:30d", hl: "ko", gl: "KR", ceid: "KR:ko" },
  { lang: "ko", q: "비스마야 신도시 한화 when:60d", hl: "ko", gl: "KR", ceid: "KR:ko" },
  { lang: "ar", q: "بسماية when:30d", hl: "ar", gl: "IQ", ceid: "IQ:ar" },
  { lang: "ar", q: '"مدينة بسماية" OR "مجمع بسماية" when:60d', hl: "ar", gl: "IQ", ceid: "IQ:ar" },
  { lang: "en", q: "(Bismayah OR Bismaya) Iraq when:60d", hl: "en-US", gl: "US", ceid: "US:en" },
];
// 제목이나 요약에 비스마야가 실제로 나와야 한다 (검색 엔진이 엉뚱한 기사를 섞는 것 거르기)
const MUST = /비스마야|بسماية|بسمايه|bismay/i;

const UA = { "User-Agent": "Mozilla/5.0 (compatible; BismayahHSEBot/1.0)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return String(s || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
function stripTags(html) { return decodeEntities(String(html || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(); }
function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  const v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1] : v;
}

async function searchNews({ lang, q, hl, gl, ceid }) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`구글 뉴스 응답 ${res.status}`);
  const xml = await res.text();
  return (xml.match(/<item>[\s\S]*?<\/item>/g) || []).map((block) => {
    const raw = stripTags(extractTag(block, "title"));
    const m = raw.match(/^(.*)\s-\s([^-]+)$/);
    const d = new Date(stripTags(extractTag(block, "pubDate")));
    return {
      title: m ? m[1].trim() : raw,
      source: m ? m[2].trim() : stripTags(extractTag(block, "source")),
      link: stripTags(extractTag(block, "link")),
      date: isNaN(d.getTime()) ? "" : d.toISOString(),
      lang,
      _desc: stripTags(extractTag(block, "description")),
    };
  }).filter((n) => n.title && n.link);
}

async function translateGtx(text, from) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=ko&dt=t&q=${encodeURIComponent(text.slice(0, 500))}`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error("gtx " + res.status);
  const j = await res.json();
  return (j[0] || []).map((x) => x[0]).join("").trim();
}
async function translateMyMemory(text, from) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 480))}&langpair=${from}|ko`;
  const j = await (await fetch(url, { headers: UA })).json();
  const t = j && j.responseData && j.responseData.translatedText;
  if (j.responseStatus != 200 || !t || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(t)) return "";
  return decodeEntities(t);
}
async function translate(text, from) {
  try { const t = await translateGtx(text, from); if (t) return t; } catch (e) { /* 아래로 */ }
  try { return await translateMyMemory(text, from); } catch (e) { return ""; }
}

function loadPrev() {
  try { return JSON.parse(fs.readFileSync(OUT, "utf-8")).items || []; } catch (e) { return []; }
}

async function main() {
  const prev = loadPrev();
  const prevKo = new Map(prev.filter((n) => n.titleKo).map((n) => [n.link, n.titleKo]));
  const found = [];
  let ok = 0;
  for (const s of SEARCHES) {
    try {
      const items = (await searchNews(s)).filter((n) => MUST.test(n.title + " " + n._desc));
      console.log(`[${s.lang}] "${s.q}" → ${items.length}건`);
      found.push(...items);
      ok++;
    } catch (err) {
      console.log(`::warning::[${s.lang}] "${s.q}" 실패: ${err.message}`);
    }
    await sleep(900);
  }
  if (!ok) {
    console.error("[오류] 모든 검색에 실패했습니다. 기존 파일을 유지합니다.");
    process.exit(prev.length ? 0 : 1);
  }

  // 새로 찾은 것 + 예전 것(기간 안) → 중복 제거 → 최신순
  const since = Date.now() - KEEP_DAYS * 86400000;
  const seenLink = new Set(), seenTitle = new Set();
  const list = [...found, ...prev].filter((n) => {
    const t = n.date ? Date.parse(n.date) : Date.now();
    if (t < since) return false;
    const k = n.title.replace(/[\s\-–—|:"'«»]+/g, "").slice(0, 50);
    if (seenLink.has(n.link) || seenTitle.has(k)) return false;
    seenLink.add(n.link); seenTitle.add(k);
    return true;
  }).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, MAX_ITEMS);

  let translated = 0;
  for (const n of list) {
    delete n._desc;
    if (n.lang === "ko") { n.titleKo = n.title; continue; }
    n.titleKo = n.titleKo || prevKo.get(n.link) || "";
    if (!n.titleKo) {
      n.titleKo = await translate(n.title, n.lang);
      if (n.titleKo) translated++;
      await sleep(350);
    }
  }

  const out = { generatedAt: new Date().toISOString(), items: list };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf-8");
  const by = (l) => list.filter((n) => n.lang === l).length;
  console.log(`저장 완료: 총 ${list.length}건 (한국어 ${by("ko")} · 아랍어 ${by("ar")} · 영어 ${by("en")}) · 새로 번역 ${translated}건`);
}

main().catch((err) => { console.error(err); process.exit(1); });
