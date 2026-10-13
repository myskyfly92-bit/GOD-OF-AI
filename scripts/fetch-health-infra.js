// 세계 각국 의료 인프라 수준을 세계은행(World Bank) 공개 API에서 모아 health-infra.json 으로 저장한다.
// GitHub Actions에서 매주 한 번 실행 (원자료가 1년에 한두 번 바뀌는 통계라 자주 돌릴 필요 없음). API 키 필요 없음.
//
// 지표 (세계은행 WDI · 원자료는 대부분 WHO)
//   UHC 서비스 보장 지수(0~100) · 의사 수 · 간호·조산 인력 · 병상 수(인구 1,000명당)
//   1인당 의료비(달러) · 기대수명 · 영아 사망률 · 모성 사망비
//
// 종합점수 (0~100, 상황실 자체 계산 — 공식 순위가 아님)
//   - 지표마다 '세계 몇 % 나라보다 나은지'(백분위)를 구한다. 사망률은 낮을수록 좋게 뒤집는다.
//   - 가중 평균: UHC 30 · 의사 15 · 간호 10 · 병상 10 · 의료비 10 · 기대수명 10 · 영아사망 10 · 모성사망 5
//   - 2010년 이후 값만 점수에 쓴다. 가중치 합이 60 이상 모인 나라만 점수를 매긴다.
const fs = require("fs");
const OUT = "health-infra.json";
const KO = JSON.parse(fs.readFileSync("assets/country-ko.json", "utf8"));
const MIN_YEAR = 2010;
const IND = [
  { k: "uhc", id: "SH.UHC.SRVS.CV.XD", name: "UHC 서비스 보장 지수", short: "UHC 지수", unit: "점", w: 30, hi: true, dec: 0 },
  { k: "doc", id: "SH.MED.PHYS.ZS", name: "의사 수 (인구 1,000명당)", short: "의사", unit: "명", w: 15, hi: true, dec: 2 },
  { k: "nurse", id: "SH.MED.NUMW.P3", name: "간호·조산 인력 (인구 1,000명당)", short: "간호인력", unit: "명", w: 10, hi: true, dec: 1 },
  { k: "bed", id: "SH.MED.BEDS.ZS", name: "병상 수 (인구 1,000명당)", short: "병상", unit: "개", w: 10, hi: true, dec: 1 },
  { k: "spend", id: "SH.XPD.CHEX.PC.CD", name: "1인당 의료비 지출", short: "의료비", unit: "달러", w: 10, hi: true, dec: 0 },
  { k: "life", id: "SP.DYN.LE00.IN", name: "기대수명", short: "기대수명", unit: "세", w: 10, hi: true, dec: 1 },
  { k: "imr", id: "SP.DYN.IMRT.IN", name: "영아 사망률 (출생 1,000명당)", short: "영아사망", unit: "명", w: 10, hi: false, dec: 1 },
  { k: "mmr", id: "SH.STA.MMRT", name: "모성 사망비 (출생 10만 명당)", short: "모성사망", unit: "명", w: 5, hi: false, dec: 0 },
];
const REGION = { EAS: "동아시아·태평양", ECS: "유럽·중앙아시아", LCN: "중남미", MEA: "중동·북아프리카", NAC: "북미", SAS: "남아시아", SSF: "사하라 이남 아프리카" };
const INCOME = { HIC: "고소득", UMC: "중상위소득", LMC: "중하위소득", LIC: "저소득", INX: "" };

async function getJson(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "bismayah-hse-dashboard" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      console.warn(`  ${i}차 실패 ${url.slice(0, 90)} · ${e.message}`);
      if (i === tries) throw e;
      await new Promise((s) => setTimeout(s, 3000 * i));
    }
  }
}

async function main() {
  // 나라 목록 (지역·소득 묶음 같은 '합계' 항목은 뺀다)
  const meta = await getJson("https://api.worldbank.org/v2/country?format=json&per_page=400");
  const C = {};
  for (const c of meta[1] || []) {
    if (!c.region || c.region.id === "NA" || !c.id) continue;
    C[c.id] = { c: c.id, ko: KO[c.id] || c.name, en: c.name, reg: c.region.id, region: REGION[c.region.id] || c.region.value, income: INCOME[c.incomeLevel && c.incomeLevel.id] || "", v: {}, r: {}, p: {} };
  }
  console.log("나라 수", Object.keys(C).length);

  let okInd = 0;
  for (const ind of IND) {
    try {
      const j = await getJson(`https://api.worldbank.org/v2/country/all/indicator/${ind.id}?format=json&per_page=20000&date=2000:2030`);
      let n = 0;
      for (const row of j[1] || []) {
        const iso = row.countryiso3code, x = C[iso];
        if (!x || row.value == null) continue;
        const yr = Number(row.date);
        if (!x.v[ind.k] || yr > x.v[ind.k][1]) { x.v[ind.k] = [Math.round(row.value * 100) / 100, yr]; }
      }
      for (const k in C) if (C[k].v[ind.k]) n++;
      console.log(`[${ind.short}] ${n}개 나라`);
      okInd++;
    } catch (e) { console.warn(`[${ind.short}] 수집 실패: ${e.message}`); }
    await new Promise((s) => setTimeout(s, 800));
  }
  if (okInd < 4) {
    console.error("지표를 절반도 못 받았습니다. 이전 파일을 그대로 둡니다.");
    process.exit(0);
  }

  // 지표별 백분위·순위 (2010년 이후 값만)
  const world = {};
  for (const ind of IND) {
    const list = Object.values(C).filter((x) => x.v[ind.k] && x.v[ind.k][1] >= MIN_YEAR);
    const vals = list.map((x) => x.v[ind.k][0]).sort((a, b) => a - b);
    const n = vals.length; if (!n) continue;
    world[ind.k] = { median: Math.round(vals[Math.floor(n / 2)] * 100) / 100, n };
    for (const x of list) {
      const v = x.v[ind.k][0];
      const below = vals.filter((y) => y < v).length, eq = vals.filter((y) => y === v).length;
      let pct = (below + eq / 2) / n * 100;
      if (!ind.hi) pct = 100 - pct;
      x.p[ind.k] = Math.round(pct * 10) / 10;
    }
    list.sort((a, b) => ind.hi ? b.v[ind.k][0] - a.v[ind.k][0] : a.v[ind.k][0] - b.v[ind.k][0]);
    list.forEach((x, i) => { x.r[ind.k] = i + 1; });
  }

  // 종합점수
  for (const x of Object.values(C)) {
    let s = 0, w = 0;
    for (const ind of IND) if (x.p[ind.k] != null) { s += x.p[ind.k] * ind.w; w += ind.w; }
    x.cover = w;
    if (w >= 60) {
      x.score = Math.round(s / w * 10) / 10;
      x.grade = x.score >= 80 ? 5 : x.score >= 60 ? 4 : x.score >= 40 ? 3 : x.score >= 20 ? 2 : 1;
    }
  }
  const scored = Object.values(C).filter((x) => x.score != null).sort((a, b) => b.score - a.score);
  scored.forEach((x, i) => { x.rank = i + 1; });
  const countries = Object.values(C).sort((a, b) => (a.rank || 999) - (b.rank || 999) || a.ko.localeCompare(b.ko, "ko"));
  countries.forEach((x) => { delete x.p; });

  const out = {
    generatedAt: new Date().toISOString(),
    source: "World Bank World Development Indicators (원자료 WHO·UN 등)",
    minYear: MIN_YEAR,
    indicators: IND.map(({ id, ...r }) => ({ ...r, wb: id })),
    grades: ["", "매우 낮음", "낮음", "보통", "높음", "매우 높음"],
    world, scoredCount: scored.length, countries,
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  const show = (c) => { const x = C[c]; return x ? `${x.ko} ${x.score ?? "-"}점 ${x.rank ?? "-"}위` : c; };
  console.log(`저장 완료: ${countries.length}개 나라 · 점수 ${scored.length}개 · ${show("KOR")} · ${show("IRQ")} · 1위 ${scored[0] && scored[0].ko}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
