// usdiqd.com은 숫자를 자바스크립트로 그리는 SPA라서, 일반 fetch()로는
// 빈 껍데기 HTML만 받아진다(직접 확인함). 구글 뉴스를 거쳐 우회하는 방법도
// 실제 기사 주소 역시 자바스크립트로만 드러나는 구조라 실패했다.
// 그래서 이번엔 Puppeteer(헤드리스 크롬)로 실제 브라우저처럼 페이지를 열고,
// 자바스크립트가 다 실행된 뒤의 최종 화면 텍스트에서 숫자를 읽는다.

const URL = "https://usdiqd.com/en/";

async function main() {
  const puppeteer = (await import("puppeteer")).default;

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    );
    await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
    // 숫자가 뒤늦게 바뀌는 경우를 대비해 잠깐 더 기다린다
    await new Promise((r) => setTimeout(r, 3000));

    const bodyText = await page.evaluate(() => document.body.innerText);

    // "$100 = 158,193 IQD" 형태에서 숫자만 추출 (실제 시장/암시장 환율)
    const parallelMatch = bodyText.match(/\$100\s*=\s*([\d,]+)\s*IQD/i);
    if (!parallelMatch) {
      throw new Error(
        "렌더링된 페이지에서도 시장환율(parallel rate) 텍스트를 찾지 못했습니다. 사이트 구조가 바뀌었을 수 있습니다."
      );
    }
    const parallelPer100 = parseFloat(parallelMatch[1].replace(/,/g, ""));
    const usdIqdParallel = parallelPer100 / 100;

    // 공식 환율("... per $1" 같은 표기)도 참고용으로 같이 저장 (없으면 null)
    let usdIqdOfficial = null;
    const officialMatch = bodyText.match(/([\d,]+(?:\.\d+)?)\s*per\s*\$1/i);
    if (officialMatch) {
      usdIqdOfficial = parseFloat(officialMatch[1].replace(/,/g, ""));
    }

    const output = {
      generatedAt: new Date().toISOString(),
      source: URL,
      usdIqdParallel, // 실제 시장(암시장) 환율: 1 USD당 IQD
      usdIqdOfficial, // 이라크 중앙은행 공식 고시환율 (참고용)
      note: "usdiqd.com 페이지를 Puppeteer로 렌더링해 읽은 비공식 참고 수치입니다.",
    };

    const fs = await import("node:fs/promises");
    await fs.writeFile("market-fx.json", JSON.stringify(output, null, 2) + "\n", "utf-8");
    console.log(`market-fx.json 저장 완료 (시장환율 1 USD = ${usdIqdParallel} IQD)`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
