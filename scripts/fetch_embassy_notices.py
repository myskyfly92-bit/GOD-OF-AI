"""
외교부 공공데이터포털 API("외교부_국가·지역별 안전공지")를 통해
중동·주변국 대사관의 최신 안전공지를 모아 embassy-notices.json 파일로 저장합니다.
(나라별로 따로 조회한 뒤 날짜순으로 합칩니다)

사전 준비:
1. https://www.data.go.kr 에서 "외교부_국가·지역별 안전공지" 검색 → 활용신청 (무료, 자동승인)
2. 발급받은 서비스키(인증키)를 저장소 Settings > Secrets and variables > Actions 에
   이름 MOFA_API_KEY 로 등록

로컬 실행:
    pip install requests
    MOFA_API_KEY=발급받은키 python scripts/fetch_embassy_notices.py
"""

import html
import json
import re
import os
import sys
from datetime import datetime, timezone

import requests

API_URL = "https://apis.data.go.kr/1262000/CountrySafetyService6/getCountrySafetyList6"
# 중동·주변국 (v6 API는 한글 국가명 기준으로 필터링됨)
COUNTRIES = [
    ("IQ", "이라크"), ("IR", "이란"), ("SY", "시리아"), ("JO", "요르단"), ("SA", "사우디아라비아"),
    ("KW", "쿠웨이트"), ("TR", "튀르키예"), ("LB", "레바논"), ("IL", "이스라엘"), ("PS", "팔레스타인"),
    ("EG", "이집트"), ("AE", "아랍에미리트"), ("QA", "카타르"), ("BH", "바레인"), ("OM", "오만"), ("YE", "예멘"),
]
COUNTRY_NM = "이라크"
PER_COUNTRY = 8   # 나라별 최근 공지 수
MAX_ITEMS = 120   # 전체 최대
FETCH_ROWS = 100  # 국가 필터가 완벽하지 않을 수 있어 넉넉히 가져온 뒤 해당 나라만 추려냅니다.
OUTPUT_PATH = "embassy-notices.json"


def fetch(country_nm=COUNTRY_NM):
    service_key = os.environ.get("MOFA_API_KEY")
    if not service_key:
        print("[오류] 환경변수 MOFA_API_KEY가 설정되지 않았습니다.", file=sys.stderr)
        sys.exit(1)

    # requests가 인증키를 다시 URL 인코딩하면서 깨뜨리는 문제를 피하기 위해
    # serviceKey는 URL에 직접 넣고, 나머지 파라미터만 requests에 맡깁니다.
    url = f"{API_URL}?serviceKey={service_key}"
    params = {
        "country_nm": country_nm,
        "type": "json",
        "numOfRows": FETCH_ROWS,
        "pageNo": 1,
    }
    resp = requests.get(url, params=params, timeout=20)
    if resp.status_code != 200:
        print(f"[오류] API 응답 코드: {resp.status_code}", file=sys.stderr)
        print(f"[오류] API 응답 본문: {resp.text[:2000]}", file=sys.stderr)
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


def clean_body(raw):
    """txt_origin_cn 필드는 이중 HTML 인코딩된 서식 텍스트라 태그/엔티티를 제거해 읽기 좋게 만듭니다."""
    if not raw:
        return ""
    text = html.unescape(html.unescape(str(raw)))  # 이중 인코딩 해제
    text = re.sub(r"<[^<]+?>", " ", text)  # 태그 제거
    text = re.sub(r"\s+", " ", text).strip()
    return text[:3000]  # 클릭하면 펼쳐볼 수 있으므로 넉넉하게 보존


def date_key(d):
    """'2026-10-01', '2026.10.01', '20261001' 등 여러 형식을 정렬할 수 있게 숫자만 남긴다"""
    return re.sub(r"[^0-9]", "", str(d or ""))[:14]


def main():
    notices, counts = [], []
    for iso2, name in COUNTRIES:
        try:
            raw = fetch(name)
        except Exception as e:
            print(f"[경고] {name} 조회 실패: {e}", file=sys.stderr)
            continue
        items = extract_items(raw)
        mine = [it for it in items if field(it, "country_nm") == name or field(it, "country_iso_alp2") == iso2]
        mine.sort(key=lambda it: date_key(field(it, "wrt_dt", "등록일", "regDt")), reverse=True)
        for item in mine[:PER_COUNTRY]:
            notices.append({
                "title": field(item, "title", "제목"),
                "body": clean_body(field(item, "txt_origin_cn", "content", "내용")),
                "date": field(item, "wrt_dt", "등록일", "regDt"),
                "country": name,
                "iso2": iso2,
            })
        counts.append({"iso2": iso2, "name": name, "count": min(len(mine), PER_COUNTRY)})
        print(f"{name}: {len(mine)}건 (저장 {min(len(mine), PER_COUNTRY)}건)")

    if not counts:
        print("[오류] 어느 나라도 조회하지 못했습니다. 기존 파일을 유지합니다.", file=sys.stderr)
        sys.exit(1)

    notices.sort(key=lambda n: date_key(n["date"]), reverse=True)
    output = {
        "_readme": "이 파일은 GitHub Actions가 외교부 공공데이터 API로 자동 생성/갱신합니다. 직접 수정하지 마세요.",
        "country": "중동·주변국",
        "countries": counts,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "items": notices[:MAX_ITEMS],
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"{len(output['items'])}건의 안전공지를 저장했습니다 ({len(counts)}개국) → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
