"""
질병관리청 '전수신고 감염병 발생현황' 오픈 API(공공데이터포털 15139178)로
1~3급 법정감염병 주별 신고 건수를 받아 kdca-infectious.json 으로 저장합니다.

- 인증키: 대사관 공지에 쓰는 공공데이터포털 키(MOFA_API_KEY)를 그대로 씁니다.
  (같은 계정으로 이 API를 활용신청해 두면 같은 키로 호출됩니다)
- 최근 주는 신고가 늦게 들어와 숫자가 계속 늘어나므로, 화면 기준 주는
  '진행 중인 주의 2주 전'으로 잡습니다 (그보다 최근 주는 잠정치로 따로 표시).
- 출처: 질병관리청 (공공누리 제4유형: 출처표시·상업적 이용금지·변경금지)
"""

import json
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote

import requests

API = "https://apis.data.go.kr/1790387/EIDAPIService/PeriodRegion"
OUT = "kdca-infectious.json"
TREND_WEEKS = 12


def service_key():
    key = (os.environ.get("KDCA_API_KEY") or os.environ.get("MOFA_API_KEY") or "").strip()
    if not key:
        print("[오류] 공공데이터포털 인증키(MOFA_API_KEY)가 없습니다.", file=sys.stderr)
        sys.exit(1)
    # 이미 인코딩된 키(%2B 등 포함)면 그대로, 디코딩 키면 URL 인코딩
    return key if "%" in key else quote(key, safe="")


def fetch_year(key, year):
    rows, page = [], 1
    while True:
        url = (f"{API}?serviceKey={key}&resType=2&pageNo={page}&numOfRows=5000"
               f"&searchPeriodType=3&searchStartYear={year}&searchEndYear={year}")
        r = requests.get(url, timeout=60)
        text = r.text.strip()
        if text.startswith("<"):
            raise RuntimeError(f"인증 오류(HTTP {r.status_code}): {text[:300]}")
        j = r.json()
        if "response" not in j:
            raise RuntimeError(f"요청 오류: {json.dumps(j, ensure_ascii=False)[:300]}")
        hdr = j["response"].get("header", {})
        if str(hdr.get("resultCode")) != "00":
            raise RuntimeError(f"요청 오류: {hdr}")
        body = j["response"].get("body", {})
        items = (body.get("items") or {}).get("item") or []
        if isinstance(items, dict):
            items = [items]
        rows.extend(items)
        total = int(str(body.get("totalCount", "0")).replace(",", "") or 0)
        if len(rows) >= total or not items:
            break
        page += 1
    return rows


def num(v):
    try:
        return int(str(v).replace(",", "").strip())
    except (ValueError, TypeError):
        return 0


def week_start(year, week):
    """질병관리청 주차: 1월 1일이 들어 있는 주(일~토)가 1주"""
    jan1 = date(year, 1, 1)
    first_sunday = jan1 - timedelta(days=(jan1.weekday() + 1) % 7)
    return first_sunday + timedelta(weeks=week - 1)


def main():
    key = service_key()
    this_year = datetime.now(timezone.utc).year
    raw = []
    for y in (this_year - 1, this_year):
        try:
            got = fetch_year(key, y)
            print(f"{y}년 주별 {len(got)}행")
            raw.extend(got)
        except Exception as exc:
            print(f"[경고] {y}년 조회 실패: {exc}", file=sys.stderr)
            if y == this_year:
                sys.exit(1)

    # (연, 주, 감염병) → 값
    data = {}
    diseases = {}
    for it in raw:
        m = re.match(r"(\d{4})년\s*(\d{1,2})주", str(it.get("period", "")))
        if not m:
            continue  # '계' 행 등은 버린다
        y, w = int(m.group(1)), int(m.group(2))
        name = str(it.get("icdNm", "")).lstrip("@").strip()
        grade = str(it.get("icdGroupNm", "")).strip()
        if grade and not grade.startswith("제"):
            grade = "제" + grade
        diseases[name] = grade
        data[(y, w, name)] = {
            "total": num(it.get("resultVal")),
            "dmstc": num(it.get("dmstcVal")),
            "outnatn": num(it.get("outnatnVal")),
        }

    weeks = sorted({(y, w) for (y, w, _) in data})
    if len(weeks) < 4:
        print("[오류] 주별 자료가 충분하지 않습니다.", file=sys.stderr)
        sys.exit(1)

    current = weeks[-1]              # 진행 중인 주
    base_i = len(weeks) - 3          # 화면 기준 주 = 2주 전
    base, prev, provisional = weeks[base_i], weeks[base_i - 1], weeks[-2]
    trend = weeks[max(0, base_i - TREND_WEEKS + 1): base_i + 1]

    def label(yw):
        s = week_start(*yw)
        return {"year": yw[0], "week": yw[1], "label": f"{yw[0]}년 {yw[1]}주",
                "start": s.isoformat(), "end": (s + timedelta(days=6)).isoformat()}

    def val(yw, name, k="total"):
        return data.get((yw[0], yw[1], name), {}).get(k, 0)

    grades = {}
    for g in ("제1급", "제2급", "제3급"):
        names = [n for n, gg in diseases.items() if gg == g]
        grades[g] = {
            "diseases": len(names),
            "base": sum(val(base, n) for n in names),
            "prev": sum(val(prev, n) for n in names),
            "provisional": sum(val(provisional, n) for n in names),
            "outnatn": sum(val(base, n, "outnatn") for n in names),
            "trend": [sum(val(w, n) for n in names) for w in trend],
        }

    top = []
    for n, g in diseases.items():
        b = val(base, n)
        if b <= 0:
            continue
        top.append({"name": n, "grade": g, "base": b, "prev": val(prev, n),
                    "provisional": val(provisional, n),
                    "dmstc": val(base, n, "dmstc"), "outnatn": val(base, n, "outnatn")})
    top.sort(key=lambda x: -x["base"])

    # 제1급: 최근 4주(잠정 포함) 동안 1건이라도 신고된 감염병
    recent4 = weeks[-4:]
    grade1 = []
    for n, g in diseases.items():
        if g != "제1급":
            continue
        hits = [{"week": label(w)["label"], "count": val(w, n)} for w in recent4 if val(w, n) > 0]
        if hits:
            grade1.append({"name": n, "weeks": hits, "total": sum(h["count"] for h in hits)})

    # 해외유입: 최근 4주 합계 상위
    imported = []
    for n, g in diseases.items():
        c = sum(val(w, n, "outnatn") for w in recent4)
        if c > 0:
            imported.append({"name": n, "grade": g, "count": c})
    imported.sort(key=lambda x: -x["count"])

    out = {
        "_readme": "질병관리청 전수신고 감염병 발생현황 API로 GitHub Actions가 자동 생성합니다. 직접 수정하지 마세요. 출처: 질병관리청 (공공누리 제4유형)",
        "source": "질병관리청 전수신고 감염병 발생현황 (공공데이터포털)",
        "currentWeek": label(current),
        "baseWeek": label(base),
        "prevWeek": label(prev),
        "provisionalWeek": label(provisional),
        "trendWeeks": [label(w)["label"] for w in trend],
        "grades": grades,
        "top": top[:15],
        "grade1Recent": grade1,
        "importedRecent4": imported[:10],
        "totalBase": sum(v["base"] for v in grades.values()),
        "totalPrev": sum(v["prev"] for v in grades.values()),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"기준 주 {out['baseWeek']['label']} ({out['baseWeek']['start']}~{out['baseWeek']['end']}) · "
          f"전체 {out['totalBase']}건 · 1급 {grades['제1급']['base']} · 2급 {grades['제2급']['base']} · 3급 {grades['제3급']['base']} "
          f"· 최근 4주 1급 신고 {len(grade1)}종 · 해외유입 {len(imported)}종")


if __name__ == "__main__":
    main()
