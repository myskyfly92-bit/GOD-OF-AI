"""
한국산업안전보건공단_국내재해사례 게시판 정보 조회서비스에서
최신 재해사례를 모든 업종(건설업·제조업·조선업 등) 받아 kosha-cases.json으로 저장합니다.
각 사례에 업종(business)을 붙여, 사이트에서 건설업을 따로 표시·필터할 수 있게 합니다.
(안전 > 사고사례 탭)

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
# 첨부파일(사례별 상세 자료 PDF) 조회 API — 활용가이드에는 'Disaster_attch_api02'로 오타가 있음
ATTACH_ENDPOINTS = [
    "https://apis.data.go.kr/B552468/disaster_attach_api02/Disaster_attach_api02",
    "http://apis.data.go.kr/B552468/disaster_attach_api02/Disaster_attach_api02",
]
OUTPUT_PATH = "kosha-cases.json"
ROWS_PER_PAGE = 100
MAX_PAGES = 4          # 최신 400건까지 훑기 (모든 업종)
MAX_ITEMS = 300        # 화면에 남길 최대 건수

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


DATE_RE = re.compile(r"((?:19|20)\d{2})\s*[.\-년]\s*(\d{1,2})\s*[.\-월]\s*(\d{1,2}|[0Oo○ㅇ](?:\s*[0Oo○ㅇ])?)?")
PROV = ("서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|"
        "충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|경기도|강원도|제주도|"
        "전북특별자치도|강원특별자치도|제주특별자치도")
PROV_SHORT = {"충청북도":"충북","충청남도":"충남","전라북도":"전북","전라남도":"전남","경상북도":"경북",
              "경상남도":"경남","경기도":"경기","강원도":"강원","제주도":"제주","전북특별자치도":"전북",
              "강원특별자치도":"강원","제주특별자치도":"제주"}
CITY_RE = re.compile(rf"({PROV})(?:특별시|광역시|특별자치시|시|도)?\s+([가-힣]{{1,4}}?[시군구])(?=[\s,]|소재|에서|내)")
CITY_ONLY_RE = re.compile(r"(?:^|[\s,])([가-힣]{2,4}?[시군구])\s*(?:소재|에서)")
PROV_ONLY_RE = re.compile(rf"({PROV})(?:특별시|광역시|시|도)?\s*(?:소재|에서)")
PROV_LOOSE_RE = re.compile(rf"({PROV})(?:특별시|광역시|특별자치시|시|도)?\s+([가-힣]{{2,5}})")
LOOSE = ["해운대"]

def accident_date(text):
    m = DATE_RE.search(text[:80])
    if not m: return None
    y, mo, d = int(m.group(1)), int(m.group(2)), m.group(3)
    if not (1 <= mo <= 12): return None
    day = int(d) if d and d.isdigit() and 1 <= int(d) <= 31 else 0
    return (y, mo, day)

def place(text):
    t = text[:160]
    m = CITY_RE.search(t)
    if m:
        prov = PROV_SHORT.get(m.group(1), m.group(1)); city = m.group(2)
        return prov, city
    m = CITY_ONLY_RE.search(t)
    if m: return "", m.group(1)
    m = PROV_LOOSE_RE.search(t)
    if m:
        word = re.sub(r"(에|의)$", "", m.group(2))
        if word and not word.startswith("소재") and not re.search(r"[O○ㅇo]", word):
            return PROV_SHORT.get(m.group(1), m.group(1)), word
    m = PROV_ONLY_RE.search(t)
    if m: return PROV_SHORT.get(m.group(1), m.group(1)), ""
    for w in LOOSE:
        if w in t: return "", w
    return "", ""

NEWS_TYPE_WORD = {"떨어짐": "추락", "감전": "감전", "질식": "질식", "화재·폭발": "화재", "매몰·붕괴": "매몰"}
TITLE_STOP = {"작업", "중", "중에", "및", "위해", "하던", "하여", "후", "시", "등", "내", "인한", "의한",
              "떨어짐", "추락", "추락함", "끼임", "깔림", "맞음", "감전", "질식", "이동", "작업중", "공사"}


def news_query(title, typ, prov, city):
    if city and city[-1] in "시군구" and len(city) > 2:
        where = city[:-1]                      # 울진군 → 울진
    elif city:
        where = f"{prov} {city}".strip()       # 서울 중구, 세종 전동면
    else:
        where = prov
    words = [w for w in re.split(r"[\s·,()]+", title) if w and w not in TITLE_STOP and not re.fullmatch(r".{0,1}", w)]
    words = [re.sub(r"(에서|에게|에|을|를|이|가|와|과)$", "", w) for w in words][:2]
    parts = [where, *words, NEWS_TYPE_WORD.get(typ, "사고")]
    return " ".join(p for p in parts if p).strip()


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


def fetch_attachments(key, boardno):
    """사례 하나의 첨부파일 목록 [{name, url}]. 실패하면 None (다음 실행 때 다시 시도)."""
    for base in ATTACH_ENDPOINTS:
        url = f"{base}?serviceKey={key}"
        params = {"callApiId": "1070", "boardno": boardno, "pageNo": 1, "numOfRows": 10}
        try:
            resp = requests.get(url, params=params, timeout=20)
            if resp.status_code != 200:
                continue
            data = resp.json()
        except Exception:
            continue
        code = (data.get("header") or {}).get("resultCode")
        if code == "03":  # 데이터 없음 = 첨부파일 없는 사례
            return []
        if code != "00":
            print(f"[경고] 첨부파일 조회 {boardno}: {code}", file=sys.stderr)
            return None
        items = ((data.get("body") or {}).get("items") or {}).get("item") or []
        if isinstance(items, dict):
            items = [items]
        files = []
        for f in items:
            link = (f.get("filepath") or "").strip().replace("/openapi./", "/openapi/")
            if link.startswith("http"):
                files.append({"name": clean(f.get("filenm")) or "상세 자료", "url": link})
        return files
    return None


def load_previous():
    """이전 결과의 첨부파일 정보를 재사용해 매일 같은 사례를 다시 조회하지 않는다."""
    try:
        with open(OUTPUT_PATH, encoding="utf-8") as f:
            old = json.load(f)
        return {it["boardno"]: it["files"] for it in old.get("items", []) if isinstance(it.get("files"), list)}
    except Exception:
        return {}


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
            business = (it.get("business") or "").strip() or "기타"
            bno = (it.get("boardno") or "").strip()
            if not bno or bno in seen:
                continue
            seen.add(bno)
            title = clean(it.get("keyword"))
            contents = clean(it.get("contents"))
            typ = classify(title, contents)
            reg = registered_at(bno)
            dt = accident_date(contents)
            prov, city = place(contents)
            if dt:
                y, mo, d = dt
                acc = f"{y:04d}-{mo:02d}-{d:02d}" if d else f"{y:04d}-{mo:02d}"
                sort_key = f"{y:04d}{mo:02d}{d:02d}"
            else:
                acc = ""
                sort_key = "0"  # 발생일이 본문에 없으면 맨 뒤로
            picked.append({
                "boardno": bno,
                "business": business,
                "title": title,
                "contents": contents,
                "type": typ,
                "accidentDate": acc,
                "sortKey": sort_key,
                "place": " ".join(p for p in (prov, city) if p),
                "newsQuery": news_query(title, typ, prov, city),
                "registeredAt": reg,
                "attachments": int(it.get("atcflcnt") or 0),
            })
        if len(items) < ROWS_PER_PAGE:
            break
        time.sleep(0.5)

    if not picked:
        print("[오류] 사례를 하나도 받지 못해 기존 파일을 유지합니다.", file=sys.stderr)
        sys.exit(1)

    # 공단 게시(등록) 최신순 — 공단은 사고 후 몇 달 뒤에 사례를 올리므로 발생일순으로 자르면 최근 게시가 빠질 수 있다
    picked.sort(key=lambda x: x["boardno"], reverse=True)
    picked = picked[:MAX_ITEMS]

    # 사례별 첨부파일(상세 자료) — 새로 생긴 사례만 조회
    prev = load_previous()
    called = 0
    for it in picked:
        if it["boardno"] in prev:
            it["files"] = prev[it["boardno"]]
            continue
        if it["attachments"] == 0:
            it["files"] = []
            continue
        files = fetch_attachments(key, it["boardno"])
        called += 1
        if files is not None:
            it["files"] = files
        time.sleep(0.1)
    print(f"[첨부파일] 새로 조회 {called}건")

    out = {
        "_readme": "이 파일은 GitHub Actions가 한국산업안전보건공단 국내재해사례 API로 자동 생성/갱신합니다. 직접 수정하지 마세요.",
        "source": "한국산업안전보건공단 산업안전포털 국내재해사례 (전 업종)",
        "sourceUrl": "https://portal.kosha.or.kr",
        "boardTotal": board_total,
        "scanned": scanned,
        "count": len(picked),
        "businesses": sorted({it["business"] for it in picked}),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "items": picked,
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    by = {}
    for it in picked:
        by[it["business"]] = by.get(it["business"], 0) + 1
    print(f"[완료] {scanned}건 중 {len(picked)}건 저장 → {OUTPUT_PATH} · 업종별 {by}")


if __name__ == "__main__":
    main()
