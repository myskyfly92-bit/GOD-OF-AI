"""
세계보건기구(WHO) 공식 API를 통해 전 세계 감염병 발생 정보(Disease Outbreak News)를
가져와 who-outbreaks.json 파일로 저장합니다.

이 API는 WHO가 공개적으로 제공하는 것으로, 별도 인증키가 필요 없습니다.

로컬 실행:
    pip install requests
    python scripts/fetch_who_outbreaks.py
"""

import json
import sys
from datetime import datetime, timezone

import requests

API_URL = "https://www.who.int/api/news/diseaseoutbreaknews"
MAX_ITEMS = 10
OUTPUT_PATH = "who-outbreaks.json"


def fetch():
    headers = {"User-Agent": "Mozilla/5.0 (compatible; BismayahSHEBot/1.0)"}
    # $orderby/$top이 서버에서 무시되더라도, 아래에서 클라이언트 측 정렬로 한 번 더 보정합니다.
    params = {"$orderby": "PublicationDate desc", "$top": MAX_ITEMS * 3}
    resp = requests.get(API_URL, headers=headers, params=params, timeout=30)
    if resp.status_code != 200:
        print(f"[오류] API 응답 코드: {resp.status_code}", file=sys.stderr)
        print(f"[오류] API 응답 본문: {resp.text[:1500]}", file=sys.stderr)
    resp.raise_for_status()
    return resp.json()


def clean_text(raw, limit=500):
    if not raw:
        return ""
    text = str(raw).strip()
    return text[:limit]


def main():
    raw = fetch()
    items = raw if isinstance(raw, list) else raw.get("value", [])

    # PublicationDate 기준 최신순 정렬 (서버가 정렬을 무시했을 경우 대비)
    def pub_date(it):
        return it.get("PublicationDate") or ""

    items.sort(key=pub_date, reverse=True)
    items = items[:MAX_ITEMS]

    outbreaks = []
    for it in items:
        item_url = it.get("ItemDefaultUrl") or ""
        if item_url and item_url.startswith("/"):
            item_url = "https://www.who.int" + item_url

        outbreaks.append({
            "title": clean_text(it.get("Title"), 200),
            "date": clean_text(it.get("PublicationDate"), 30),
            "summary": clean_text(it.get("Summary") or it.get("Overview")),
            "link": item_url,
            "donId": clean_text(it.get("DonId"), 50),
        })

    output = {
        "_readme": "이 파일은 GitHub Actions가 WHO 공식 API로 자동 생성/갱신합니다. 직접 수정하지 마세요.",
        "source": "World Health Organization - Disease Outbreak News",
        "items": outbreaks,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"{len(outbreaks)}건의 WHO 감염병 발생 정보를 저장했습니다 → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
