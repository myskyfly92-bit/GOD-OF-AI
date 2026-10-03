// 탭별 관련 뉴스 (구글 뉴스 RSS · 한국어) 를 모아 topic-news.json 으로 저장한다.
//  - sa     : 안전 > 국내 중대재해 현황 아래 "중대재해·산업재해 관련 뉴스"
//  - infect : 보건 > 국내 감염병 현황 아래 "감염병 관련 뉴스"
// GitHub Actions에서 하루 4번 실행. 외부 패키지 없이 Node 내장 fetch 만 사용.

const fs = require("fs");
const OUT = "topic-news.json";
const MAX_ITEMS = 12;

const TOPICS = {
  sa: {
    label: "중대재해·산업재해",
    query: '(중대재해 OR 산업재해 OR "작업 중 사망" OR "추락사" OR "끼임 사고" OR 중대재해처벌법) when:3d',
    // 제목에 이런 단어가 하나는 있어야 남긴다 (엉뚱한 기사 거르기)
    must: /중대재해|산업재해|산재|사망사고|숨져|숨진|사망|추락|끼임|깔림|매몰|붕괴|폭발|화재|중처법|작업중지|안전보건/,
  },
  embassy: {
    label: "중동 대사관·안전",
    query: '("주이라크" OR "주이란" OR "주요르단" OR "주사우디" OR "주쿠웨이트" OR "주레바논" OR "주이스라엘" OR "주이집트" OR "주UAE" OR "주카타르" OR "주바레인" OR "주오만" OR "주튀르키예" OR "주예멘" OR "외교부 안전공지" OR "중동 여행경보" OR "중동 교민") when:7d',
    must: /대사관|여행경보|여행금지|출국권고|안전공지|교민|재외국민|국민 보호|철수|대피|영사|외교부/,
  },
  infect: {
    label: "감염병",
    query: '(감염병 OR 질병관리청 OR 법정감염병 OR 확진 OR 집단감염 OR 해외유입 OR 백신) when:3d',
    must: /감염|질병|질병관리청|질병청|확진|유행|바이러스|백신|독감|인플루엔자|홍역|결핵|말라리아|뎅기|코로나|엠폭스|수두|백일해|쯔쯔가무시|CRE|슈퍼박테리아|방역|검역/,
  },
};

const UA = { "User-Agent": "Mozilla/5.0 (compatible; BismayahHSEBot/1.0)" };
const decode = (s) => String(s || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
const strip = (h) => decode(String(h || "").replace(/<[^>]*>/g, "")).trim();
function tag(block, t) {
  const m = block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, "i"));
  if (!m) return "";
  const v = m[1].trim(), c = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return c ? c[1] : v;
}

async function fetchTopic(key, t) {
  const url = "https://news.google.com/rss/search?q=" + encodeURIComponent(t.query) + "&hl=ko&gl=KR&ceid=KR:ko";
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`구글 뉴스 응답 ${res.status}`);
  const xml = await res.text();
  const seen = new Set();
  const items = (xml.match(/<item>[\s\S]*?<\/item>/g) || []).map((b) => {
    const raw = strip(tag(b, "title"));
    const m = raw.match(/^(.*)\s-\s([^-]+)$/);
    const d = new Date(strip(tag(b, "pubDate")));
    return { title: m ? m[1].trim() : raw, source: m ? m[2].trim() : "", link: strip(tag(b, "link")),
             date: isNaN(d) ? "" : d.toISOString() };
  }).filter((n) => {
    if (!n.title || !n.link || !t.must.test(n.title)) return false;
    const k = n.title.replace(/\s+/g, "").slice(0, 30); // 같은 사건 여러 언론사 기사 중복 줄이기
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, MAX_ITEMS);
  console.log(`[${key}] ${items.length}건`);
  return items;
}

(async () => {
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(OUT, "utf-8")); } catch (e) {}
  const out = { generatedAt: new Date().toISOString() };
  let ok = 0;
  for (const [key, t] of Object.entries(TOPICS)) {
    try {
      out[key] = { label: t.label, items: await fetchTopic(key, t) };
      ok++;
    } catch (err) {
      console.log(`[${key}] 실패: ${err.message} → 이전 자료 유지`);
      out[key] = prev[key] || { label: t.label, items: [] };
    }
  }
  if (!ok) { console.error("[오류] 모든 주제 수집 실패"); process.exit(1); }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf-8");
  console.log("topic-news.json 저장 완료");
})();
