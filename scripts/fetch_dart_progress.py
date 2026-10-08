"""
상장 건설사 정기보고서(분기·반기·사업보고서)의 '수주산업 관련 공시' 표에서
현장별 진행률(공정률)을 읽어 dart-progress.json 으로 저장합니다.

- 이 표는 매출의 5% 이상인 큰 계약만 나오므로, 지도에 있는 현장 중 일부만 공정률이 있습니다.
- 표에는 미청구공사·공사미수금도 있지만, 이 파일에는 일부러 넣지 않습니다 (계약명·계약일·완성기한·진행률만).
- 지도 현장(overseas-projects.json)과 이름이 겹치는 줄을 찾아 matches 에 이어 둡니다.
  자동으로 안 이어지는 현장은 MANUAL_MATCH 에 (회사 id, 지도 현장 이름 일부) → (보고서 계약명 일부) 로 적으면 됩니다.

사전 준비: 저장소 Secrets 의 DART_API_KEY (해외 현장 수집과 같은 키)
"""

import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta
from html.parser import HTMLParser

sys.path.insert(0, os.path.dirname(__file__))
from fetch_dart_overseas import (TARGETS, dart_get, fetch_document_html, load_corp_codes,  # noqa: E402
                                 GENERIC_WORDS)

OUT = "dart-progress.json"
PROJECTS_PATH = "overseas-projects.json"
TIME_BUDGET_SEC = 10 * 60

# 자동으로 안 이어질 때 손으로 잇기: (회사 id, 지도 현장 이름에 들어 있는 말) → 보고서 계약명에 들어 있는 말
MANUAL_MATCH = {
    ("hanwha", "비스마야"): "비스마야",
}

COUNTRY_WORDS = {"사우디", "사우디아라비아", "이라크", "카타르", "쿠웨이트", "아랍에미리트", "UAE", "오만", "바레인", "이집트",
                 "알제리", "리비아", "베트남", "필리핀", "말레이시아", "싱가포르", "인도네시아", "대만", "미국", "멕시코",
                 "러시아", "나이지리아", "모잠비크", "체코", "폴란드", "투르크메니스탄", "우즈베키스탄", "카자흐스탄", "SAUDI", "IRAQ",
                 "QATAR", "KUWAIT", "OMAN", "해외", "국내"}
EXTRA_GENERIC = {"공사", "프로젝트", "설비", "시설", "현장", "계약", "건설공사", "신축", "공사중", "플랜트", "PROJECT", "EPC",
                 "UNIT", "FACILITIES", "FACILITY", "ENGINEERING", "CONSTRUCTION", "WORKS"}


class Tables(HTMLParser):
    """원문에서 표를 하나씩(행·칸 글자) 나눠 담는다"""

    def __init__(self):
        super().__init__()
        self.tables, self.cur, self.row, self.cell, self.in_cell, self.depth = [], None, None, [], False, 0

    def handle_starttag(self, tag, attrs):
        t = tag.lower()
        if t == "table":
            self.depth += 1
            if self.depth == 1:
                self.cur = []
        elif t == "tr" and self.cur is not None:
            self.row = []
        elif t in ("td", "th", "te", "tu"):
            self.in_cell, self.cell = True, []
        elif t in ("br", "p") and self.in_cell:
            self.cell.append(" ")

    def handle_endtag(self, tag):
        t = tag.lower()
        if t in ("td", "th", "te", "tu") and self.in_cell:
            self.in_cell = False
            if self.row is not None:
                self.row.append(re.sub(r"\s+", " ", "".join(self.cell)).strip())
        elif t == "tr" and self.row is not None and self.cur is not None:
            if any(self.row):
                self.cur.append(self.row)
            self.row = None
        elif t == "table":
            self.depth = max(0, self.depth - 1)
            if self.depth == 0 and self.cur is not None:
                self.tables.append(self.cur)
                self.cur = None

    def handle_data(self, data):
        if self.in_cell:
            self.cell.append(data)


DATE_RE = re.compile(r"^(\d{4})\s*[.\-/년]\s*(\d{1,2})(?:\s*[.\-/월]\s*(\d{1,2}))?")


def as_date(s):
    m = DATE_RE.match((s or "").strip())
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3) or 1)
    if not (1990 <= y <= 2060 and 1 <= mo <= 12):
        return None
    return f"{y:04d}-{mo:02d}-{min(d, 28) if not m.group(3) else d:02d}"


def as_rate(s):
    t = (s or "").replace(",", "").replace("%", "").strip()
    if not re.fullmatch(r"\d{1,3}(?:\.\d+)?", t):
        return None
    v = float(t)
    if 0 <= v <= 100:
        return round(v, 2)
    return None


def progress_rows(html):
    """'진행률' 머리글이 있는 표에서 (계약명, 발주처, 계약일, 완성기한, 진행률) 줄을 뽑는다"""
    p = Tables()
    p.feed(html)
    out = []
    for tb in p.tables:
        head = " ".join(" ".join(r) for r in tb[:3])
        if "진행률" not in head or not ("완성기한" in head or "계약일" in head):
            continue
        for row in tb:
            dates = [i for i, c in enumerate(row) if as_date(c)]
            if len(dates) < 2:
                continue
            i1, i2 = dates[0], dates[1]
            rate = None
            for c in row[i2 + 1:i2 + 3]:
                rate = as_rate(c)
                if rate is not None:
                    break
            if rate is None:
                continue
            name = row[i1 - 2] if i1 >= 2 else (row[i1 - 1] if i1 >= 1 else "")
            client = row[i1 - 1] if i1 >= 2 else ""
            if not name or re.fullmatch(r"[\d,.\-\s]+", name):
                continue
            out.append({"name": name, "client": client, "contractDate": as_date(row[i1]), "due": as_date(row[i2]), "rate": rate})
    # 같은 계약이 여러 표(연결·별도)에 두 번 나오면 하나만
    seen, uniq = set(), []
    for r in out:
        k = (re.sub(r"\s+", "", r["name"]), r["contractDate"])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(r)
    return uniq


def as_of(report_nm):
    m = re.search(r"\((\d{4})\.(\d{2})\)", report_nm or "")
    return f"{m.group(1)}-{m.group(2)}" if m else ""


def latest_periodic(key, corp_code):
    bgn = (date.today() - timedelta(days=430)).strftime("%Y%m%d")
    r = dart_get("list.json", key, corp_code=corp_code, bgn_de=bgn, end_de=date.today().strftime("%Y%m%d"),
                 pblntf_ty="A", page_count=100)
    d = r.json()
    if d.get("status") != "000":
        return None
    reps = [it for it in d.get("list", []) if re.search(r"(분기|반기|사업)보고서", it.get("report_nm", ""))]
    reps.sort(key=lambda it: (as_of(it.get("report_nm")), it["rcept_no"]), reverse=True)
    return reps[0] if reps else None


def tokens(s):
    toks = set()
    for t in re.findall(r"[가-힣]{2,}|[A-Za-z]{3,}|\d{3,}", s or ""):
        t = t.upper()
        toks.add(t)
        # 한글 붙여 쓴 말은 앞 두세 글자도 후보로 (예: '자푸라가스처리' → '자푸라')
        if re.match(r"[가-힣]{4,}", t):
            toks.add(t[:3])
    return toks - {w.upper() for w in GENERIC_WORDS} - {w.upper() for w in EXTRA_GENERIC} - {w.upper() for w in COUNTRY_WORDS}


def match(projects, rows_by_company):
    matches = {}
    for p in projects:
        rows = rows_by_company.get(p.get("company")) or []
        if not rows:
            continue
        best = None
        for (cid, word), rword in MANUAL_MATCH.items():
            if cid == p.get("company") and word in (p.get("name") or ""):
                best = next((r for r in rows if rword in r["name"]), None)
        if not best:
            pt = tokens(f"{p.get('name', '')} {p.get('dartName', '')} {p.get('city', '')}")
            scored = []
            for r in rows:
                common = pt & tokens(f"{r['name']} {r['client']}")
                if common:
                    scored.append((len(common), r))
            scored.sort(key=lambda x: -x[0])
            if scored and (len(scored) == 1 or scored[0][0] > scored[1][0]):
                best = scored[0][1]
        if best:
            matches[p["name"]] = {"company": p["company"], "rate": best["rate"], "contract": best["name"],
                                  "due": best.get("due"), "contractDate": best.get("contractDate")}
    return matches


def main():
    key = os.environ.get("DART_API_KEY", "").strip()
    if not key:
        print("[오류] DART_API_KEY가 없습니다.", file=sys.stderr)
        sys.exit(1)
    with open(PROJECTS_PATH, encoding="utf-8") as f:
        projects = json.load(f).get("projects", [])
    try:
        with open(OUT, encoding="utf-8") as f:
            prev = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        prev = {}
    prev_co = prev.get("companies", {})

    wanted = {p.get("company") for p in projects}
    listed = load_corp_codes(key)
    started = time.time()
    companies = {}
    for names, cid, cname, _short, _color in TARGETS:
        if cid not in wanted:
            continue
        if time.time() - started > TIME_BUDGET_SEC:
            print(f"[안내] 시간 제한으로 {cname} 이후는 다음에")
            if cid in prev_co:
                companies[cid] = prev_co[cid]
            continue
        corp_code = next((listed[n] for n in names if n in listed), None)
        if not corp_code:
            continue
        try:
            rep = latest_periodic(key, corp_code)
        except Exception as exc:
            print(f"::warning::{cname} 정기보고서 목록 실패: {exc}")
            rep = None
        if not rep:
            if cid in prev_co:
                companies[cid] = prev_co[cid]
            continue
        old = prev_co.get(cid) or {}
        if old.get("rcept_no") == rep["rcept_no"] and old.get("rows"):
            companies[cid] = old  # 같은 보고서면 다시 읽지 않는다
            print(f"{cname}: 같은 보고서({rep['report_nm']}) · {len(old['rows'])}줄 재사용")
            continue
        try:
            html = fetch_document_html(key, rep["rcept_no"])
            rows = progress_rows(html)
        except Exception as exc:
            print(f"::warning::{cname} 보고서 읽기 실패: {exc}")
            rows = []
        print(f"{cname}: {rep['report_nm']} → 진행률 {len(rows)}줄")
        if not rows and old.get("rows"):
            companies[cid] = old
            continue
        companies[cid] = {"name": cname, "report": rep["report_nm"].strip(), "rcept_no": rep["rcept_no"],
                          "asOf": as_of(rep["report_nm"]), "rows": rows}
        time.sleep(0.5)

    rows_by_company = {cid: v.get("rows", []) for cid, v in companies.items()}
    matches = match(projects, rows_by_company)
    for cid, v in companies.items():
        for m in matches.values():
            if m["company"] == cid:
                m["asOf"] = v.get("asOf", "")
                m["rcept_no"] = v.get("rcept_no", "")
    out = {"generatedAt": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
           "note": "상장 건설사 정기보고서 '수주산업 관련 공시'의 진행률 (미청구공사·공사미수금은 담지 않음)",
           "companies": companies, "matches": matches}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"::notice::진행률 표 {sum(len(v.get('rows', [])) for v in companies.values())}줄 · 지도 현장 연결 {len(matches)}곳")


if __name__ == "__main__":
    main()
