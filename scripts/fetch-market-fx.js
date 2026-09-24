// usdiqd.com은 자바스크립트로 숫자를 그리는 SPA라 서버 쪽 단순 fetch로는
// 내용을 읽을 수 없었다(직접 확인함). 대신 알자지라 아랍어판(ajnet.me)이
// 거의 매일 올리는 "오늘 이라크 환율" 기사를 활용한다 — 이 기사들은 일반
// 서버 렌더링 뉴스 페이지라 fetch만으로 본문을 읽을 수 있고,
// "بلغ سعر الدولار في بغداد 1490 دينارا عند البيع" 같은 고정 문구 패턴으로
// 바그다드 시장(암시장) 환율 숫자가 박혀 있다.
//
// 절차: 1) 구글 뉴스에서 site:ajnet.me 로 "이라크 달러 환율" 관련 최신 기사를 찾는다
//       2) 그 기사 본문을 fetch한다
//       3) 본문에서 바그다드 시장환율/공식환율 숫자를 정규식으로 추출한다
// 사이트 구조가 바뀌면 실패할 수 있으므로, 실패 시 기존 market-fx.json을
// 그대로 두고 에러만 남긴다(덮어쓰지 않음).

const NEWS_QUERY = "site:ajnet.me (سعر الدولار العراق OR الدينار العراقي)";
const NEWS_RSS_URL =
  "https://news.google.com/rss/search?q=" +
  encodeURIComponent(NEWS_QUERY + " when:14d") +
  "&hl=ar&gl=IQ&ceid=IQ:ar";

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

async function findLatestArticleUrl() {
  const res = await fetch(NEWS_RSS_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; BismayahHSEBot/1.0)" },
  });
  if (!res.ok) throw new Error(`구글 뉴스 검색 실패: ${res.status}`);
  const xml = await res.text();
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  if (!itemBlocks.length) throw new Error("관련 기사를 찾지 못했습니다.");
  // 첫 번째(가장 최신) 결과의 링크를 사용
  const link = stripTags(extractTag(itemBlocks[0], "link"));
  if (!link) throw new Error("기사 링크를 추출하지 못했습니다.");
  return link;
}

// 구글 뉴스 RSS의 <link>는 실제 기사 주소가 아니라
// "https://news.google.com/rss/articles/..." 형태의 리다이렉트 중간 페이지다.
// 이 페이지의 HTML 안에는(자바스크립트를 실행하지 않아도) 실제 기사 주소가
// og:url 메타태그나 data 속성, 또는 그냥 평문 링크 형태로 박혀 있는 경우가 많다.
// 단, og:url 등이 구글 자기 자신(news.google.com)을 가리키는 경우가 있어서
// "ajnet.me" 또는 "aljazeera.net" 도메인을 포함한 URL만 인정하도록 엄격히 제한한다.
async function resolveRealArticleUrl(googleNewsUrl) {
  const res = await fetch(googleNewsUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; BismayahHSEBot/1.0)" },
  });
  if (!res.ok) throw new Error(`구글 뉴스 리다이렉트 페이지 요청 실패: ${res.status}`);
  const html = await res.text();

  // \/ 이스케이프(JSON 안에 있는 경우)까지 포함해서 ajnet.me / aljazeera.net URL을 전부 찾는다
  const domainPattern = /https?:\\?\/\\?\/(?:www\.)?(?:ajnet\.me|aljazeera\.net)[^\s"'<>\\]*/gi;
  const matches = html.match(domainPattern) || [];

  if (!matches.length) {
    throw new Error(
      `구글 뉴스 리다이렉트 페이지에서 실제 기사 주소(ajnet.me/aljazeera.net)를 찾지 못했습니다. (중간 페이지: ${googleNewsUrl})`
    );
  }

  return decodeEntities(matches[0]).replace(/\\\//g, "/");
}

async function main() {
  const googleNewsUrl = await findLatestArticleUrl();
  const articleUrl = await resolveRealArticleUrl(googleNewsUrl);

  const articleRes = await fetch(articleUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; BismayahHSEBot/1.0)" },
  });
  if (!articleRes.ok) {
    throw new Error(`기사 페이지 요청 실패: ${articleRes.status} (${articleUrl})`);
  }
  const html = await articleRes.text();
  const text = stripTags(html);

  // "بلغ سعر الدولار في بغداد 1490 دينارا عند البيع" 패턴 (시장/암시장 환율, 바그다드 기준)
  const marketMatch = text.match(/سعر الدولار في بغداد\s*([\d.,]+)\s*دينار/);
  // "سعر البيع بالمصارف: 1310 دنانير لكل دولار" 또는 "سعر البيع: 1305 دنانير" 패턴 (공식환율)
  const officialMatch =
    text.match(/سعر البيع بالمصارف[:\s]*([\d.,]+)\s*دينار/) ||
    text.match(/سعر البيع[:\s]*([\d.,]+)\s*دينار/);

  if (!marketMatch) {
    throw new Error(
      `기사에서 바그다드 시장환율 문구를 찾지 못했습니다. 기사 형식이 바뀌었을 수 있습니다. (기사: ${articleUrl})`
    );
  }

  const usdIqdParallel = parseFloat(marketMatch[1].replace(/,/g, ""));
  const usdIqdOfficial = officialMatch ? parseFloat(officialMatch[1].replace(/,/g, "")) : null;

  const output = {
    generatedAt: new Date().toISOString(),
    source: articleUrl,
    usdIqdParallel, // 실제 시장(암시장) 환율: 1 USD당 IQD (바그다드 기준)
    usdIqdOfficial, // 이라크 공식 고시환율 (참고용, 기사에 없으면 null)
    note: "알자지라 아랍어판 기사 본문에서 가져온 바그다드 기준 환율입니다.",
  };

  const fs = await import("node:fs/promises");
  await fs.writeFile("market-fx.json", JSON.stringify(output, null, 2) + "\n", "utf-8");
  console.log(`market-fx.json 저장 완료 (시장환율 1 USD = ${usdIqdParallel} IQD, 출처: ${articleUrl})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
