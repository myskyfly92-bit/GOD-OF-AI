// 이라크 보건부·환경부 관련 소식을 구글 뉴스 검색(아랍어·영어)으로 모아
// iraq-ministry-news.json 으로 저장한다. GitHub Actions에서 하루 두 번 실행.
//
// - 두 부처 홈페이지는 깔끔한 공개 RSS가 없고 해외 서버 접속이 불안정해서,
//   구글 뉴스 검색 결과를 우회 경로로 쓴다 (질병관리청 소식과 같은 방식).
// - 제목은 무료 번역 API(MyMemory)로 한국어 번역을 붙인다. 번역이 안 되면 원문만 둔다.

const OUT = "iraq-ministry-news.json";
const MAX_ITEMS = 12;

const TOPICS = {
  health: [
    { lang: "ar", q: '"وزارة الصحة" العراق when:7d', hl: "ar", gl: "IQ", ceid: "IQ:ar" },
    { lang: "en", q: '("Iraqi Ministry of Health" OR "Iraq\'s Ministry of Health" OR "Iraqi health ministry") when:14d', hl: "en-US", gl: "US", ceid: "US:en" },
  ],
  environment: [
    { lang: "ar", q: '"وزارة البيئة" العراق when:14d', hl: "ar", gl: "IQ", ceid: "IQ:ar" },
    { lang: "en", q: '("Iraqi Ministry of Environment" OR "Iraq\'s Ministry of Environment" OR "Iraqi environment ministry") when:30d', hl: "en-US", gl: "US", ceid: "US:en" },
  ],
};

const UA = { "User-Agent": "Mozilla/5.0 (compatible; BismayahHSEBot/1.0)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return String(s || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
}
function stripTags(html) { return decodeEntities(String(html || "").replace(/<[^>]*>/g, "")).trim(); }
function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  let v = m[1].trim();
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
      source: m ? m[2].trim() : "",
      link: stripTags(extractTag(block, "link")),
      date: isNaN(d.getTime()) ? "" : d.toISOString(),
      lang,
    };
  }).filter((n) => n.title && n.link);
}

// 무료 번역 (MyMemory). 하루 무료 한도가 있어서 제목만, 짧게 번역한다.
async function translate(text, from) {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 480))}&langpair=${from}|ko`;
    const res = await fetch(url, { headers: UA });
    const j = await res.json();
    const t = j && j.responseData && j.responseData.translatedText;
    if (j.responseStatus != 200 || !t || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(t)) return "";
    return decodeEntities(t);
  } catch (e) {
    return "";
  }
}

// 이전 파일에 이미 번역해 둔 제목은 다시 번역하지 않는다
function loadPrev() {
  try {
    const prev = JSON.parse(require("fs").readFileSync(OUT, "utf-8"));
    const map = new Map();
    ["health", "environment"].forEach((k) => (prev[k] || []).forEach((n) => { if (n.titleKo) map.set(n.link, n.titleKo); }));
    return map;
  } catch (e) {
    return new Map();
  }
}

async function main() {
  const prevKo = loadPrev();
  const out = { generatedAt: new Date().toISOString(), health: [], environment: [] };
  let ok = 0, translated = 0;

  for (const [topic, searches] of Object.entries(TOPICS)) {
    const all = [];
    for (const s of searches) {
      try {
        const items = await searchNews(s);
        console.log(`[${topic}/${s.lang}] ${items.length}건`);
        all.push(...items);
        ok++;
      } catch (err) {
        console.log(`[${topic}/${s.lang}] 실패: ${err.message}`);
      }
      await sleep(800);
    }
    // 같은 제목 중복 제거 → 최신순 → 상위 N개
    const seen = new Set();
    const list = all.filter((n) => {
      const k = n.title.replace(/\s+/g, "").slice(0, 60);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, MAX_ITEMS);

    for (const n of list) {
      n.titleKo = prevKo.get(n.link) || "";
      if (!n.titleKo) {
        n.titleKo = await translate(n.title, n.lang);
        if (n.titleKo) translated++;
        await sleep(400);
      }
    }
    out[topic] = list;
  }

  if (!ok) {
    console.error("[오류] 모든 검색에 실패했습니다. 기존 파일을 유지합니다.");
    process.exit(1);
  }
  require("fs").writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf-8");
  console.log(`저장 완료: 보건부 ${out.health.length}건 · 환경부 ${out.environment.length}건 · 새로 번역 ${translated}건`);
}

main().catch((err) => { console.error(err); process.exit(1); });
