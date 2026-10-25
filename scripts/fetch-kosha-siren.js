/*
 * 산업안전포털 '중대재해 사이렌' 수집 → kosha-siren.json + assets/siren/{번호}.jpg
 * https://portal.kosha.or.kr/archive/imprtnDsstrAlrame/CSADV50000/CSADV50000M01
 *
 * 포털은 자바스크립트로 목록을 그리기 때문에, 실제 크롬으로 페이지를 열고
 * 페이지가 부르는 selectImprtnDsstrSirnList 응답(JSON)을 그대로 받아 쓴다.
 * 각 항목: 번호(imprtnDsstrSirnNo) · 제목(imprtnDsstrSirnNm) · 포스터 그림(imgSrc, base64)
 *
 * GitHub Actions 우분투 러너에 깔려 있는 Google Chrome 을 쓴다 (playwright-core, channel: chrome).
 * 로컬 실행: npm i playwright-core && node scripts/fetch-kosha-siren.js
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const PAGE_URL = "https://portal.kosha.or.kr/archive/imprtnDsstrAlrame/CSADV50000/CSADV50000M01";
const API_KEY = "selectImprtnDsstrSirnList";
const OUT = "kosha-siren.json";
const IMG_DIR = path.join("assets", "siren");
const KEEP = 30; // 포스터는 최신 30건만 보관

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; } }

async function capture() {
  const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || "chrome", headless: true });
  try {
    const page = await browser.newPage({ locale: "ko-KR", viewport: { width: 1366, height: 900 } });
    const got = page.waitForResponse((r) => r.url().includes(API_KEY) && r.status() === 200, { timeout: 45000 });
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    const res = await got;
    return { url: res.url(), body: await res.json() };
  } finally {
    await browser.close();
  }
}

function pickList(body) {
  const p = (body && (body.payload || body.data || body)) || {};
  const list = p.imprtnDsstrSirnList || p.list || [];
  return Array.isArray(list) ? list : [];
}

function saveImage(no, src) {
  if (!src) return "";
  const m = String(src).match(/^data:image\/(\w+);base64,(.*)$/s);
  const ext = m ? (m[1] === "jpeg" ? "jpg" : m[1]) : "jpg";
  const b64 = m ? m[2] : String(src);
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 200) return "";
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const file = path.join(IMG_DIR, `${no}.${ext}`);
  if (!fs.existsSync(file) || fs.statSync(file).size !== buf.length) fs.writeFileSync(file, buf);
  return file.split(path.sep).join("/");
}

(async () => {
  let cap = null, lastErr = null;
  for (let i = 1; i <= 3 && !cap; i++) {
    try { cap = await capture(); } catch (e) { lastErr = e; console.log(`시도 ${i} 실패: ${e.message}`); await new Promise((r) => setTimeout(r, 4000 * i)); }
  }
  if (!cap) { console.log("중대재해 사이렌을 가져오지 못했습니다 — 기존 파일 유지:", lastErr && lastErr.message); process.exit(0); }

  const list = pickList(cap.body);
  console.log(`API ${cap.url} → ${list.length}건`);
  if (list.length) console.log("항목 필드:", Object.keys(list[0]).join(", "));
  if (!list.length) { console.log("목록이 비어 있음 — 기존 파일 유지"); process.exit(0); }

  const prev = readJson(OUT) || { items: [] };
  const seen = {};
  (prev.items || []).forEach((x) => { seen[x.no] = x; });
  const now = new Date().toISOString();

  const items = list.map((x) => {
    const no = String(x.imprtnDsstrSirnNo || x.sirnNo || x.no || "").trim();
    const title = String(x.imprtnDsstrSirnNm || x.title || "").replace(/\s+/g, " ").trim();
    if (!no || !title) return null;
    const old = seen[no] || {};
    const img = saveImage(no, x.imgSrc) || old.img || "";
    // 날짜처럼 보이는 필드가 있으면 그대로 남긴다 (등록일 등)
    const dateKey = Object.keys(x).find((k) => /(reg|frst|crt|wrt|pst).*(dt|de|date)$/i.test(k) && x[k]);
    return { no, title, img, date: dateKey ? String(x[dateKey]).slice(0, 10) : (old.date || ""), firstSeen: old.firstSeen || now };
  }).filter(Boolean);

  // 예전 항목 중 이번 목록에 없는 것도 최신 KEEP 건 안에서는 남긴다
  const byNo = {};
  items.concat(prev.items || []).forEach((x) => { if (!byNo[x.no]) byNo[x.no] = x; });
  const merged = Object.values(byNo).sort((a, b) => Number(b.no) - Number(a.no)).slice(0, KEEP);

  // 보관 범위 밖 포스터는 지운다
  const keepImgs = new Set(merged.map((x) => x.img).filter(Boolean));
  if (fs.existsSync(IMG_DIR)) fs.readdirSync(IMG_DIR).forEach((f) => {
    const p = `${IMG_DIR}/${f}`.split(path.sep).join("/");
    if (!keepImgs.has(p)) fs.unlinkSync(path.join(IMG_DIR, f));
  });

  const sameList = JSON.stringify(merged.map((x) => [x.no, x.title, x.img])) === JSON.stringify((prev.items || []).map((x) => [x.no, x.title, x.img]));
  if (sameList && prev.generatedAt) { console.log("변경 없음"); return; }
  const out = { source: PAGE_URL, generatedAt: now, items: merged };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`저장: ${merged.length}건 (최신 ${merged[0] && merged[0].no} · ${merged[0] && merged[0].title})`);
})();
