"""
외교부 공공데이터포털 API("외교부_국가·지역별 안전공지")를 통해
이라크 관련 최신 안전공지를 가져와 embassy-notices.json 파일로 저장합니다.

사전 준비:
1. https://www.data.go.kr 에서 "외교부_국가·지역별 안전공지" 검색 → 활용신청 (무료, 자동승인)
2. 발급받은 서비스키(인증키)를 저장소 Settings > Secrets and variables > Actions 에
   이름 MOFA_API_KEY 로 등록

로컬 실행:
    pip install requests
    MOFA_API_KEY=발급받은키 python scripts/fetch_embassy_notices.py
"""

import json
import os
import sys
from datetime import datetime, timezone

import requests

API_URL = "http://apis.data.go.kr/1262000/CountrySafetyService3/getCountrySafetyList3"
COUNTRY_NM = "이라크"
MAX_ITEMS = 8
OUTPUT_PATH = "embassy-notices.json"


def fetch():
    service_key = os.environ.get("MOFA_API_KEY")
    if not service_key:
        print("[오류] 환경변수 MOFA_API_KEY가 설정되지 않았습니다.", file=sys.stderr)
        sys.exit(1)

    params = {
        "serviceKey": service_key,
        "country_nm": COUNTRY_NM,
        "type": "json",
        "numOfRows": MAX_ITEMS,
        "pageNo": 1,
    }
    resp = requests.get(API_URL, params=params, timeout=20)
    resp.raise_for_status()
    return resp.json()


def extract_items(data):
    """공공데이터포털의 흔한 응답 구조(response > body > items > item)를 순서대로 탐색합니다."""
    try:
        body = data.get("response", {}).get("body", {})
        items = body.get("items")
        if isinstance(items, dict):
            items = items.get("item", [])
        if items is None:
            items = []
        if isinstance(items, dict):
            items = [items]
        return items
    except AttributeError:
        return []


def field(item, *keys, default=""):
    for k in keys:
        if k in item and item[k]:
            return item[k]
    return default


def main():
    raw = fetch()
    items = extract_items(raw)

    if not items:
        print("[경고] 응답에서 안전공지 항목을 찾지 못했습니다. 원본 응답을 디버그 파일로 저장합니다.", file=sys.stderr)
        with open("embassy-notices-raw-debug.json", "w", encoding="utf-8") as f:
            json.dump(raw, f, ensure_ascii=False, indent=2)

    notices = []
    for item in items[:MAX_ITEMS]:
        notices.append({
            "title": field(item, "title", "제목"),
            "body": field(item, "content", "내용", "안전공지내용"),
            "date": field(item, "wrt_dt", "등록일", "regDt"),
            "country": field(item, "country_nm", "국가명", default=COUNTRY_NM),
        })

    output = {
        "_readme": "이 파일은 GitHub Actions가 외교부 공공데이터 API로 자동 생성/갱신합니다. 직접 수정하지 마세요.",
        "country": COUNTRY_NM,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "items": notices,
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"{len(notices)}건의 안전공지를 저장했습니다 → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
