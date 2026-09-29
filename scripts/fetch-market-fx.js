// 이라크 시장환율(암시장/병행시장, 달러 100불당 디나르)을 수집해 market-fx.json에 저장한다.
//
// 출처를 두 곳으로 두고, 앞의 것이 실패하면 다음 것으로 넘어간다.
//   1) usdiqd.com  - 숫자를 자바스크립트로 그리는 사이트라 Puppeteer(헤드리스 크롬)로 연다
//   2) IraqiNews   - 매일 바그다드 환전소 시세 기사를 올리는 뉴스 사이트의 RSS(검색 피드)
//
// 실패하면 원인 파악을 위해 받은 페이지 앞부분을 Actions 로그에 찍는다.
// 달러 100불당 130,000~200,000 디나르 범위를 벗어난 숫자는 잘못 읽은 것으로 보고 버린다.

const fs = require("node:fs/promises");

const MIN_PER100 = 130000;
const MAX_PER100 = 200000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function toNum(s) {
  return parseFloat(String(s).replace(/[,\s]/g, ""));
}
function sane(per100) {
  return Number.isFinite(per100) && per100 >= MIN_PER100 && per100 <= MAX_PER100;
}

// 페이지 글자에서 "달러 100불당 디나르" 숫자를 찾는다 (여러 표기 방식 대응)
function findPer100(text) {
  const patterns = [
    /\$\s?100\s*=\s*([\d,]{6,8})\s*IQD/i,                  // $100 = 158,193 IQD
    /100\s*(?:USD|\$|dollars?)\s*=\s*([\d,]{6,8})/i,        // 100 USD = 158,193
    /([\d,]{7})\s*(?:IQD|dinars?)\s*(?:per|for|against|to)\s*(?:every\s*)?\$?\s?100/i, // 158,000 dinars per $100
    /(?:selling|sale|sell)\s*(?:rates?|prices?)?\s*(?:at|of|reached|hit)?\s*([\d,]{7})\s*dinars?/i,  // selling rates at 158,000 dinars
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const v = toNum(m[1]);
      if (sane(v)) return v;
    }
  }
  return null;
}

async function fromUsdiqd() {
  const URL = "https://usdiqd.com/en/";
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    const resp = await page.goto(URL, { waitUntil: "networkidle2", timeout: 45000 });
    await new Promise((r) => setTimeout(r, 4000));
    const text = await page.evaluate(() => document.body.innerText || "");
    const per100 = findPer100(text);
    if (!per100) {
      console.log(`[usdiqd.com] 응답 코드 ${resp ? resp.status() : "?"} · 숫자를 못 찾음. 페이지 앞부분:`);
      console.log(text.slice(0, 600).replace(/\s+/g, " "));
      return null;
    }
    let official = null;
    const om = text.match(/([\d,]{4,5}(?:\.\d+)?)\s*per\s*\$\s?1\b/i);
    if (om) official = toNum(om[1]);
    return { per100, official, source: URL, sourceDate: new Date().toISOString() };
  } finally {
    await browser.close();
  }
}

async function fromIraqiNews() {
  const FEED = "https://www.iraqinews.com/feed/?s=dollar+exchange+rates+baghdad";
  const res = await fetch(FEED, { headers: { "User-Agent": UA } });
  const xml = await res.text();
  if (!res.ok) {
    console.log(`[IraqiNews] 응답 코드 ${res.status}: ${xml.slice(0, 300)}`);
    return null;
  }
  const items = xml.split(/<item>/i).slice(1);
  for (const item of items) {
    const pick = (tag) => {
      const m = item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ") : "";
    };
    const text = `${pick("title")} ${pick("description")} ${pick("content:encoded")}`;
    const per100 = findPer100(text);
    if (per100) {
      const pub = pick("pubDate");
      const date = pub ? new Date(pub) : null;
      // 사흘 넘은 기사는 시세로 쓰지 않는다
      if (date && Date.now() - date.getTime() > 3 * 24 * 3600 * 1000) continue;
      const link = pick("link").trim();
      return { per100, official: null, source: link || FEED, sourceDate: date ? date.toISOString() : null };
    }
  }
  console.log(`[IraqiNews] 최근 기사에서 시세 숫자를 못 찾음 (기사 ${items.length}건 확인)`);
  return null;
}

async function main() {
  let result = null;
  for (const [name, fn] of [["usdiqd.com", fromUsdiqd], ["IraqiNews", fromIraqiNews]]) {
    try {
      result = await fn();
    } catch (err) {
      console.log(`[${name}] 오류: ${err.message}`);
    }
    if (result) {
      console.log(`[${name}] 성공: $100 = ${result.per100.toLocaleString()} IQD`);
      break;
    }
  }

  if (!result) {
    console.error("[오류] 모든 출처에서 시장환율을 찾지 못했습니다. 기존 market-fx.json을 유지합니다.");
    process.exit(1);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: result.source,
    sourceDate: result.sourceDate,
    usdIqdParallel: result.per100 / 100, // 실제 시장(암시장) 환율: 1 USD당 IQD
    usdIqdOfficial: result.official,     // 이라크 중앙은행 공식 고시환율 (찾은 경우만)
    note: "환전소 시세를 모은 비공식 참고 수치입니다.",
  };
  await fs.writeFile("market-fx.json", JSON.stringify(output, null, 2) + "\n", "utf-8");
  console.log(`market-fx.json 저장 완료 (1 USD = ${output.usdIqdParallel} IQD)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
