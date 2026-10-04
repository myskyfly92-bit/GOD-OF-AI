"""
한국산업안전보건공단_국내재해사례 게시판 정보 조회서비스에서
최신 재해사례를 받아 '건설업'만 골라 kosha-cases.json으로 저장합니다.
(안전 > 사고사례 탭의 '타사 사고사례'에 표시)

참고: 설명서상 business(게시판 종류) 조건이 있지만 실제 서버는 이 조건을
무시하고 전체 목록을 돌려줍니다. 그래서 최신순으로 여러 페이지를 받은 뒤
여기서 직접 '건설업'만 골라냅니다.

- 인증키: 이 API를 활용신청한 계정의 키를 KOSHA_API_KEY 시크릿으로 등록합니다.
  (공공데이터포털은 API마다 활용신청한 계정의 키만 통과시키고, 다른 계정 키는 403으로 막습니다.
   KOSHA_API_KEY가 없으면 MOFA_API_KEY로 시도합니다.)
- callApiId: 1060 (설명서의 필수 고정값)

로컬 실행:
    pip install requests
    KOSHA_API_KEY=발급받은키 python scripts/fetch_kosha_cases.py
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timezone

import requests

ENDPOINTS = [
    "https://apis.data.go.kr/B552468/disaster_api02/getdisaster_api02",
    "http://apis.data.go.kr/B552468/disaster_api02/getdisaster_api02",  # 설명서 원래 주소
]
OUTPUT_PATH = "kosha-cases.json"
TARGET_BUSINESS = "건설업"
ROWS_PER_PAGE = 100
MAX_PAGES = 3          # 최신 300건까지 훑기 (건설업 약 150건)
MAX_ITEMS = 120        # 화면에 남길 최대 건수

# 제목 끝말로 재해 유형을 분류합니다 (앞에 있는 것이 우선).
TYPE_RULES = [
    ("감전", ["감전"]),
    ("질식", ["질식"]),
    ("화재·폭발", ["화재", "폭발"]),
    ("매몰·붕괴", ["매몰", "붕괴", "무너"]),
    ("떨어짐", ["추락", "떨어짐", "떨어져"]),
    ("끼임", ["끼임", "끼인", "말림"]),
    ("깔림", ["깔림"]),
    ("맞음", ["맞음", "낙하", "부딪힘"]),
]


def classify(title, contents):
    text = f"{title} {contents}"
    for label, words in TYPE_RULES:
        if any(w in title for w in words):
            return label
    for label, words in TYPE_RULES:
        if any(w in text for w in words):
            return label
    return "기타"


def registered_at(boardno):
    """boardno 앞 14자리(YYYYMMDDHHMMSS)가 게시판 등록 일시입니다."""
    m = re.match(r"(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})", boardno or "")
    if not m:
        return ""
    y, mo, d, h, mi = m.groups()
    return f"{y}-{mo}-{d} {h}:{mi}"


def clean(text):
    text = (text or "").replace("\u00a0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text.lstrip("‘'").strip()


def fetch_page(key, page):
    last_err = None
    for base in ENDPOINTS:
        url = f"{base}?serviceKey={key}"
        params = {"callApiId": "1060", "pageNo": page, "numOfRows": ROWS_PER_PAGE}
        try:
            resp = requests.get(url, params=params, timeout=30)
        except Exception as e:  # 연결 실패 → 다음 주소로
            last_err = e
            continue
        if resp.status_code != 200:
            last_err = f"HTTP {resp.status_code} ({base.split(':')[0]}) 응답: {resp.text[:200]!r}"
            print(f"[경고] {last_err}", file=sys.stderr)
            continue
        try:
            data = resp.json()
        except ValueError:
            last_err = f"JSON이 아닌 응답: {resp.text[:200]!r}"
            print(f"[경고] {last_err}", file=sys.stderr)
            continue
        header = data.get("header", {})
        if header.get("resultCode") != "00":
            raise RuntimeError(f"API 오류: {header.get('resultCode')} {header.get('resultMsg')}")
        body = data.get("body", {})
        items = (body.get("items") or {}).get("item") or []
        if isinstance(items, dict):
            items = [items]
        return items, int(body.get("totalCount") or 0)
    raise RuntimeError(f"모든 주소 호출 실패: {last_err}")


def main():
    key = (os.environ.get("KOSHA_API_KEY") or os.environ.get("MOFA_API_KEY") or "").strip()
    if not key:
        print("[오류] 공공데이터포털 인증키(KOSHA_API_KEY)가 없습니다.", file=sys.stderr)
        sys.exit(1)

    scanned, board_total, picked, seen = 0, 0, [], set()
    for page in range(1, MAX_PAGES + 1):
        items, board_total = fetch_page(key, page)
        scanned += len(items)
        for it in items:
            if (it.get("business") or "").strip() != TARGET_BUSINESS:
                continue
            bno = (it.get("boardno") or "").strip()
            if not bno or bno in seen:
                continue
            seen.add(bno)
            title = clean(it.get("keyword"))
            contents = clean(it.get("contents"))
            picked.append({
                "boardno": bno,
                "title": title,
                "contents": contents,
                "type": classify(title, contents),
                "registeredAt": registered_at(bno),
                "attachments": int(it.get("atcflcnt") or 0),
            })
        if len(items) < ROWS_PER_PAGE:
            break
        time.sleep(0.5)

    if not picked:
        print("[오류] 건설업 사례를 하나도 받지 못해 기존 파일을 유지합니다.", file=sys.stderr)
        sys.exit(1)

    picked.sort(key=lambda x: x["boardno"], reverse=True)
    picked = picked[:MAX_ITEMS]

    out = {
        "_readme": "이 파일은 GitHub Actions가 한국산업안전보건공단 국내재해사례 API로 자동 생성/갱신합니다. 직접 수정하지 마세요.",
        "source": "한국산업안전보건공단 산업안전포털 국내재해사례 (건설업)",
        "sourceUrl": "https://portal.kosha.or.kr",
        "boardTotal": board_total,
        "scanned": scanned,
        "count": len(picked),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "items": picked,
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"[완료] {scanned}건 중 건설업 {len(picked)}건 저장 → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
