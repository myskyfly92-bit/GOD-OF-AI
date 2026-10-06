"""
중동·주변국 대한민국 대사관 공지를 모아 embassy-notices.json 으로 저장합니다.
(기타 정보 > 중동 각국 대사관 공지)

1) 공지사항: 외교부_국가별 공지사항 (CountryNoticeService, XML)
   - 목록: getCountryNoticeList?isoCode1=IRQ&isoCode2=IRN... (세 자리 국가코드, 한 번에 10개국까지)
   - 본문: getCountryNoticeInfo?id=...  (목록에는 본문이 없어서 최근 공지만 따로 불러옴)
   ※ 기술문서 '외교부_기술문서_국가별 공지사항 목록조회_v2.0' 기준
2) 안전공지: 외교부_국가·지역별 안전공지 (CountrySafetyService7, JSON) — 2026년에 6 → 7로 버전이 바뀜

인증키: 공공데이터포털 계정이 여러 개일 수 있어 등록된 키를 모두 시도합니다.
        KOSHA_API_KEY, MOFA_API_KEY, NOTICE_API_KEY, TRAVEL_API_KEY, KDCA_API_KEY
"""

import html
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.parse import quote

import requests

OUTPUT_PATH = "embassy-notices.json"
PER_COUNTRY = 10      # 나라·종류별 최근 공지 수
BODY_PER_COUNTRY = 5  # 본문까지 불러올 최근 공지 수 (나라별)
MAX_ITEMS = 250

# (ISO 2자리, ISO 3자리, 한글 이름)
COUNTRIES = [
    ("IQ", "IRQ", "이라크"), ("IR", "IRN", "이란"), ("SY", "SYR", "시리아"), ("JO", "JOR", "요르단"),
    ("SA", "SAU", "사우디아라비아"), ("KW", "KWT", "쿠웨이트"), ("TR", "TUR", "튀르키예"), ("LB", "LBN", "레바논"),
    ("IL", "ISR", "이스라엘"), ("PS", "PSE", "팔레스타인"), ("EG", "EGY", "이집트"), ("AE", "ARE", "아랍에미리트"),
    ("QA", "QAT", "카타르"), ("BH", "BHR", "바레인"), ("OM", "OMN", "오만"), ("YE", "YEM", "예멘"),
]
NOTICE_LIST = "https://apis.data.go.kr/1262000/CountryNoticeService/getCountryNoticeList"
NOTICE_INFO = "https://apis.data.go.kr/1262000/CountryNoticeService/getCountryNoticeInfo"
SAFETY_LIST = "https://apis.data.go.kr/1262000/CountrySafetyService7/getCountrySafetyList7"
KEY_NAMES = ["KOSHA_API_KEY", "MOFA_API_KEY", "NOTICE_API_KEY", "TRAVEL_API_KEY", "KDCA_API_KEY"]


def service_keys():
    keys = []
    for n in KEY_NAMES:
        k = (os.environ.get(n) or "").strip()
        if k:
            k = k if "%" in k else quote(k, safe="")
            if k not in [x for _, x in keys]:
                keys.append((n, k))
    if not keys:
        print("[오류] 공공데이터포털 인증키가 하나도 없습니다.", file=sys.stderr)
        sys.exit(1)
    return keys


def get(url, key, params):
    """serviceKey 는 이미 인코딩된 값을 URL에 직접 붙인다. 응답은 XML이든 JSON이든 (items, total, err) 로."""
    r = requests.get(f"{url}?serviceKey={key}", params=params, timeout=30)
    text = r.text.strip()
    get.last = text  # 문제 확인용: 마지막 응답 원문
    if text.startswith("<"):
        try:
            root = ET.fromstring(text.encode("utf-8"))
        except ET.ParseError:
            return [], 0, f"HTTP {r.status_code} 읽을 수 없는 응답: {text[:150]}"
        if root.tag == "OpenAPI_ServiceResponse":
            return [], 0, f"{root.findtext('.//errMsg')} ({root.findtext('.//returnAuthMsg')})"
        code = (root.findtext(".//resultCode") or "00").strip()
        if code not in ("00", "0"):
            return [], 0, f"resultCode {code}: {root.findtext('.//resultMsg')}"
        items = [{c.tag: (c.text or "").strip() for c in it} for it in root.iter("item")]
        try:
            total = int(root.findtext(".//totalCount") or 0)
        except ValueError:
            total = 0
        return items, total, None
    try:
        j = r.json()
    except ValueError:
        return [], 0, f"HTTP {r.status_code} 응답 형식 오류: {text[:150]}"
    err = (j.get("OpenAPI_ServiceResponse") or {}).get("cmmMsgHeader")
    if err:
        return [], 0, f"{err.get('errMsg')} ({err.get('returnAuthMsg')})"
    if isinstance(j.get("data"), list):
        return j["data"], int(j.get("totalCount") or len(j["data"])), None
    body = (j.get("response") or {}).get("body") or {}
    items = body.get("items") or []
    if isinstance(items, dict):
        items = items.get("item") or []
    if isinstance(items, dict):
        items = [items]
    return items, int(body.get("totalCount") or len(items)), None


def field(item, *keys):
    norm = {str(k).lower().replace("_", ""): v for k, v in item.items()}
    for k in keys:
        v = norm.get(k.lower().replace("_", ""))
        if v not in (None, ""):
            return v
    return ""


def clean(raw):
    if not raw:
        return ""
    t = html.unescape(html.unescape(str(raw)))
    t = re.sub(r"<[^<]+?>", " ", t)
    return re.sub(r"\s+", " ", t).strip()[:3000]


def clean_body(raw):
    """HTML 본문을 문단 줄바꿈은 살린 글자로 (안전공지 본문용)"""
    if not raw:
        return ""
    t = html.unescape(str(raw))
    t = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>", "\n", t)
    t = re.sub(r"<[^<]+?>", "", t)
    t = html.unescape(t).replace("\u00a0", " ")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in t.split("\n")]
    out = []
    for ln in lines:
        if ln or (out and out[-1]):
            out.append(ln)
    return "\n".join(out).strip()[:3000]


def date_key(d):
    return re.sub(r"[^0-9]", "", str(d or ""))[:14]


def which_country(it, asked=None):
    iso3 = str(field(it, "isoCode", "iso_code")).upper()
    name = str(field(it, "countryName", "country_nm", "countryNm"))
    for iso2, i3, nm in COUNTRIES:
        if iso3 == i3 or name == nm:
            return iso2, nm
    return asked if asked else (None, None)


# ---------- 1) 공지사항 ----------
def collect_notices(keys):
    # 이 API를 신청해 둔 계정의 키 찾기
    key, key_name, err = None, None, None
    for n, k in keys:
        _, _, e = get(NOTICE_LIST, k, {"numOfRows": 1, "pageNo": 1, "isoCode1": "IRQ"})
        if not e:
            key, key_name = k, n
            break
        err = f"{n}: {e}"
        print(f"  [공지사항] 시도 실패 → {err}")
    if not key:
        return None, err
    print(f"[공지사항] {key_name} 키 사용")

    found = {}
    # 한 나라씩 요청 (나라가 섞여 오면 어느 나라 공지인지 헷갈릴 수 있어서)
    for iso2, iso3, name in COUNTRIES:
        items, total, e = get(NOTICE_LIST, key, {"numOfRows": 50, "pageNo": 1, "isoCode1": iso3})
        if e:
            print(f"  {name}: 실패 ({e})")
            continue
        if not items and iso2 == "IQ":
            # 이라크가 0건이면 응답 원문 앞부분을 로그에 남긴다 (형식 확인용)
            print("  [확인용] 이라크 응답 원문:", re.sub(r"\s+", " ", getattr(get, "last", ""))[:600])
            # 조건 없이 전체 목록도 한 번 받아 본다
            allit, alltot, ae = get(NOTICE_LIST, key, {"numOfRows": 20, "pageNo": 1})
            print(f"  [확인용] 조건 없이 받기: {len(allit)}건 (전체 {alltot}) {ae or ''}")
            if allit:
                print("  [확인용] 예시:", json.dumps(allit[:2], ensure_ascii=False)[:600])
        items.sort(key=lambda it: date_key(field(it, "wrtDt")), reverse=True)
        found[iso2] = (name, items[:PER_COUNTRY])
        print(f"  {name}: {len(items)}건 (전체 {total})" + (f" · 필드 {list(items[0].keys())}" if items and iso2 == "IQ" else ""))
        time.sleep(0.15)

    out = []
    for iso2, (name, items) in found.items():
        for i, it in enumerate(items):
            body = ""
            nid = str(field(it, "id")).strip()
            if nid and i < BODY_PER_COUNTRY:
                info, _, e = get(NOTICE_INFO, key, {"id": nid})
                if info:
                    body = clean(field(info[0], "ctntText") or field(info[0], "ctntHtml"))
                time.sleep(0.1)
            out.append({
                "kind": "공지사항", "title": field(it, "title"), "body": body,
                "date": str(field(it, "wrtDt"))[:10], "country": name, "iso2": iso2,
                "file": "" if field(it, "fileUrl") in ("", "NO_ATT_FILE") else field(it, "fileUrl"),
            })
    return out, None


# ---------- 2) 안전공지 ----------
def collect_safety(keys):
    variants = [
        lambda iso2, nm: {"returnType": "JSON", "numOfRows": 30, "pageNo": 1, "cond[country_iso_alp2::EQ]": iso2},
        lambda iso2, nm: {"returnType": "JSON", "numOfRows": 30, "pageNo": 1, "cond[country_nm::EQ]": nm},
        lambda iso2, nm: {"numOfRows": 30, "pageNo": 1, "country_nm": nm},
    ]
    key = variant = None
    err = None
    for n, k in keys:
        for v in variants:
            _, _, e = get(SAFETY_LIST, k, v("IQ", "이라크"))
            if not e:
                key, variant = k, v
                print(f"[안전공지] {n} 키 사용 · 요청 방식 {list(v('IQ', '이라크'))[-1]}")
                break
            err = f"{n}: {e}"
            print(f"  [안전공지] 시도 실패 → {err}")
            if "NOT_REGISTERED" in str(e) or "등록되지 않은" in str(e):
                break
        if key:
            break
    if not key:
        return None, err
    out = []
    for iso2, iso3, name in COUNTRIES:
        items, _, e = get(SAFETY_LIST, key, variant(iso2, name))
        if e:
            print(f"  {name}: 실패 ({e})")
            continue
        mine = [it for it in items if which_country(it)[0] in (None, iso2)
                and (not field(it, "country_nm", "countryName") or field(it, "country_nm", "countryName") == name)]
        mine.sort(key=lambda it: date_key(field(it, "wrt_dt", "wrtDt")), reverse=True)
        print(f"  {name}: {len(mine)}건")
        for it in mine[:PER_COUNTRY]:
            out.append({
                "kind": "안전공지", "title": field(it, "title"),
                "body": clean_body(field(it, "txt_origin_cn", "content", "ctntText")),
                "date": str(field(it, "wrt_dt", "wrtDt"))[:10], "country": name, "iso2": iso2, "file": "",
            })
        time.sleep(0.15)
    return out, None


def main():
    keys = service_keys()
    notices, sources = [], {}
    for kind, fn in (("공지사항", collect_notices), ("안전공지", collect_safety)):
        try:
            got, err = fn(keys)
        except Exception as e:  # 한쪽이 실패해도 다른 쪽은 저장
            got, err = None, str(e)
        sources[kind] = got is not None
        if got is None:
            print(f"[{kind}] 사용할 수 없음 ({err})")
        else:
            notices.extend(got)

    if not any(sources.values()):
        print("[오류] 어떤 공지 API도 사용할 수 없었습니다. 기존 파일을 유지합니다.", file=sys.stderr)
        sys.exit(1)

    seen, uniq = set(), []
    for n in sorted(notices, key=lambda n: date_key(n["date"]), reverse=True):
        k = (n["iso2"], re.sub(r"\s+", "", n["title"])[:40])
        if n["title"] and k not in seen:
            seen.add(k)
            uniq.append(n)
    counts = {}
    for n in uniq:
        counts[n["iso2"]] = counts.get(n["iso2"], 0) + 1
    output = {
        "_readme": "이 파일은 GitHub Actions가 외교부 공공데이터 API로 자동 생성/갱신합니다. 직접 수정하지 마세요.",
        "country": "중동·주변국",
        "sources": sources,
        "countries": [{"iso2": a, "name": c, "count": counts.get(a, 0)} for a, _, c in COUNTRIES],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "items": uniq[:MAX_ITEMS],
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"{len(output['items'])}건 저장 (공지사항 {'O' if sources.get('공지사항') else 'X'}, 안전공지 {'O' if sources.get('안전공지') else 'X'})")


if __name__ == "__main__":
    main()
