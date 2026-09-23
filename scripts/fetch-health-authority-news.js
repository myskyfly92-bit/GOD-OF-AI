// 질병관리청(kdca.go.kr), 보건복지부(mohw.go.kr) 공식 도메인에 게시된
// 보도자료·소식을 구글 뉴스 검색(site: 연산자)으로 가져와
// health-authority-news.json 으로 저장한다.
// 두 기관 홈페이지 자체는 깔끔한 공개 RSS가 없어서, 구글 뉴스 검색 결과를
// 우회 경로로 사용한다. GitHub Actions에서 주기적으로 실행됨.

const QUERY = "(site:kdca.go.kr OR site:mohw.go.kr) when:7d";
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

function detectAgency(title, link) {
  const hay = `${title} ${link}`;
  if (/kdca\.go\.kr/i.test(hay)) return "질병관리청";
  if (/mohw\.go\.kr/i.test(hay)) return "보건복지부";
  return "";
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

    const agency = detectAgency(rawTitle, link);

    return {
      title,
      source,
      agency, // "질병관리청" | "보건복지부" | ""
      link,
      date: iso,
    };
  }).filter((n) => n.title && n.link);

  const output = {
    generatedAt: new Date().toISOString(),
    query: QUERY,
    items,
  };

  const fs = await import("node:fs/promises");
  await fs.writeFile("health-authority-news.json", JSON.stringify(output, null, 2) + "\n", "utf-8");
  console.log(`health-authority-news.json 저장 완료 (${items.length}건)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
