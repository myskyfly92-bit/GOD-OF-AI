"""
질병관리청_온열질환 감시 데이터(공공데이터포털 api.odcloud.kr)를 가져와
이번 시즌(올해) 누적 건수와 지역별 현황을 domestic-heat-illness.json으로 저장합니다.

사용 인증키: 기존에 등록해둔 MOFA_API_KEY 시크릿을 그대로 재사용합니다
(공공데이터포털은 계정당 인증키가 하나라 API마다 새로 등록할 필요가 없습니다).

로컬 실행:
    pip install requests
    MOFA_API_KEY=발급받은키 python scripts/fetch_domestic_heat_illness.py
"""

import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone

import requests

BASE_URL = "https://api.odcloud.kr/api/15149889/v1/uddi:e07385ab-590c-42bb-972d-cf2c9d24bc2e"
PER_PAGE = 1000
MAX_PAGES = 30  # 안전장치 (무한루프 방지)
OUTPUT_PATH = "domestic-heat-illness.json"


def fetch_all(service_key):
    url = f"{BASE_URL}?serviceKey={service_key}"
    all_items = []
    page = 1
    while page <= MAX_PAGES:
        params = {"page": page, "perPage": PER_PAGE, "returnType": "JSON"}
        resp = requests.get(url, params=params, timeout=30)
        if resp.status_code != 200:
            print(f"[오류] API 응답 코드: {resp.status_code}", file=sys.stderr)
            print(f"[오류] API 응답 본문: {resp.text[:1500]}", file=sys.stderr)
        resp.raise_for_status()
        payload = resp.json()
        data = payload.get("data", [])
        all_items.extend(data)

        total = payload.get("totalCount", 0)
        if not data or page * PER_PAGE >= total:
            break
        page += 1
    return all_items


def main():
    service_key = os.environ.get("MOFA_API_KEY")
    if not service_key:
        print("[오류] 환경변수 MOFA_API_KEY가 설정되지 않았습니다.", file=sys.stderr)
        sys.exit(1)

    items = fetch_all(service_key)
    print(f"[진단] API에서 가져온 전체 원본 건수: {len(items)}건", file=sys.stderr)
    if items:
        print(f"[진단] 첫 번째 항목 샘플: {items[0]}", file=sys.stderr)
        years_seen = sorted(set(str(it.get("발생일자", ""))[:4] for it in items))
        print(f"[진단] 데이터에 존재하는 연도 목록: {years_seen}", file=sys.stderr)

    this_year = str(datetime.now().year)
    season_items = [it for it in items if str(it.get("발생일자", "")).startswith(this_year)]

    region_counter = Counter()
    latest_date = ""
    for it in season_items:
        region = it.get("발생시도") or "미상"
        region_counter[region] += 1
        d = str(it.get("발생일자", ""))
        if d > latest_date:
            latest_date = d

    by_region = [{"region": r, "count": c} for r, c in region_counter.most_common(8)]

    output = {
        "_readme": "이 파일은 GitHub Actions가 질병관리청 온열질환 감시 데이터 API로 자동 생성/갱신합니다. 직접 수정하지 마세요.",
        "year": this_year,
        "totalCount": len(season_items),
        "latestDate": latest_date,
        "byRegion": by_region,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"{this_year}년 누적 {len(season_items)}건 집계 완료 → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
