// 구글 뉴스 RSS(한국어/대한민국)에서 "의학·질병·사고" 관련 최신 뉴스를 가져와
// domestic-news.json 으로 저장한다. GitHub Actions에서 주기적으로 실행됨.
// 외부 npm 패키지 없이 Node 내장 fetch + 정규식만으로 최소한으로 파싱한다.

const QUERY = '(질병 OR 전염병 OR 감염병 OR 사고 OR 의료 OR 의학) when:2d';
const RSS_URL =
  "https://news.google.com/rss/search?q=" +
  encodeURIComponent(QUERY) +
  "&hl=ko&gl=KR&ceid=KR:ko";

const MAX_ITEMS = 12;

function decodeEntities(str) {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function stripTags(html) {
  return decodeEntities(String(html || "").replace(/<[^>]*>/g, "")).trim();
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  let val = m[1].trim();
  const cdata = val.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) val = cdata[1];
  return val;
}

async function main() {
  const res = await fetch(RSS_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; BismayahHSEBot/1.0)" },
  });
  if (!res.ok) {
    throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();

  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  const items = itemBlocks.slice(0, MAX_ITEMS).map((block) => {
    const rawTitle = decodeEntities(stripTags(extractTag(block, "title")));
    // 구글 뉴스 제목은 보통 "헤드라인 - 언론사명" 형태
    const titleMatch = rawTitle.match(/^(.*)\s-\s([^-]+)$/);
    const title = titleMatch ? titleMatch[1].trim() : rawTitle;
    const source = titleMatch ? titleMatch[2].trim() : "";

    const link = stripTags(extractTag(block, "link"));
    const pubDateRaw = stripTags(extractTag(block, "pubDate"));
    let iso = "";
    if (pubDateRaw) {
      const d = new Date(pubDateRaw);
      if (!isNaN(d.getTime())) iso = d.toISOString();
    }
    const description = stripTags(extractTag(block, "description"));

    return {
      title,
      source,
      link,
      date: iso,
      summary: source ? `${source}` : description.slice(0, 80),
    };
  }).filter((n) => n.title && n.link);

  const output = {
    generatedAt: new Date().toISOString(),
    query: QUERY,
    items,
  };

  const fs = await import("node:fs/promises");
  await fs.writeFile("domestic-news.json", JSON.stringify(output, null, 2) + "\n", "utf-8");
  console.log(`domestic-news.json 저장 완료 (${items.length}건)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
