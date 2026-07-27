"""
한국산업안전보건공단(KOSHA)_건설업 일별 중대재해 현황 API를 통해
전국 건설현장에서 오늘 발생 보고된 중대재해를 가져와
daily-disaster.json 파일로 저장합니다.

사용 인증키: 기존 MOFA_API_KEY 시크릿을 그대로 재사용합니다.

로컬 실행:
    pip install requests
    MOFA_API_KEY=발급받은키 python scripts/fetch_daily_disaster.py
"""

import json
import os
import sys
from datetime import datetime, timezone, timedelta

import requests

API_URL = "https://apis.data.go.kr/B552468/constDsstr01/getconstDsstr01"
OUTPUT_PATH = "daily-disaster.json"
KST = timezone(timedelta(hours=9))  # 한국 표준시 기준으로 날짜를 계산합니다.


def fetch(service_key, dsstr_dy):
    url = f"{API_URL}?serviceKey={service_key}"
    params = {
        "dsstrDy": dsstr_dy,
        "callApiId": "1010",
        "pageNo": 1,
        "numOfRows": 50,
    }
    resp = requests.get(url, params=params, timeout=20)
    if resp.status_code != 200:
        print(f"[오류] API 응답 코드: {resp.status_code}", file=sys.stderr)
        print(f"[오류] API 응답 본문: {resp.text[:1500]}", file=sys.stderr)
    resp.raise_for_status()
    return resp.json()


def field(item, key, default=""):
    return item.get(key) or default


def main():
    service_key = os.environ.get("MOFA_API_KEY")
    if not service_key:
        print("[오류] 환경변수 MOFA_API_KEY가 설정되지 않았습니다.", file=sys.stderr)
        sys.exit(1)

    today_kst = datetime.now(KST).strftime("%Y%m%d")
    raw = fetch(service_key, today_kst)

    body = raw.get("body", {})
    total_count = body.get("totalCount", 0)
    items_wrapper = body.get("items") or {}
    raw_items = items_wrapper.get("item") or []
    if isinstance(raw_items, dict):  # 결과가 1건이면 리스트가 아니라 객체로 오는 경우 대비
        raw_items = [raw_items]

    incidents = []
    for it in raw_items:
        incidents.append({
            "jobProcess": field(it, "jobPrcsNm"),
            "detailProcess": field(it, "dtlJobPrcsNm"),
            "location": field(it, "ocmtNm"),
            "type": field(it, "dsstrKndNm"),
            "detail": field(it, "dsstrDtlCn"),
            "prevention": field(it, "rsknsDcrsMsrsCn"),
        })

    output = {
        "_readme": "이 파일은 GitHub Actions가 한국산업안전보건공단 API로 자동 생성/갱신합니다. 직접 수정하지 마세요.",
        "date": today_kst,
        "totalCount": total_count,
        "incidents": incidents,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"{today_kst} 기준 전국 건설업 중대재해 {total_count}건 저장 완료 → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
