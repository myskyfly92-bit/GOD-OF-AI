"""
한국산업안전보건공단(KOSHA)_건설업 일별 중대재해 현황 API를 통해
올해 1월 1일부터 오늘까지 매일 조회하여 누적 현황을 daily-disaster.json으로 저장합니다.

이 API는 '하루 단위'로만 조회할 수 있어서, 연초부터 오늘까지 날짜별로
반복 호출한 뒤 합산합니다 (일일 트래픽 한도 1000건 이내로 충분히 여유 있음).

사용 인증키: 기존 MOFA_API_KEY 시크릿을 그대로 재사용합니다.

로컬 실행:
    pip install requests
    MOFA_API_KEY=발급받은키 python scripts/fetch_daily_disaster.py
"""

import json
import os
import sys
import time
from collections import Counter
from datetime import datetime, timezone, timedelta

import requests

API_URL = "https://apis.data.go.kr/B552468/constDsstr01/getconstDsstr01"
OUTPUT_PATH = "daily-disaster.json"
KST = timezone(timedelta(hours=9))  # 한국 표준시 기준으로 날짜를 계산합니다.
RECENT_LIMIT = 12  # 최근 사고 목록으로 화면에 보여줄 최대 건수


def fetch_one_day(service_key, dsstr_dy):
    url = f"{API_URL}?serviceKey={service_key}"
    params = {
        "dsstrDy": dsstr_dy,
        "callApiId": "1010",
        "pageNo": 1,
        "numOfRows": 50,
    }
    resp = requests.get(url, params=params, timeout=20)
    if resp.status_code != 200:
        print(f"[경고] {dsstr_dy} 조회 실패 (코드 {resp.status_code})", file=sys.stderr)
        return []
    try:
        raw = resp.json()
    except ValueError:
        print(f"[경고] {dsstr_dy} 응답이 JSON이 아님", file=sys.stderr)
        return []

    body = raw.get("body", {})
    items_wrapper = body.get("items") or {}
    raw_items = items_wrapper.get("item") or []
    if isinstance(raw_items, dict):
        raw_items = [raw_items]
    return raw_items


def field(item, key, default=""):
    return item.get(key) or default


def daterange(start_date, end_date):
    days = (end_date - start_date).days
    for i in range(days + 1):
        yield start_date + timedelta(days=i)


def main():
    service_key = os.environ.get("MOFA_API_KEY")
    if not service_key:
        print("[오류] 환경변수 MOFA_API_KEY가 설정되지 않았습니다.", file=sys.stderr)
        sys.exit(1)

    now_kst = datetime.now(KST)
    year = now_kst.year
    start_date = datetime(year, 1, 1, tzinfo=KST).date()
    end_date = now_kst.date()

    all_incidents = []
    type_counter = Counter()
    days_checked = 0

    for d in daterange(start_date, end_date):
        d_str = d.strftime("%Y%m%d")
        raw_items = fetch_one_day(service_key, d_str)
        days_checked += 1
        for it in raw_items:
            incident_type = field(it, "dsstrKndNm", "기타")
            type_counter[incident_type] += 1
            all_incidents.append({
                "date": d_str,
                "jobProcess": field(it, "jobPrcsNm"),
                "detailProcess": field(it, "dtlJobPrcsNm"),
                "location": field(it, "ocmtNm"),
                "type": incident_type,
                "detail": field(it, "dsstrDtlCn"),
                "prevention": field(it, "rsknsDcrsMsrsCn"),
            })
        time.sleep(0.05)  # API 서버 부담을 줄이기 위한 짧은 간격

    all_incidents.sort(key=lambda x: x["date"], reverse=True)
    by_type = [{"type": t, "count": c} for t, c in type_counter.most_common()]

    output = {
        "_readme": "이 파일은 GitHub Actions가 한국산업안전보건공단 API로 자동 생성/갱신합니다. 직접 수정하지 마세요.",
        "year": str(year),
        "daysChecked": days_checked,
        "totalCount": len(all_incidents),
        "byType": by_type,
        "recentIncidents": all_incidents[:RECENT_LIMIT],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"{year}년 누적 (총 {days_checked}일 조회) 중대재해 {len(all_incidents)}건 저장 완료 → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
