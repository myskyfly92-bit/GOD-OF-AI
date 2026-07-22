"""
이라크 보건부(MOH) 관련 최신 뉴스를 Google News RSS에서 가져와
한국어로 번역한 뒤 news.json 파일로 저장합니다.

GitHub Actions(.github/workflows/update-news.yml)가 이 스크립트를
매일 자동 실행하고, 변경된 news.json을 저장소에 커밋합니다.

로컬에서 수동 실행:
    pip install requests feedparser deep-translator
    python scripts/fetch_iraq_moh_news.py
"""

import json
import re
import sys
from datetime import datetime, timezone

import feedparser
import requests
from deep_translator import GoogleTranslator

# 검색어를 바꾸고 싶으면 이 부분만 수정하면 됩니다.
# when:14d = 최근 14일 이내 뉴스만 수집
SEARCH_QUERY = '"Ministry of Health" Iraq when:14d'
RSS_URL = f"https://news.google.com/rss/search?q={requests.utils.quote(SEARCH_QUERY)}&hl=en-US&gl=US&ceid=US:en"

MAX_ITEMS = 6
OUTPUT_PATH = "news.json"


def fetch_feed():
    headers = {"User-Agent": "Mozilla/5.0 (compatible; BismayahSHEBot/1.0)"}
    resp = requests.get(RSS_URL, headers=headers, timeout=20)
    resp.raise_for_status()
    return feedparser.parse(resp.content)


def clean_html(raw_html):
    """Google News RSS의 summary 필드에 섞인 HTML 태그를 제거합니다."""
    text = re.sub(r"<[^<]+?>", "", raw_html or "")
    return text.strip()


def translate_text(text, translator):
    if not text:
        return ""
    try:
        return translator.translate(text[:4500])
    except Exception as exc:  # 번역 실패 시 원문이라도 남긴다
        print(f"[경고] 번역 실패, 원문 유지: {exc}", file=sys.stderr)
        return text


def main():
    feed = fetch_feed()
    translator = GoogleTranslator(source="en", target="ko")

    items = []
    for entry in feed.entries[:MAX_ITEMS]:
        title_en = (entry.get("title") or "").strip()
        summary_en = clean_html(entry.get("summary", ""))
        source = None
        if entry.get("source"):
            source = entry["source"].get("title")

        items.append(
            {
                "title_ko": translate_text(title_en, translator),
                "title_en": title_en,
                "summary_ko": translate_text(summary_en, translator),
                "link": entry.get("link", ""),
                "source": source or "Google News",
                "published": entry.get("published", ""),
            }
        )

    output = {
        "_readme": "이 파일은 GitHub Actions가 자동으로 생성/갱신합니다. 직접 수정해도 다음 실행 때 덮어써집니다.",
        "query": SEARCH_QUERY,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "items": items,
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"{len(items)}건의 뉴스를 저장했습니다 → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
