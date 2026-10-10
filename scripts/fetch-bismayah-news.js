// 비스마야 신도시 관련 뉴스를 구글 뉴스 검색(한국어·아랍어·영어)으로 모아
// bismayah-news.json 으로 저장한다. GitHub Actions에서 6시간마다 실행.
//
// - 검색어: 비스마야 / بسماية / Bismayah·Bismaya
// - 아랍어·영어 제목은 한국어로 번역해 붙인다 (구글 번역 무료 주소 → 안 되면 MyMemory)
// - 이전 파일에 있던 기사도 기간 안이면 남겨서, 검색에 잠깐 안 잡혀도 목록이 비지 않게 한다

const fs = require("fs");
// NEWS_CFG=health 로 돌리면 '보건 > 세계 보건 이슈' 용 (감염병 유행·페스트·에볼라 등)
const CFGS = {
  bismayah: {
    OUT: "bismayah-news.json", KEEP_DAYS: 60, MAX_ITEMS: 60,
    SEARCHES: [
      { lang: "ko", q: "비스마야 when:30d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ko", q: "비스마야 신도시 한화 when:60d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ar", q: "بسماية when:30d", hl: "ar", gl: "IQ", ceid: "IQ:ar" },
      { lang: "ar", q: '"مدينة بسماية" OR "مجمع بسماية" when:60d', hl: "ar", gl: "IQ", ceid: "IQ:ar" },
      { lang: "en", q: "(Bismayah OR Bismaya) Iraq when:60d", hl: "en-US", gl: "US", ceid: "US:en" },
    ],
    // 제목이나 요약에 비스마야가 실제로 나와야 한다 (검색 엔진이 엉뚱한 기사를 섞는 것 거르기)
    MUST: /비스마야|بسماية|بسمايه|bismay/i,
  },
  health: {
    OUT: "health-issues.json", KEEP_DAYS: 30, MAX_ITEMS: 80,
    SEARCHES: [
      { lang: "ko", q: "(페스트 OR 흑사병 OR 에볼라 OR 마버그 OR 조류인플루엔자 OR 엠폭스 OR 콜레라 OR 니파) when:14d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ko", q: "해외 감염병 유행 when:14d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ko", q: "WHO 감염병 경보 when:14d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "en", q: '(plague OR ebola OR marburg OR "bird flu" OR H5N1 OR mpox OR cholera OR nipah) outbreak when:7d', hl: "en-US", gl: "US", ceid: "US:en" },
      { lang: "en", q: 'Iraq (cholera OR "hemorrhagic fever" OR CCHF OR measles OR outbreak) when:30d', hl: "en-US", gl: "US", ceid: "US:en" },
      { lang: "ar", q: "(الحمى النزفية OR الكوليرا OR انفلونزا الطيور OR الحصبة) العراق when:30d", hl: "ar", gl: "IQ", ceid: "IQ:ar" },
    ],
    // 감염병·보건 관련 낱말이 실제로 있어야 한다
    MUST: /감염|전염|확진|역학|페스트|흑사병|에볼라|마버그|바이러스|독감|인플루엔자|엠폭스|콜레라|니파|홍역|뎅기|outbreak|plague|ebola|marburg|virus|flu|h5n1|mpox|cholera|nipah|measles|dengue|epidemic|pandemic|infection|cchf|hemorrhagic|نزفية|كوليرا|انفلونزا|حصبة|فيروس|وباء|إصابات|الصحة/i,
  },
};
const CFG = CFGS[process.env.NEWS_CFG || "bismayah"];
const OUT = CFG.OUT;
const KEEP_DAYS = CFG.KEEP_DAYS;   // 이 기간 안의 기사만 남긴다
const MAX_ITEMS = CFG.MAX_ITEMS;   // 최대 몇 건까지 보여 줄지
const BODY_PER_RUN = 30; // 한 번 실행할 때 본문을 새로 가져올 최대 건수
const SEARCHES = CFG.SEARCHES;
const MUST = CFG.MUST;

const UA = { "User-Agent": "Mozilla/5.0 (compatible; BismayahHSEBot/1.0)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return String(s || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\u00a0/g, " ");
}
function stripTags(html) { return decodeEntities(String(html || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(); }
function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  const v = m[1].trim();
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
      source: m ? m[2].trim() : stripTags(extractTag(block, "source")),
      link: stripTags(extractTag(block, "link")),
      date: isNaN(d.getTime()) ? "" : d.toISOString(),
      lang,
      _desc: stripTags(extractTag(block, "description")),
    };
  }).filter((n) => n.title && n.link);
}

async function translateGtx(text, from) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=ko&dt=t&q=${encodeURIComponent(text.slice(0, 900))}`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error("gtx " + res.status);
  const j = await res.json();
  return (j[0] || []).map((x) => x[0]).join("").trim();
}
async function translateMyMemory(text, from) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 480))}&langpair=${from}|ko`;
  const j = await (await fetch(url, { headers: UA })).json();
  const t = j && j.responseData && j.responseData.translatedText;
  if (j.responseStatus != 200 || !t || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(t)) return "";
  return decodeEntities(t);
}
async function translate(text, from) {
  try { const t = await translateGtx(text, from); if (t) return t; } catch (e) { /* 아래로 */ }
  try { return await translateMyMemory(text, from); } catch (e) { return ""; }
}

// 구글 뉴스 주소(news.google.com/rss/articles/…)를 실제 기사 주소로 바꾼다
async function resolveGoogle(link) {
  const m = String(link).match(/news\.google\.com\/(?:rss\/)?articles\/([^?/]+)/);
  if (!m) return link;
  const id = m[1];
  try {
    const page = await (await fetch(`https://news.google.com/articles/${id}`, { headers: UA })).text();
    const sg = (page.match(/data-n-a-sg="([^"]+)"/) || [])[1], ts = (page.match(/data-n-a-ts="([^"]+)"/) || [])[1];
    if (!sg || !ts) return link;
    const req = [[["Fbv4je", JSON.stringify(["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]), null, "generic"]]];
    const res = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST",
      headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: "f.req=" + encodeURIComponent(JSON.stringify(req)),
    });
    const txt = await res.text();
    const part = txt.split("\n\n")[1];
    const url = JSON.parse(JSON.parse(part)[0][2])[1];
    return /^https?:\/\//.test(url) ? url : link;
  } catch (e) {
    return link;
  }
}

// 기사 페이지에서 본문 앞부분(요약 + 첫 문단 몇 개)만 뽑는다 (전문이 아니라 미리보기용 발췌)
async function articleText(url) {
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000);
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36", "Accept-Language": "ko,ar;q=0.8,en;q=0.7" }, redirect: "follow", signal: ctl.signal });
    clearTimeout(tm);
    if (!res.ok) return "";
    let html = await res.text();
    const clean = (t) => decodeEntities(String(t).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const og = clean((html.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']+)/i) || [])[1] || "");
    html = html.replace(/<(script|style|nav|header|footer|aside|form|noscript|figure)[\s\S]*?<\/\1>/gi, " ");
    const art = html.match(/<article[\s\S]*?<\/article>/i);
    if (art) html = art[0];
    const paras = (html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || []).map(clean).filter((t) =>
      t.length > 50 && /[.!?؟。다]/.test(t) && t.split(" ").length >= 7 &&
      !/cookie|copyright|©|subscribe|javascript|all rights reserved|جميع الحقوق|무단 ?전재|재배포 ?금지|기자\s*[a-z0-9._%+-]+@/i.test(t));
    let text = og && og.length > 40 ? og : "";
    for (const t of paras) {
      if (text.length > 800) break;
      if (!text.includes(t.slice(0, 40))) text += (text ? "\n" : "") + t;
    }
    return text.slice(0, 1000);
  } catch (e) {
    return "";
  }
}

// 긴 글 번역: 문단별로 잘라서 번역 (주소 길이 제한 때문에)
async function translateLong(text, from) {
  const out = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) continue;
    out.push((await translate(para, from)) || "");
    await sleep(250);
  }
  return out.filter(Boolean).join("\n");
}

function loadPrev() {
  try { return JSON.parse(fs.readFileSync(OUT, "utf-8")).items || []; } catch (e) { return []; }
}

async function main() {
  const prev = loadPrev();
  const prevKo = new Map(prev.filter((n) => n.titleKo).map((n) => [n.link, n.titleKo]));
  const found = [];
  let ok = 0;
  for (const s of SEARCHES) {
    try {
      const items = (await searchNews(s)).filter((n) => MUST.test(n.title + " " + n._desc));
      console.log(`[${s.lang}] "${s.q}" → ${items.length}건`);
      found.push(...items);
      ok++;
    } catch (err) {
      console.log(`::warning::[${s.lang}] "${s.q}" 실패: ${err.message}`);
    }
    await sleep(900);
  }
  if (!ok) {
    console.error("[오류] 모든 검색에 실패했습니다. 기존 파일을 유지합니다.");
    process.exit(prev.length ? 0 : 1);
  }

  // 새로 찾은 것 + 예전 것(기간 안) → 중복 제거 → 최신순
  const since = Date.now() - KEEP_DAYS * 86400000;
  const seenLink = new Set(), seenTitle = new Set();
  const list = [...found, ...prev].filter((n) => {
    const t = n.date ? Date.parse(n.date) : Date.now();
    if (t < since) return false;
    const k = n.title.replace(/[\s\-–—|:"'«»]+/g, "").slice(0, 50);
    if (seenLink.has(n.link) || seenTitle.has(k)) return false;
    seenLink.add(n.link); seenTitle.add(k);
    return true;
  }).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, MAX_ITEMS);

  let translated = 0, bodies = 0;
  const tkey = (t) => String(t || "").replace(/[\s\-–—|:"'«»]+/g, "").slice(0, 50);
  const prevByLink = new Map(prev.map((n) => [n.link, n]));
  const prevByTitle = new Map(prev.map((n) => [tkey(n.title), n]));
  for (const n of list) {
    delete n._desc;
    const old = prevByLink.get(n.link) || prevByTitle.get(tkey(n.title)) || {};
    if (n.lang === "ko") n.titleKo = n.title;
    else {
      n.titleKo = n.titleKo || old.titleKo || prevKo.get(n.link) || "";
      if (!n.titleKo) {
        n.titleKo = await translate(n.title, n.lang);
        if (n.titleKo) translated++;
        await sleep(350);
      }
    }
    // 본문 미리보기: 예전에 가져온 게 있으면 그대로, 없으면 이번에 가져온다 (한 번에 최대 BODY_PER_RUN건)
    const tidy = (t) => decodeEntities(t || "").replace(/&#\d*;?/g, " ").replace(/[ \t]+/g, " ").trim();
    if (old.body !== undefined && old.tried) { n.url = old.url; n.body = tidy(old.body); n.bodyKo = tidy(old.bodyKo); n.tried = true; continue; }
    if (bodies >= BODY_PER_RUN) continue;
    bodies++;
    n.url = await resolveGoogle(n.link);
    n.body = n.url !== n.link || !/news\.google\.com/.test(n.url) ? await articleText(n.url) : "";
    n.bodyKo = n.body ? (n.lang === "ko" ? n.body : await translateLong(n.body, n.lang)) : "";
    n.bodyKo = decodeEntities(n.bodyKo).replace(/&#\d*;?/g, " ");
    n.tried = true;
    console.log(`  본문 ${n.body ? n.body.length + "자" : "못 가져옴"} · ${n.url.slice(0, 80)}`);
    await sleep(500);
  }
  // 자동 번역이 자주 틀리는 낱말 바로잡기 (예: plague → '전염병'이 아니라 '페스트')
  const FIX = [[/plague/i, /전염병|흑사병/g, "페스트"]];
  list.forEach((n) => FIX.forEach(([src, bad, good]) => {
    if (n.lang !== "ko" && src.test(n.title) && n.titleKo && !n.titleKo.includes(good)) n.titleKo = n.titleKo.replace(bad, good);
  }));
  // 바꾼 낱말 뒤 조사 맞추기 (페스트은 → 페스트는, 페스트으로 → 페스트로 …)
  list.forEach((n) => { if (n.titleKo) n.titleKo = n.titleKo.replace(/페스트은/g, "페스트는").replace(/페스트으로/g, "페스트로").replace(/페스트을/g, "페스트를").replace(/페스트과/g, "페스트와").replace(/페스트이(?=[\s,.]|$)/g, "페스트가"); });
  // 바로 가는 원문 주소가 있으면 그걸 링크로 쓴다
  list.forEach((n) => { if (n.url && !/news\.google\.com/.test(n.url)) n.link = n.url; });

  const out = { generatedAt: new Date().toISOString(), items: list };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf-8");
  const by = (l) => list.filter((n) => n.lang === l).length;
  console.log(`저장 완료: 총 ${list.length}건 (한국어 ${by("ko")} · 아랍어 ${by("ar")} · 영어 ${by("en")}) · 새로 번역 ${translated}건 · 본문 있음 ${list.filter((n) => n.body).length}건`);
}

main().catch((err) => { console.error(err); process.exit(1); });
