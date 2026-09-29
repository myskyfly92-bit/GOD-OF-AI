"""
OpenDART(전자공시) API로 주요 상장 건설사의 '단일판매·공급계약체결' 공시를 모아,
해외 공사만 골라 overseas-projects.json 에 자동으로 넣습니다.

- 최근 LOOKBACK_MONTHS 개월치 공시를 매번 다시 훑습니다(이미 읽은 공시는 캐시에서 재사용).
- 담당자가 손으로 넣은 현장(auto 표시가 없는 것)은 절대 건드리지 않고, 자동 수집분만 교체합니다.
- 공시에는 보통 나라까지만 나오므로 핀은 그 나라 중앙에 꽂힙니다.
  정확한 위치가 필요하면 overrides 항목(rcept_no 기준)에 lat/lon을 적으면 됩니다.

사전 준비:
    https://opendart.fss.or.kr 인증키 발급 → 저장소 Secrets 에 DART_API_KEY 로 등록
"""

import io
import json
import os
import re
import sys
import time
import zipfile
from datetime import date, datetime, timedelta
from html.parser import HTMLParser
from xml.etree import ElementTree

import requests

API = "https://opendart.fss.or.kr/api"
PROJECTS_PATH = "overseas-projects.json"
CACHE_PATH = "dart-contracts-cache.json"
WORLD_PATH = "world-map.json"
LOOKBACK_MONTHS = 24
# 한 번 실행에서 새로 읽을 공시 원문 수와 시간 제한.
# 처음 2년치를 한꺼번에 읽으면 오래 걸리므로 나눠서 읽고, 읽은 것은 캐시에 저장해 다음 실행 때 이어서 읽는다.
MAX_NEW_DOCS_PER_RUN = 150
TIME_BUDGET_SEC = 12 * 60
HEADERS = {"User-Agent": "Mozilla/5.0 (BNCP-HSE-Dashboard; GitHub Actions)"}

# 수집 대상 상장 건설사: (공시상 회사명 후보들, 지도에 쓸 회사 id, 표시 이름, 약칭, 색)
# 회사 id가 overseas-projects.json 의 companies 에 이미 있으면(예: hanwha) 그 설정(로고 등)을 그대로 쓴다.
TARGETS = [
    (["현대건설"], "hdec", "현대건설", "현대", "#0b5aa6"),
    (["삼성물산"], "samsungcnt", "삼성물산", "물산", "#1428a0"),
    (["삼성E&A", "삼성이앤에이", "삼성엔지니어링"], "samsungea", "삼성E&A", "E&A", "#2a5bd7"),
    (["대우건설"], "daewoo", "대우건설", "대우", "#0072bc"),
    (["GS건설"], "gsenc", "GS건설", "GS", "#00a19a"),
    (["DL이앤씨", "디엘이앤씨"], "dlenc", "DL이앤씨", "DL", "#6d2077"),
    (["HDC현대산업개발"], "hdc", "HDC현대산업개발", "HDC", "#3d3d3d"),
    (["두산에너빌리티"], "doosan", "두산에너빌리티", "두산", "#005eb8"),
    (["한화"], "hanwha", "한화 건설부문", "한화", "#f37321"),
    (["코오롱글로벌"], "kolon", "코오롱글로벌", "코오롱", "#d6001c"),
    (["태영건설"], "taeyoung", "태영건설", "태영", "#00857c"),
    (["금호건설"], "kumho", "금호건설", "금호", "#c8102e"),
    (["동부건설"], "dongbu", "동부건설", "동부", "#1b6ab3"),
    (["계룡건설산업"], "kyeryong", "계룡건설", "계룡", "#2e7d32"),
    (["HJ중공업"], "hj", "HJ중공업", "HJ", "#00539b"),
    (["삼성중공업"], "shi", "삼성중공업", "삼성重", "#1f4e9e"),
]

# (주)한화처럼 건설 외 사업이 섞인 회사는 공사 계약만 고른다
CONSTRUCTION_ONLY = {"hanwha"}
CONSTRUCTION_WORDS = ["공사", "건설", "신도시", "플랜트", "시공", "EPC", "주택", "인프라", "도로", "교량", "터널", "항만", "발전소"]

# 나라 이름 별칭 → 지도 데이터(world-map.json)의 한글 국가명
COUNTRY_ALIASES = {
    "UAE": "아랍에미리트", "U.A.E": "아랍에미리트", "아랍에미레이트": "아랍에미리트", "아랍에미리트연합": "아랍에미리트",
    "아부다비": "아랍에미리트", "두바이": "아랍에미리트",
    "사우디": "사우디아라비아", "SAUDI": "사우디아라비아", "리야드": "사우디아라비아", "네옴": "사우디아라비아",
    "QATAR": "카타르", "KUWAIT": "쿠웨이트", "IRAQ": "이라크", "바그다드": "이라크", "비스마야": "이라크",
    "미합중국": "미국", "USA": "미국", "U.S.A": "미국", "UNITEDSTATES": "미국", "텍사스": "미국", "루이지애나": "미국", "조지아주": "미국",
    "체코공화국": "체코", "CZECH": "체코", "POLAND": "폴란드",
    "VIETNAM": "베트남", "INDONESIA": "인도네시아", "SINGAPORE": "싱가포르", "PHILIPPINES": "필리핀",
    "MALAYSIA": "말레이시아", "THAILAND": "태국", "CAMBODIA": "캄보디아", "LAOS": "라오스", "MYANMAR": "미얀마",
    "INDIA": "인도", "BANGLADESH": "방글라데시", "PAKISTAN": "파키스탄", "MONGOLIA": "몽골",
    "TURKMENISTAN": "투르크메니스탄", "UZBEKISTAN": "우즈베키스탄", "KAZAKHSTAN": "카자흐스탄",
    "OMAN": "오만", "BAHRAIN": "바레인", "LIBYA": "리비아", "ALGERIA": "알제리", "EGYPT": "이집트", "NIGERIA": "나이지리아",
    "MEXICO": "멕시코", "CANADA": "캐나다", "AUSTRALIA": "호주", "오스트레일리아": "호주", "CHILE": "칠레", "PERU": "페루",
    "PANAMA": "파나마", "BRAZIL": "브라질", "UK": "영국", "UNITEDKINGDOM": "영국", "NORWAY": "노르웨이",
    "TAIWAN": "대만", "타이완": "대만", "HONGKONG": "홍콩", "터키": "튀르키예", "TURKEY": "튀르키예", "CHINA": "중국",
    "JAPAN": "일본", "SWEDEN": "스웨덴", "ROMANIA": "루마니아", "NEWZEALAND": "뉴질랜드",
}
SHIP_PATTERN = re.compile(r"\d+\s*척|운반선|유조선|컨테이너선|벌크선|원유운반|VLCC|VLGC|LNGC|셔틀탱커|선박", re.I)

DOMESTIC_WORDS = ["대한민국", "국내", "한국", "서울", "경기", "인천", "부산", "대구", "광주", "대전", "울산", "세종",
                  "강원", "충청", "충북", "충남", "전라", "전북", "전남", "경상", "경북", "경남", "제주"]

PALETTE = ["#0b5aa6", "#00a19a", "#6d2077", "#d6001c", "#2e7d32", "#f2a93b", "#1428a0", "#8a5a00"]


def norm(s):
    return re.sub(r"[\sㆍ·‧•.()\-_/]", "", s or "").upper()


# ---------------------------------------------------------------- HTML/XML 표 읽기
class TableText(HTMLParser):
    """공시 원문(HTML이나 DART XML)에서 표의 행·칸 글자만 뽑아낸다"""

    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell, self.in_cell = [], None, [], False

    def handle_starttag(self, tag, attrs):
        t = tag.lower()
        if t == "tr":
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
        elif t == "tr" and self.row is not None:
            if any(self.row):
                self.rows.append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.in_cell:
            self.cell.append(data)


def cells_after(rows, label_words, numeric=False):
    """label_words 가 모두 들어 있는 칸을 찾아 그 오른쪽 첫 번째 값 칸을 돌려준다"""
    keys = [norm(w) for w in label_words]
    for row in rows:
        for i, c in enumerate(row):
            n = norm(c)
            # 긴 설명 문장(기타 참고사항 등)은 항목 이름 칸이 아니므로 건너뛴다
            if len(n) > 30:
                continue
            if all(k in n for k in keys):
                for v in row[i + 1:]:
                    v = v.strip()
                    if not v or v in ("-", "해당사항없음"):
                        continue
                    if norm(v) == n:
                        continue
                    if numeric and not re.search(r"\d{3,}", v):
                        continue
                    return v
    return ""


def parse_contract(html):
    p = TableText()
    p.feed(html)
    rows = p.rows
    info = {
        "kind": cells_after(rows, ["공급계약", "구분"]),
        "name": cells_after(rows, ["체결계약명"]) or cells_after(rows, ["공급계약", "내용"]),
        "amount": cells_after(rows, ["계약금액"], numeric=True),
        "counterparty": cells_after(rows, ["계약상대"]),
        "region": cells_after(rows, ["공급지역"]),
        "start": cells_after(rows, ["시작일"]),
        "end": cells_after(rows, ["종료일"]),
        "contractDate": cells_after(rows, ["계약", "수주", "일자"]) or cells_after(rows, ["계약일"]),
    }
    return info


# ---------------------------------------------------------------- OpenDART 호출
def dart_get(path, key, **params):
    params["crtfc_key"] = key
    for attempt in range(2):
        try:
            r = requests.get(f"{API}/{path}", params=params, headers=HEADERS, timeout=25)
            if r.status_code == 200:
                return r
            print(f"[경고] {path} 응답 코드 {r.status_code}", file=sys.stderr)
        except requests.RequestException as exc:
            print(f"[경고] {path} 요청 오류: {exc}", file=sys.stderr)
        time.sleep(2)
    raise RuntimeError(f"{path} 요청 실패")


def load_corp_codes(key):
    r = dart_get("corpCode.xml", key)
    try:
        z = zipfile.ZipFile(io.BytesIO(r.content))
    except zipfile.BadZipFile:
        raise RuntimeError(f"회사 코드 목록을 받지 못했습니다 (인증키 확인 필요): {r.text[:300]}")
    root = ElementTree.fromstring(z.read(z.namelist()[0]))
    listed = {}
    for el in root.iter("list"):
        name = (el.findtext("corp_name") or "").strip()
        stock = (el.findtext("stock_code") or "").strip()
        if stock:
            listed[name] = el.findtext("corp_code")
    return listed


def list_contract_filings(key, corp_code, bgn):
    out, page = [], 1
    while True:
        r = dart_get("list.json", key, corp_code=corp_code, bgn_de=bgn, end_de=date.today().strftime("%Y%m%d"),
                     pblntf_ty="I", page_no=page, page_count=100)
        d = r.json()
        if d.get("status") == "013":  # 조회 결과 없음
            break
        if d.get("status") != "000":
            raise RuntimeError(f"list.json 오류 {d.get('status')}: {d.get('message')}")
        for it in d.get("list", []):
            nm = it.get("report_nm", "")
            if "단일판매" in nm and "공급계약" in nm and "해지" not in nm:
                out.append(it)
        if page >= int(d.get("total_page", 1)):
            break
        page += 1
        time.sleep(0.3)
    return out


def fetch_document_html(key, rcept_no):
    # 1) OpenDART 공시서류원본 API
    try:
        r = dart_get("document.xml", key, rcept_no=rcept_no)
        z = zipfile.ZipFile(io.BytesIO(r.content))
        texts = []
        for n in z.namelist():
            raw = z.read(n)
            for enc in ("utf-8", "euc-kr", "cp949"):
                try:
                    texts.append(raw.decode(enc))
                    break
                except UnicodeDecodeError:
                    continue
        if texts:
            return "\n".join(texts)
    except (zipfile.BadZipFile, RuntimeError):
        pass
    # 2) 안 되면 DART 뷰어 페이지
    main = requests.get("https://dart.fss.or.kr/dsaf001/main.do", params={"rcpNo": rcept_no}, headers=HEADERS, timeout=25)
    m = re.search(r"viewDoc\('(\d+)',\s*'(\d+)'", main.text) or re.search(r'"dcmNo"\s*[:=]\s*"?(\d+)', main.text)
    if not m:
        raise RuntimeError("원문 문서 번호를 찾지 못함")
    dcm = m.group(2) if m.lastindex and m.lastindex >= 2 else m.group(1)
    v = requests.get("https://dart.fss.or.kr/report/viewer.do",
                     params={"rcpNo": rcept_no, "dcmNo": dcm, "eleId": 0, "offset": 0, "length": 0, "dtd": "HTML"},
                     headers=HEADERS, timeout=25)
    v.encoding = v.apparent_encoding or "utf-8"
    return v.text


# ---------------------------------------------------------------- 가공
def load_countries():
    with open(WORLD_PATH, encoding="utf-8") as f:
        world = json.load(f)
    centers = {}
    for feat in world["features"]:
        p = feat["properties"]
        centers[p["ko"]] = (p["labelLat"], p["labelLon"])
    return centers


def detect_country(text, centers):
    n = norm(text)
    if not n:
        return None
    # 긴 이름부터 맞춰 봐야 '인도'가 '인도네시아'를 먼저 잡아먹지 않는다
    for ko in sorted(centers, key=len, reverse=True):
        if len(ko) >= 2 and norm(ko) in n:
            return ko
    for alias, ko in sorted(COUNTRY_ALIASES.items(), key=lambda x: -len(x[0])):
        if norm(alias) in n and ko in centers:
            return ko
    return None


GENERIC_WORDS = {"신도시", "사업", "관련", "프로젝트", "공사", "건설", "PROJECT", "NEW", "CITY", "THE", "AND",
                 "PHASE", "PACKAGE", "PKG", "PLANT", "주택", "개발", "단지"}


def name_tokens(name):
    toks = set()
    for t in re.findall(r"[가-힣]{2,}|[A-Za-z]{3,}", name or ""):
        t = t.upper()
        if t not in GENERIC_WORDS and len(t) >= 3 or (re.match(r"[가-힣]", t) and len(t) >= 3):
            toks.add(t)
    return toks - GENERIC_WORDS


def same_project(manual, auto):
    """같은 회사·같은 나라이고, 흔한 단어를 뺀 고유 이름(예: 비스마야)이 겹치면 같은 공사로 본다"""
    if manual.get("company") != auto.get("company") or manual.get("country") != auto.get("country"):
        return False
    common = name_tokens(manual.get("name")) & name_tokens(auto.get("name"))
    common -= {auto.get("country", "").upper()}
    return bool(common)


# 도시 목록에 없는 대형 플랜트·항만 현장 이름 (대략 위치)
SITE_EXTRAS = {
    "이라크": [("알포", ["알포", "AL FAW", "FAW", "파우"], 29.98, 48.47), ("비스마야", ["비스마야", "BISMAYAH"], 33.193, 44.618)],
    "사우디아라비아": [("자푸라", ["자푸라", "JAFURAH"], 25.5, 49.5), ("마르잔", ["마르잔", "MARJAN"], 28.4, 49.6),
                   ("쥬베일", ["쥬베일", "주베일", "JUBAIL"], 27.01, 49.66), ("라스타누라", ["라스타누라", "RAS TANURA"], 26.64, 50.16),
                   ("네옴", ["네옴", "NEOM"], 28.0, 35.2)
                   , ("루마", ["루마", "RUMAH"], 25.58, 47.16), ("나이리야", ["나이리야", "NAIRYAH", "NUAYRIYAH"], 27.47, 48.48)],
    "카타르": [("라스라판", ["라스라판", "RAS LAFFAN"], 25.91, 51.55), ("메사이드", ["메사이드", "MESAIEED"], 24.99, 51.55)],
    "오만": [("두큼", ["두큼", "DUQM"], 19.66, 57.70), ("미스파", ["미스파", "MISFAH"], 23.5, 58.2)],
    "러시아": [("우스트루가", ["우스트루가", "우스트-루가", "UST-LUGA", "UST LUGA"], 59.66, 28.40)],
    "체코": [("두코바니", ["두코바니", "DUKOVANY"], 49.09, 16.15)],
    "바레인": [("시트라", ["시트라", "SITRA", "BAPCO"], 26.15, 50.62)],
    "아랍에미리트": [("루와이스", ["루와이스", "RUWAIS"], 24.11, 52.73)],
    "나이지리아": [("보니섬", ["보니섬", "보니", "BONNY"], 4.43, 7.17), ("바옐사", ["BAYELSA", "바옐사"], 4.92, 6.26)],
    "모잠비크": [("팔마", ["팔마", "PALMA", "아풍기", "AFUNGI"], -10.77, 40.47)],
    "말레이시아": [("펭게랑", ["펭게랑", "PENGERANG"], 1.37, 104.12), ("사라왁", ["사라왁", "SARAWAK"], 2.5, 113.0)],
    "멕시코": [("도스보카스", ["도스보카스", "DOS BOCAS"], 18.43, -93.18)],
    "리비아": [("미스라타", ["미스라타", "MISURATA", "MISRATA"], 32.38, 15.09)],
    "대만": [("타오위안", ["타오위안", "TAOYUAN"], 25.08, 121.23), ("가오슝", ["가오슝", "KAOHSIUNG"], 22.63, 120.30)],
}
_CITIES = None


def load_cities():
    global _CITIES
    if _CITIES is None:
        try:
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "cities.json"), encoding="utf-8") as f:
                _CITIES = json.load(f)["cities"]
        except (FileNotFoundError, json.JSONDecodeError):
            _CITIES = {}
    return _CITIES


def locate(country, text):
    """공시의 지역·공사명 글자에서 그 나라의 도시(또는 알려진 현장)를 찾아 (이름, 위도, 경도)를 돌려준다"""
    n = norm(text)
    if not n:
        return None
    best = None  # (매칭 길이, 인구, 이름, lat, lon)
    for ko, names, lat, lon in SITE_EXTRAS.get(country, []):
        for nm in names:
            if norm(nm) in n:
                cand = (len(norm(nm)) + 100, 0, ko, lat, lon)  # 현장 이름은 도시보다 우선
                best = max(best, cand) if best else cand
    for c in load_cities().get(country, []):
        for nm in c["names"]:
            k = norm(nm)
            is_ko = bool(re.match(r"[가-힣]", nm))
            if (is_ko and len(k) < 2) or (not is_ko and len(k) < 4) or norm(country) == k:
                continue
            if k in n:
                cand = (len(k), c["pop"], c["ko"], c["lat"], c["lon"])
                best = max(best, cand) if best else cand
    return best[2:] if best else None


def is_domestic(text):
    return any(w in (text or "") for w in DOMESTIC_WORDS)


def fmt_amount(raw):
    # 금액 칸에 "558,625,200,000 6.46"(매출액 대비 %)이나 설명 문장이 같이 들어오는 경우가 있어서,
    # 칸 안의 숫자들 중 1억 원 이상인 가장 큰 숫자(원화 계약금액)를 고른다. 숫자를 이어 붙이지 않는다.
    nums = []
    for m in re.finditer(r"\d{1,3}(?:,\d{3})+|\d{9,}", raw or ""):
        v = int(m.group(0).replace(",", ""))
        if 1e8 <= v < 1e15:
            nums.append(v)
    if not nums:
        return ""
    won = max(nums)
    eok = won / 1e8
    if eok >= 10000:
        jo = int(eok // 10000)
        rest = int(round(eok - jo * 10000))
        return f"{jo}조 {rest:,}억원" if rest else f"{jo}조원"
    return f"{eok:,.0f}억원"


def parse_date(s):
    m = re.search(r"(\d{4})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})", s or "")
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def status_of(start, end):
    today = date.today()
    if start and start > today:
        return "수주"
    if end and end < today:
        return "준공"
    return "공사중"


def main():
    key = os.environ.get("DART_API_KEY", "").strip()
    if not key:
        print("[오류] DART_API_KEY가 등록되지 않았습니다.", file=sys.stderr)
        sys.exit(1)

    centers = load_countries()
    try:
        with open(CACHE_PATH, encoding="utf-8") as f:
            cache = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        cache = {}
    with open(PROJECTS_PATH, encoding="utf-8") as f:
        data = json.load(f)

    listed = load_corp_codes(key)
    bgn = (date.today() - timedelta(days=LOOKBACK_MONTHS * 31)).strftime("%Y%m%d")

    auto_projects, company_defs = {}, {}
    total_filings = overseas = domestic = unknown = failed = 0
    new_docs = postponed = 0
    started = time.time()

    for names, cid, cname, short, color in TARGETS:
        corp_code = next((listed[n] for n in names if n in listed), None)
        if not corp_code:
            print(f"[안내] 상장사 목록에서 '{names[0]}'을(를) 찾지 못해 건너뜁니다.")
            continue
        try:
            filings = list_contract_filings(key, corp_code, bgn)
        except Exception as exc:
            print(f"[경고] {cname} 공시 목록 조회 실패: {exc}", file=sys.stderr)
            continue
        total_filings += len(filings)
        found = 0
        # 오래된 공시부터 처리 → 같은 계약의 정정공시가 나중에 덮어쓴다
        for it in sorted(filings, key=lambda x: x["rcept_no"]):
            rno = it["rcept_no"]
            if rno not in cache:
                if new_docs >= MAX_NEW_DOCS_PER_RUN or time.time() - started > TIME_BUDGET_SEC:
                    postponed += 1
                    continue
                new_docs += 1
                t0 = time.time()
                try:
                    cache[rno] = parse_contract(fetch_document_html(key, rno))
                    time.sleep(0.3)
                except Exception as exc:
                    failed += 1
                    print(f"[경고] {cname} {rno} 원문 읽기 실패: {exc}", file=sys.stderr)
                    continue
                if new_docs % 10 == 0:
                    print(f"  … 새 공시 원문 {new_docs}건 읽음 (최근 1건 {time.time() - t0:.1f}초, 누적 {time.time() - started:.0f}초)")
            info = cache[rno]
            name = (info.get("name") or "").strip()
            region = info.get("region") or ""
            if not name:
                failed += 1
                continue
            if cid in CONSTRUCTION_ONLY and not any(w in name + (info.get("kind") or "") for w in CONSTRUCTION_WORDS):
                continue
            # 선박 건조 계약(유조선 3척 등)은 국내 조선소에서 짓고 '지역'이 선주 국적이라 해외 현장이 아니다
            if SHIP_PATTERN.search(name):
                continue
            country = detect_country(region, centers) or detect_country(name, centers)
            if not country or country == "대한민국":
                if is_domestic(region) or country == "대한민국":
                    domestic += 1
                else:
                    unknown += 1
                    print(f"[안내] 나라를 못 찾음: {cname} · {name[:40]} · 지역='{region[:30]}'")
                continue
            start, end = parse_date(info.get("start")), parse_date(info.get("end"))
            period = ""
            if start or end:
                period = f"{start.isoformat() if start else '?'} ~ {end.isoformat() if end else '?'}"
            key_name = f"{cid}|{norm(name)[:40]}"
            lat, lon = centers[country]
            city = ""
            spot = locate(country, f"{region} {name}")
            if spot:
                city, lat, lon = spot
            auto_projects[key_name] = {
                "company": cid,
                "name": name,
                "country": country,
                "city": city,
                "lat": lat,
                "lon": lon,
                "type": info.get("kind") or "공사수주",
                "status": status_of(start, end),
                "amount": fmt_amount(info.get("amount")),
                "period": period,
                "note": f"발주처: {info.get('counterparty')}" if info.get("counterparty") else "",
                "link": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rno}",
                "auto": True,
                "rceptNo": rno,
                "filedAt": it.get("rcept_dt", ""),
            }
            company_defs[cid] = (cname, short, color)
            found += 1
        overseas += found
        print(f"{cname}: 계약 공시 {len(filings)}건 → 해외 {found}건")

    # 담당자가 손으로 넣은 위치 보정(overrides) 적용
    overrides = data.get("overrides", {})
    for p in auto_projects.values():
        o = overrides.get(p["rceptNo"])
        if o:
            p.update({k: v for k, v in o.items() if k in ("lat", "lon", "city", "name", "status", "note")})

    # 이번에 원문을 다 못 읽었으면(나눠 읽는 중) 기존 자동 현장 중 이번 결과에 없는 것도 남겨 둔다
    if postponed:
        have = {p["rceptNo"] for p in auto_projects.values()}
        for p in data.get("projects", []):
            if p.get("auto") and p.get("rceptNo") not in have:
                auto_projects[f"keep|{p.get('rceptNo')}"] = p

    # 손으로 넣은 현장은 그대로, 자동 수집분만 교체
    manual = [p for p in data.get("projects", []) if not p.get("auto")]

    # 손으로 넣은 현장과 같은 공사가 공시로도 잡히면(예: 비스마야) 두 번 표시되지 않게 하나로 합친다.
    # 위치·이름은 손으로 넣은 것을 쓰고, 금액·기간·공시 링크만 공시에서 가져온다.
    for mp in manual:
        for k, ap in list(auto_projects.items()):
            if same_project(mp, ap):
                for field in ("amount", "period", "link", "rceptNo", "filedAt"):
                    if ap.get(field):
                        mp[field] = ap[field]
                if not mp.get("type"):
                    mp["type"] = ap.get("type", "")
                mp["dartName"] = ap["name"]
                del auto_projects[k]
                print(f"[안내] 직접 넣은 현장 '{mp['name']}'과 공시 '{ap['name']}'을 하나로 합침")
    projects = manual + sorted(auto_projects.values(), key=lambda p: p.get("filedAt", ""), reverse=True)

    companies = data.get("companies", [])
    known = {c["id"] for c in companies}
    for i, (cid, (cname, short, color)) in enumerate(company_defs.items()):
        if cid not in known:
            companies.append({"id": cid, "name": cname, "short": short, "color": color or PALETTE[i % len(PALETTE)], "logo": ""})

    data["companies"] = companies
    data["projects"] = projects
    data["overrides"] = overrides
    data["updatedAt"] = date.today().isoformat()
    data["autoSource"] = f"DART 단일판매·공급계약체결 공시 (최근 {LOOKBACK_MONTHS}개월)"

    with open(PROJECTS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=0)

    print(f"합계: 계약 공시 {total_filings}건 중 해외 {overseas}건 · 국내 {domestic}건 · 나라 불명 {unknown}건 · 읽기 실패 {failed}건")
    print(f"이번 실행: 새 원문 {new_docs}건 읽음 · 소요 {time.time() - started:.0f}초")
    if postponed:
        print(f"[안내] 시간·건수 제한으로 {postponed}건은 다음 실행 때 이어서 읽습니다. (Run workflow를 몇 번 더 누르면 빨리 채워집니다)")
    print(f"지도 현장: 수동 {len(manual)}곳 + 자동 {len(auto_projects)}곳")


if __name__ == "__main__":
    main()
