// usdiqd.com 페이지에서 이라크 "시장환율"(공식 고시환율이 아닌 실제 거래되는
// 환율)을 긁어와 market-fx.json 으로 저장한다.
// 공식 API가 없는 값이라 페이지의 표시 텍스트를 정규식으로 파싱하는
// 방식을 쓴다. 사이트 구조가 바뀌면 파싱이 실패할 수 있으므로,
// 실패 시 기존 market-fx.json을 그대로 두고 에러만 남긴다(덮어쓰지 않음).

const URL = "https://usdiqd.com/en/";

async function main() {
  const res = await fetch(URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; BismayahHSEBot/1.0)" },
  });
  if (!res.ok) {
    throw new Error(`페이지 요청 실패: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();

  // "$100 = 158,193 IQD" 형태에서 숫자만 추출
  const parallelMatch = html.match(/\$100\s*=\s*([\d,]+)\s*IQD/i);
  if (!parallelMatch) {
    throw new Error("시장환율(parallel rate) 텍스트를 페이지에서 찾지 못했습니다. 사이트 구조가 바뀌었을 수 있습니다.");
  }
  const parallelPer100 = parseFloat(parallelMatch[1].replace(/,/g, ""));
  const usdIqdParallel = parallelPer100 / 100;

  // 공식 환율("Official rate" 다음의 "1,300 per $1" 같은 표기)도 참고용으로 같이 저장
  let usdIqdOfficial = null;
  const officialMatch = html.match(/([\d,]+(?:\.\d+)?)\s*per\s*\$1/i);
  if (officialMatch) {
    usdIqdOfficial = parseFloat(officialMatch[1].replace(/,/g, ""));
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: URL,
    usdIqdParallel, // 실제 시장(암시장) 환율: 1 USD당 IQD
    usdIqdOfficial, // 이라크 중앙은행 공식 고시환율 (참고용)
    note: "usdiqd.com 페이지 표시값을 그대로 가져온 비공식 참고 수치입니다.",
  };

  const fs = await import("node:fs/promises");
  await fs.writeFile("market-fx.json", JSON.stringify(output, null, 2) + "\n", "utf-8");
  console.log(`market-fx.json 저장 완료 (시장환율 1 USD = ${usdIqdParallel} IQD)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
