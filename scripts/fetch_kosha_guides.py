"""
산업안전보건공단 기술지원규정(KOSHA GUIDE) 목록을 받아 kosha-guides.json 으로 저장합니다.
(안전 > 안전작업절차서 > 관련 KOSHA GUIDE)

API: 공공데이터포털 '한국산업안전보건공단_기술지원규정(코샤가이드) 조회 서비스'
     http://apis.data.go.kr/B552468/koshaguide/getKoshaGuide  (callApiId=1050 고정)
인증키: GitHub Secret KOSHA_API_KEY (사고사례 API와 같은 계정 키)
※ 지침 원문은 저장하지 않고, 공단이 주는 다운로드 링크만 연결합니다 (항상 최신본).
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from urllib.parse import quote

import requests

API = "http://apis.data.go.kr/B552468/koshaguide/getKoshaGuide"
OUTPUT_PATH = "kosha-guides.json"
ROWS = 500

# 지침 번호 앞 글자 → 분야
CATS = {
    "C": "건설안전", "G": "안전일반", "M": "기계안전", "E": "전기·계장", "F": "화재·폭발",
    "P": "공정안전", "X": "위험성평가·관리", "H": "건강관리", "W": "작업환경관리", "A": "작업환경측정·분석",
    "D": "화학·폭발", "B": "조선·해양", "T": "독성시험", "O": "설비·정비", "K": "화학물질",
}


def category(no):
    """지침 번호로 분야를 정한다. 2025년부터 쓰는 'C-C-…', 'A-G-…' 같은 새 번호는 앞 글자가 업종이라
    건설(C)만 건설안전으로 묶고, 나머지는 '공통·업종별(새 번호)'로 둔다."""
    no = (no or "").upper()
    if re.match(r"^[A-Z]-[A-Z]-", no):
        return "건설안전" if no.startswith("C-") else "공통·업종별(새 번호)"
    return CATS.get(no[:1], "기타")


def key():
    for n in ("KOSHA_API_KEY", "MOFA_API_KEY"):
        k = (os.environ.get(n) or "").strip()
        if k:
            return k if "%" in k else quote(k, safe="")
    print("[오류] KOSHA_API_KEY 가 없습니다.", file=sys.stderr)
    sys.exit(1)


def get_page(k, page):
    url = f"{API}?serviceKey={k}"
    params = {"pageNo": page, "numOfRows": ROWS, "callApiId": "1050", "type": "json", "returnType": "json"}
    for attempt in range(3):
        try:
            r = requests.get(url, params=params, timeout=60)
            t = r.text.strip()
            if t.startswith("<"):
                m = re.search(r"<(?:returnAuthMsg|errMsg|resultMsg)>([^<]+)", t)
                raise RuntimeError(f"HTTP {r.status_code} {m.group(1) if m else t[:200]}")
            j = r.json()
            body = (j.get("response") or {}).get("body") or j.get("body") or {}
            head = (j.get("response") or {}).get("header") or j.get("header") or {}
            code = str(head.get("resultCode", "00"))
            if code not in ("00", "0"):
                raise RuntimeError(f"resultCode {code}: {head.get('resultMsg')}")
            items = body.get("items") or []
            if isinstance(items, dict):
                items = items.get("item") or []
            if isinstance(items, dict):
                items = [items]
            return items, int(body.get("totalCount") or 0)
        except Exception as e:
            err = e
            print(f"  {page}쪽 실패 ({attempt + 1}/3): {e}", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise err


def main():
    k = key()
    items, total = get_page(k, 1)
    print(f"전체 {total}건")
    page = 1
    while len(items) < total and page < 20:
        page += 1
        more, _ = get_page(k, page)
        if not more:
            break
        items += more
        time.sleep(0.5)

    out, seen = [], set()
    for it in items:
        no = str(it.get("techGdlnNo") or "").strip()
        nm = re.sub(r"\s+", " ", str(it.get("techGdlnNm") or "")).strip()
        if not nm or (no, nm) in seen:
            continue
        seen.add((no, nm))
        ymd = str(it.get("techGdlnOfancYmd") or "").strip()
        if re.fullmatch(r"\d{8}", ymd):
            ymd = f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}"
        cat = category(no)
        out.append({"no": no, "nm": nm, "ymd": ymd, "cat": cat, "url": str(it.get("fileDownloadUrl") or "").strip()})
    out.sort(key=lambda g: g["ymd"], reverse=True)

    if len(out) < 50:
        print(f"[오류] 받은 지침이 너무 적습니다 ({len(out)}건). 기존 파일을 유지합니다.", file=sys.stderr)
        sys.exit(1)
    cats = {}
    for g in out:
        cats[g["cat"]] = cats.get(g["cat"], 0) + 1
    data = {
        "_readme": "GitHub Actions가 안전보건공단 기술지원규정(KOSHA GUIDE) API로 자동 생성합니다. 직접 수정하지 마세요.",
        "source": "한국산업안전보건공단 기술지원규정(KOSHA GUIDE) 조회 서비스 (공공데이터포털)",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "total": len(out),
        "cats": cats,
        "guides": out,
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(out)}건 저장 · 분야별 {cats}")


if __name__ == "__main__":
    main()
