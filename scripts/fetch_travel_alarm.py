"""
외교부 '국가·지역별 여행경보' 오픈 API로 나라별 여행경보 단계(1~4단계)를 받아
travel-alarm.json 으로 저장합니다. (기타 정보 > 주변국 여행경보 지도)

- 인증키: 대사관 안전공지에 쓰는 공공데이터포털 키(MOFA_API_KEY)
  같은 계정에서 '외교부_국가∙지역별 여행경보' API를 활용신청해 두어야 합니다.
- 한 나라 안에서도 지역별로 단계가 다르면(예: 일부 지역만 여행금지) 가장 높은 단계를 대표값으로 쓰고,
  지역별 내용은 함께 저장합니다.
"""

import json
import os
import sys
from datetime import datetime, timezone
from urllib.parse import quote

import requests

API = "https://apis.data.go.kr/1262000/TravelAlarmService2/getTravelAlarmList2"
OUT = "travel-alarm.json"
LEVEL_NAME = {1: "여행유의", 2: "여행자제", 3: "출국권고", 4: "여행금지"}


def service_key():
    key = (os.environ.get("TRAVEL_API_KEY") or os.environ.get("MOFA_API_KEY") or "").strip()
    if not key:
        print("[오류] 공공데이터포털 인증키(MOFA_API_KEY)가 없습니다.", file=sys.stderr)
        sys.exit(1)
    return key if "%" in key else quote(key, safe="")


def rows_of(j):
    """응답 모양이 여러 가지라 모두 처리:
       {data:[...]} / {response:{body:{items:{item:[...]}}}} / {response:{body:{items:[...]}}} / {items:[...]}"""
    if isinstance(j.get("data"), list):
        return j["data"], int(j.get("totalCount") or len(j["data"]))
    if isinstance(j.get("items"), list):
        return j["items"], int(j.get("totalCount") or len(j["items"]))
    body = (j.get("response") or {}).get("body") or {}
    items = body.get("items") or []
    if isinstance(items, dict):
        items = items.get("item") or []
    if isinstance(items, dict):
        items = [items]
    return items, int(body.get("totalCount") or len(items))


def pick(row, *names):
    """필드 이름이 대소문자·밑줄 표기만 다를 수 있어 느슨하게 찾는다"""
    norm = {str(k).lower().replace("_", ""): v for k, v in row.items()}
    for n in names:
        v = norm.get(n.lower().replace("_", ""))
        if v not in (None, ""):
            return v
    return ""


def level_of(v):
    try:
        n = int(str(v).strip()[0])
        return n if 1 <= n <= 4 else 0
    except (ValueError, IndexError):
        return 0


def main():
    key = service_key()
    rows, page = [], 1
    while True:
        url = f"{API}?serviceKey={key}&returnType=JSON&numOfRows=500&pageNo={page}"
        r = requests.get(url, timeout=60)
        text = r.text.strip()
        if text.startswith("<"):
            print(f"[오류] 응답 {r.status_code}: {text[:300]}", file=sys.stderr)
            print("        → 이 API를 활용신청했는지, 승인 후 1~2시간이 지났는지 확인해 주세요.", file=sys.stderr)
            sys.exit(1)
        j = r.json()
        got, total = rows_of(j)
        rows.extend(got)
        print(f"{page}쪽: {len(got)}행 (전체 {total})")
        if not got or len(rows) >= total:
            break
        page += 1

    if rows:
        print("첫 행 필드:", list(rows[0].keys()))
        print("첫 행 예시:", json.dumps(rows[0], ensure_ascii=False)[:500])
    else:
        print("[경고] 받은 행이 없습니다. 응답 앞부분:", json.dumps(j, ensure_ascii=False)[:500])

    countries = {}
    for it in rows:
        iso2 = str(pick(it, "country_iso_alp2", "iso_alp2", "countryIsoAlp2", "iso2")).upper().strip()
        if not iso2:
            continue
        lvl = level_of(pick(it, "alarm_lvl", "alarmLvl", "alarm_level", "current_travel_alarm"))
        c = countries.setdefault(iso2, {
            "iso2": iso2, "name": pick(it, "country_nm", "countryName") or "", "nameEn": pick(it, "country_eng_nm") or "",
            "level": 0, "regions": [], "written": pick(it, "written_dt", "wrt_dt") or "",
        })
        c["level"] = max(c["level"], lvl)
        region = str(pick(it, "region_ty", "regionTy", "region") or "").strip()
        remark = str(pick(it, "remark", "rmk") or "").strip()
        if lvl and (region or remark):
            c["regions"].append({"level": lvl, "levelName": LEVEL_NAME.get(lvl, ""), "region": region, "remark": remark[:300]})
    for c in countries.values():
        c["levelName"] = LEVEL_NAME.get(c["level"], "")
        c["partial"] = len({r["level"] for r in c["regions"]}) > 1  # 지역마다 단계가 다르면 '일부 지역'

    if not countries:
        print("[오류] 나라별 여행경보를 하나도 읽지 못했습니다. 위의 '첫 행 필드'를 확인해 주세요.", file=sys.stderr)
        sys.exit(1)   # 빈 파일로 덮어쓰지 않는다

    out = {
        "_readme": "외교부 국가·지역별 여행경보 API로 GitHub Actions가 자동 생성합니다. 직접 수정하지 마세요. 출처: 외교부 해외안전여행(0404.go.kr)",
        "levels": LEVEL_NAME,
        "countries": countries,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    cnt = {n: sum(1 for c in countries.values() if c["level"] == n) for n in range(1, 5)}
    print(f"저장 완료: {len(countries)}개국 · 1단계 {cnt[1]} · 2단계 {cnt[2]} · 3단계 {cnt[3]} · 4단계 {cnt[4]}")


if __name__ == "__main__":
    main()
