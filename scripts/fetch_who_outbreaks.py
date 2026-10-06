"""
세계보건기구(WHO) 소식을 모아 who-outbreaks.json 파일로 저장합니다. (인증키 필요 없음)

1) 감염병 발생 정보 (Disease Outbreak News) — https://www.who.int/api/news/diseaseoutbreaknews
2) WHO 최신 소식 (보도자료·성명·뉴스) — https://www.who.int/api/news/newsitems
   (API가 안 되면 WHO 공식 RSS https://www.who.int/rss-feeds/news-english.xml 로 받음)

감염병 소식은 몇 주에 한 번씩만 올라와서, 최신 소식을 함께 넣어 화면이 비지 않게 합니다.
한국어 번역은 Apps Script(updateWhoKo)가 이 파일의 link 기준으로 자동으로 해 둡니다.

로컬 실행:
    pip install requests
    python scripts/fetch_who_outbreaks.py
"""

import html
import json
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import requests

DON_API = "https://www.who.int/api/news/diseaseoutbreaknews"
NEWS_API = "https://www.who.int/api/news/newsitems"
NEWS_RSS = "https://www.who.int/rss-feeds/news-english.xml"
MAX_DON = 10
MAX_NEWS = 15
OUTPUT_PATH = "who-outbreaks.json"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; BismayahSHEBot/1.0)"}


def clean_text(raw, limit=500):
    if not raw:
        return ""
    t = html.unescape(str(raw))
    t = re.sub(r"<[^<]+?>", " ", t)
    return re.sub(r"\s+", " ", t).strip()[:limit]


def full_url(u):
    u = str(u or "").strip()
    if u.startswith("/"):
        u = "https://www.who.int" + u
    return u


def pick(it, *keys):
    for k in keys:
        v = it.get(k)
        if v not in (None, ""):
            return v
    return ""


# ---------- 1) 감염병 발생 정보 ----------
def fetch_don():
    params = {"$orderby": "PublicationDate desc", "$top": MAX_DON * 3}
    r = requests.get(DON_API, headers=HEADERS, params=params, timeout=30)
    if r.status_code != 200:
        print(f"[오류] DON API 응답 {r.status_code}: {r.text[:500]}", file=sys.stderr)
    r.raise_for_status()
    raw = r.json()
    items = raw if isinstance(raw, list) else raw.get("value", [])
    items.sort(key=lambda it: it.get("PublicationDate") or "", reverse=True)
    out = []
    for it in items[:MAX_DON]:
        out.append({
            "kind": "감염병 발생",
            "title": clean_text(it.get("Title"), 200),
            "date": clean_text(it.get("PublicationDate"), 30),
            "summary": clean_text(it.get("Summary") or it.get("Overview")),
            "link": full_url(it.get("ItemDefaultUrl")),
            "donId": clean_text(it.get("DonId"), 50),
        })
    return out


# ---------- 2) WHO 최신 소식 ----------
def fetch_news_api():
    params = {"$orderby": "PublicationDateAndTime desc", "$top": MAX_NEWS * 2}
    r = requests.get(NEWS_API, headers=HEADERS, params=params, timeout=30)
    r.raise_for_status()
    raw = r.json()
    items = raw if isinstance(raw, list) else raw.get("value", [])
    if items:
        print("[WHO 소식] API 필드:", sorted(items[0].keys())[:40])
    out = []
    for it in items:
        title = clean_text(pick(it, "Title", "title"), 200)
        raw_url = str(pick(it, "ItemDefaultUrl", "Url", "url") or "").strip()
        # 뉴스 API의 주소는 '/06-10-2026-제목' 처럼 와서 앞에 /news/item 을 붙여야 실제 페이지가 열린다
        if raw_url.startswith("http"):
            link = raw_url
        elif raw_url:
            link = "https://www.who.int" + ("" if raw_url.startswith("/news/") else "/news/item") + ("" if raw_url.startswith("/") else "/") + raw_url
        else:
            link = ""
        date = clean_text(pick(it, "PublicationDateAndTime", "PublicationDate", "FormatedDate"), 30)
        if not title or not link:
            continue
        out.append({
            "kind": "WHO 소식",
            "title": title,
            "date": date,
            "summary": clean_text(pick(it, "Summary", "Description", "Overview", "Lead")),
            "link": link,
            "newsType": clean_text(pick(it, "NewsType", "NewsTypeName"), 40),
        })
    return out


def fetch_news_rss():
    r = requests.get(NEWS_RSS, headers=HEADERS, timeout=30)
    r.raise_for_status()
    root = ET.fromstring(r.content)
    out = []
    for it in root.iter("item"):
        title = clean_text(it.findtext("title"), 200)
        link = (it.findtext("link") or "").strip()
        d = it.findtext("pubDate") or ""
        try:
            date = parsedate_to_datetime(d).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except (TypeError, ValueError):
            date = d[:30]
        if title and link:
            out.append({"kind": "WHO 소식", "title": title, "date": date,
                        "summary": clean_text(it.findtext("description")), "link": link})
    return out


def page_summary(url):
    """요약이 비어 있으면 기사 페이지의 소개 문구(og:description / description)를 가져온다"""
    try:
        r = requests.get(url, headers=HEADERS, timeout=20)
        if r.status_code != 200:
            return ""
        h = r.text
        for pat in (r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']+)',
                    r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:description',
                    r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)'):
            m = re.search(pat, h, re.I)
            if m and len(m.group(1).strip()) > 20:
                return clean_text(m.group(1))
        # 소개 문구가 없으면 본문 첫 문단
        m = re.search(r'<article[\s\S]*?<p[^>]*>([\s\S]{40,1200}?)</p>', h, re.I)
        return clean_text(m.group(1)) if m else ""
    except Exception as e:
        print(f"  요약 받기 실패 {url}: {e}", file=sys.stderr)
        return ""


def fill_summaries(news):
    # 이전에 받아 둔 요약은 다시 받지 않는다
    old = {}
    try:
        for n in json.load(open(OUTPUT_PATH, encoding="utf-8")).get("items", []):
            if n.get("summary"):
                old[n.get("link")] = n["summary"]
    except Exception:
        pass
    got = 0
    for n in news:
        if n.get("summary"):
            continue
        n["summary"] = old.get(n["link"]) or page_summary(n["link"])
        got += 1 if n["summary"] else 0
    print(f"[WHO 소식] 요약 채움 {got}건")


def fetch_news():
    err = "자료 없음"
    for name, fn in (("API", fetch_news_api), ("RSS", fetch_news_rss)):
        try:
            got = fn()
            if got:
                print(f"[WHO 소식] {name}로 {len(got)}건")
                got.sort(key=lambda n: n["date"] or "", reverse=True)
                return got[:MAX_NEWS], None
            print(f"[WHO 소식] {name}: 0건")
            err = f"{name}: 0건"
        except Exception as e:
            print(f"[WHO 소식] {name} 실패: {e}", file=sys.stderr)
            err = f"{name}: {str(e)[:200]}"
    return [], err


def main():
    errors = {}
    try:
        don = fetch_don()
    except Exception as e:
        don, errors["감염병 발생"] = [], str(e)[:300]
    news, nerr = fetch_news()
    fill_summaries(news)
    if nerr and not news:
        errors["WHO 소식"] = nerr

    if not don and not news:
        print("[오류] WHO 자료를 하나도 받지 못했습니다. 기존 파일을 유지합니다.", file=sys.stderr)
        sys.exit(1)

    # 같은 링크는 한 번만, 날짜 최신순
    seen, items = set(), []
    for n in sorted(don + news, key=lambda n: n["date"] or "", reverse=True):
        if n["link"] in seen:
            continue
        seen.add(n["link"])
        items.append(n)

    output = {
        "_readme": "이 파일은 GitHub Actions가 WHO 공식 API로 자동 생성/갱신합니다. 직접 수정하지 마세요.",
        "source": "World Health Organization - Disease Outbreak News + Newsroom",
        "counts": {"감염병 발생": len(don), "WHO 소식": len(news)},
        "errors": errors,
        "items": items,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"감염병 발생 {len(don)}건 + WHO 소식 {len(news)}건 저장 → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
