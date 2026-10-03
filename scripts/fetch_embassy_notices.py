"""
중동·주변국 대한민국 대사관의 공지를 모아 embassy-notices.json 으로 저장합니다.
(기타 정보 > 중동 각국 대사관 공지)

외교부 공공데이터 API 두 가지를 나라별로 조회해 합칩니다.
  1) 외교부_국가·지역별 안전공지   (CountrySafetyService6)  → 종류: 안전공지
  2) 외교부_국가별 공지사항        (NoticeService2)         → 종류: 공지사항
     ※ 2)는 공공데이터포털에서 따로 '활용신청'이 필요합니다. 신청 전에는 1)만 모입니다.

인증키: GitHub Secrets 의 MOFA_API_KEY (대사관 공지용 공공데이터포털 키)
"""

import html
import json
import xml.etree.ElementTree as ET
import os
import re
import sys
import time
from datetime import datetime, timezone
from urllib.parse import quote

import requests

OUTPUT_PATH = "embassy-notices.json"
PER_COUNTRY = 10   # 나라·종류별 최근 공지 수
MAX_ITEMS = 200

COUNTRIES = [
    ("IQ", "이라크"), ("IR", "이란"), ("SY", "시리아"), ("JO", "요르단"), ("SA", "사우디아라비아"),
    ("KW", "쿠웨이트"), ("TR", "튀르키예"), ("LB", "레바논"), ("IL", "이스라엘"), ("PS", "팔레스타인"),
    ("EG", "이집트"), ("AE", "아랍에미리트"), ("QA", "카타르"), ("BH", "바레인"), ("OM", "오만"), ("YE", "예멘"),
]
SOURCES = [
    ("안전공지", "https://apis.data.go.kr/1262000/CountrySafetyService6/getCountrySafetyList6"),
    # 외교부_국가별 공지사항 목록조회 (End Point: .../CountryNoticeService, XML 응답)
    # 세부 기능 이름이 문서마다 달라 아래 후보를 차례로 시도한다
    ("공지사항", [
        "https://apis.data.go.kr/1262000/CountryNoticeService/getCountryNoticeList",
        "https://apis.data.go.kr/1262000/CountryNoticeService/getCountryNoticeList2",
        "https://apis.data.go.kr/1262000/CountryNoticeService/getNoticeList",
    ]),
]


# 공공데이터포털 계정이 여러 개일 수 있어서, 등록된 키를 모두 모아 두고 API마다 되는 키를 찾아 쓴다
KEY_NAMES = ["MOFA_API_KEY", "NOTICE_API_KEY", "TRAVEL_API_KEY", "KDCA_API_KEY"]


def service_keys():
    keys = []
    for n in KEY_NAMES:
        k = (os.environ.get(n) or "").strip()
        if k:
            k = k if "%" in k else quote(k, safe="")
            if k not in [x for _, x in keys]:
                keys.append((n, k))
    if not keys:
        print("[오류] 공공데이터포털 인증키가 하나도 없습니다 (MOFA_API_KEY 등).", file=sys.stderr)
        sys.exit(1)
    return keys


def call(url, key, params):
    """serviceKey 는 URL에 직접 붙이고(이중 인코딩 방지), 나머지는 requests 에 맡긴다"""
    r = requests.get(f"{url}?serviceKey={key}", params=params, timeout=30)
    text = r.text.strip()
    if text.startswith("<"):
        return xml_to_json(text, r.status_code)
    try:
        j = r.json()
    except ValueError:
        return None, f"JSON 아님: {text[:200]}"
    err = (j.get("OpenAPI_ServiceResponse") or {}).get("cmmMsgHeader")
    if err:
        return None, f"{err.get('errMsg')} ({err.get('returnAuthMsg')})"
    return j, None


def xml_to_json(text, status):
    """XML 응답을 JSON과 같은 모양으로 바꾼다 (<item> 마다 하위 태그 이름: 값)"""
    try:
        root = ET.fromstring(text.encode("utf-8"))
    except ET.ParseError:
        return None, f"HTTP {status} 읽을 수 없는 응답: {text[:200]}"
    if root.tag == "OpenAPI_ServiceResponse":
        msg = root.findtext(".//errMsg") or ""
        auth = root.findtext(".//returnAuthMsg") or ""
        return None, f"{msg} ({auth})"
    code = root.findtext(".//header/resultCode") or root.findtext(".//resultCode")
    if code and code not in ("00", "0", "INFO-000"):
        return None, f"resultCode {code}: {root.findtext('.//resultMsg')}"
    items = [{c.tag: (c.text or "").strip() for c in it} for it in root.iter("item")]
    total = root.findtext(".//totalCount")
    return {"response": {"body": {"items": items, "totalCount": total}}}, None


def rows_of(j):
    if isinstance(j.get("data"), list):
        return j["data"]
    body = (j.get("response") or {}).get("body") or {}
    items = body.get("items") or []
    if isinstance(items, dict):
        items = items.get("item") or []
    if isinstance(items, dict):
        items = [items]
    return items


def field(item, *keys):
    norm = {str(k).lower().replace("_", ""): v for k, v in item.items()}
    for k in keys:
        v = norm.get(k.lower().replace("_", ""))
        if v not in (None, ""):
            return v
    return ""


def clean_body(raw):
    if not raw:
        return ""
    text = html.unescape(html.unescape(str(raw)))
    text = re.sub(r"<[^<]+?>", " ", text)
    return re.sub(r"\s+", " ", text).strip()[:3000]


def date_key(d):
    return re.sub(r"[^0-9]", "", str(d or ""))[:14]


def fetch_country(url, key, iso2, name):
    """나라 이름으로 걸러 달라고 요청 (API마다 이름이 달라 몇 가지를 차례로 시도)"""
    tries = [
        {"cond[country_nm::EQ]": name},
        {"cond[country_iso_alp2::EQ]": iso2},
        {"isoCode1": iso2},
        {"country_nm": name},
    ]
    last_err = None
    for extra in tries:
        params = {"returnType": "JSON", "type": "json", "numOfRows": 50, "pageNo": 1, **extra}
        j, err = call(url, key, params)
        if err:
            last_err = err
            if "NOT_REGISTERED" in err or "등록되지 않은" in err:
                return None, err   # 신청 안 된 API면 더 시도할 필요 없음
            continue
        items = rows_of(j)
        mine = [it for it in items
                if str(field(it, "country_nm", "countryName", "countryNm")) == name
                or str(field(it, "country_iso_alp2", "isoCode", "isoCode1", "countryIsoAlp2")).upper() == iso2]
        if mine:
            return mine, None
        last_err = f"0건 (조건 {list(extra)[0]}, 받은 행 {len(items)})"
    return [], last_err


def pick_key(urls, keys):
    """이 API를 신청해 둔 계정의 키와, 실제로 동작하는 주소를 찾는다"""
    urls = urls if isinstance(urls, list) else [urls]
    last = None
    for name, k in keys:
        for url in urls:
            j, err = call(url, k, {"returnType": "JSON", "type": "json", "numOfRows": 1, "pageNo": 1})
            if not err:
                return name, k, url, None
            last = f"{name} · {url.rsplit('/', 1)[-1]}: {err}"
            print(f"  시도 실패 → {last}")
            if "NOT_REGISTERED" in str(err) or "등록되지 않은" in str(err):
                break  # 이 키로는 이 API 자체가 안 됨 → 다음 키
    return None, None, None, last


COUNTRY_KEYS = ("country_nm", "countryName", "country_name", "countryNm", "country_iso_alp2", "isoCode", "isoCode1", "iso_code", "countryIsoAlp2")


def total_of(j):
    body = (j.get("response") or {}).get("body") or {}
    t = j.get("totalCount") or body.get("totalCount")
    try:
        return int(str(t).replace(",", ""))
    except (TypeError, ValueError):
        return None


def group_all(url, key):
    """조건 없이 전체를 쪽(page)마다 끝까지 받아서 나라별로 나눈다. 나라 정보가 없으면 None
    (첫 쪽만 받으면 오래된 공지나 가나다순 앞쪽 나라만 들어올 수 있어서 끝까지 받는다)"""
    items, page, total = [], 1, None
    while page <= 30:
        j, err = call(url, key, {"returnType": "JSON", "type": "json", "numOfRows": 1000, "pageNo": page})
        if err:
            if page == 1:
                return None, err
            break
        got = rows_of(j)
        total = total_of(j) if total is None else total
        items.extend(got)
        if not got or (total and len(items) >= total) or len(got) < 1000:
            break
        page += 1
    print(f"  전체 {len(items)}행 받음" + (f" (총 {total})" if total else ""))
    if items:
        names = sorted({str(field(it, "country_nm", "countryName", "country_name", "countryNm")) for it in items})
        print(f"  나라 이름 예시: {names[:12]} … (총 {len(names)}개국)")
    if items:
        print("  받은 항목 예시 필드:", list(items[0].keys()))
    if not items or not any(field(it, *COUNTRY_KEYS) for it in items):
        return None, f"나라 정보 없는 응답 ({len(items)}행)"
    by = {}
    for it in items:
        cn = str(field(it, "country_nm", "countryName", "country_name", "countryNm"))
        iso = str(field(it, "country_iso_alp2", "isoCode", "isoCode1", "iso_code", "countryIsoAlp2")).upper()
        for iso2, name in COUNTRIES:
            if cn == name or iso == iso2:
                by.setdefault(iso2, []).append(it)
    return by, None


def main():
    keys = service_keys()
    notices, counts, source_ok = [], {}, {}
    for kind, url in SOURCES:
        ok_any = False
        key_name, key, url, err = pick_key(url, keys)
        if not key:
            print(f"[{kind}] 사용할 수 없음 ({err})")
            print(f"        → 공공데이터포털에서 이 API를 활용신청하고, 그 계정의 키를 GitHub Secrets에 등록하면 '{kind}'도 모입니다.")
            source_ok[kind] = False
            continue
        print(f"[{kind}] {key_name} 키 사용 · {url.rsplit('/', 1)[-1]}")
        grouped, gerr = group_all(url, key)
        if grouped is None:
            print(f"  (한꺼번에 받기 불가: {gerr}) → 나라별로 따로 요청")
        for iso2, name in COUNTRIES:
            if grouped is not None:
                items, err = grouped.get(iso2, []), None
            else:
                items, err = fetch_country(url, key, iso2, name)
            if items is None:
                print(f"[{kind}] 사용할 수 없음: {err}")
                if "NOT_REGISTERED" in str(err):
                    print(f"        → 공공데이터포털에서 이 API를 활용신청하면 '{kind}'도 함께 모입니다.")
                break
            ok_any = True
            items.sort(key=lambda it: date_key(field(it, "wrt_dt", "wrtDt", "regDt", "reg_dt", "등록일", "writeDate")), reverse=True)
            for it in items[:PER_COUNTRY]:
                notices.append({
                    "kind": kind,
                    "title": field(it, "title", "제목", "ttl"),
                    "body": clean_body(field(it, "txt_origin_cn", "txtOriginCn", "content", "contents", "내용")),
                    "date": field(it, "wrt_dt", "wrtDt", "regDt", "reg_dt", "등록일", "writeDate"),
                    "country": name, "iso2": iso2,
                    "file": field(it, "file_download_url", "fileDownloadUrl", "file_url", "fileUrl", "file_path", "filePath"),
                })
            counts[iso2] = counts.get(iso2, 0) + min(len(items), PER_COUNTRY)
            print(f"[{kind}] {name}: {len(items)}건" + (f" ({err})" if err and not items else ""))
            time.sleep(0.2)
        source_ok[kind] = ok_any

    if not any(source_ok.values()):
        print("[오류] 어떤 공지 API도 사용할 수 없었습니다. 기존 파일을 유지합니다.", file=sys.stderr)
        sys.exit(1)

    # 같은 공지가 두 API에 다 있으면 하나만
    seen, uniq = set(), []
    for n in sorted(notices, key=lambda n: date_key(n["date"]), reverse=True):
        k = (n["iso2"], re.sub(r"\s+", "", n["title"])[:40])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(n)

    output = {
        "_readme": "이 파일은 GitHub Actions가 외교부 공공데이터 API로 자동 생성/갱신합니다. 직접 수정하지 마세요.",
        "country": "중동·주변국",
        "sources": source_ok,
        "countries": [{"iso2": i, "name": n, "count": counts.get(i, 0)} for i, n in COUNTRIES],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "items": uniq[:MAX_ITEMS],
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"{len(output['items'])}건 저장 (안전공지 {'O' if source_ok.get('안전공지') else 'X'}, 공지사항 {'O' if source_ok.get('공지사항') else 'X'}) → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
