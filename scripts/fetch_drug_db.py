"""
보건 > 의약품 검색용 데이터 (식품의약품안전처 공공데이터)

공공데이터포털에서 아래 API를 받아 drug-db/ 폴더에 JSON 으로 저장합니다.
  1) 의약품 제품 허가정보 (DrugPrdtPrmsnInfoService08 / getDrugPrdtPrmsnInq08)
       → drug-db/index.json : 모든 허가 의약품 (이름·영문명·업체·전문/일반·분류·영문 성분)
  2) 의약품개요정보 e약은요 (DrbEasyDrugInfoService / getDrbEasyDrugList)
       → drug-db/otc-0.json ~ otc-9.json : 일반의약품 효능·용법·주의사항 (품목코드 끝자리로 나눠 저장)
  3) 의약품 낱알식별 정보 (MdcinGrnIdntfcInfoService0N / getMdcinGrnIdntfcInfoList0N)
       → drug-db/pills.json : 알약 모양·색·각인·분할선·사진 (모양으로 찾기)

- 인증키: 이 API들을 활용신청한 공공데이터포털 계정의 키.
  MFDS_API_KEY → KDCA_API_KEY → MOFA_API_KEY 순서로 찾고, 실제로 응답이 오는 키를 씁니다.
- 한 API가 실패해도(활용신청 전 등) 나머지는 저장하고, 예전 파일은 지우지 않습니다.
- 출처: 식품의약품안전처 (공공누리 제1유형)
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from urllib.parse import quote

import requests

BASE = "https://apis.data.go.kr/1471000/"
OUT_DIR = "drug-db"
PERMIT = ("DrugPrdtPrmsnInfoService08", "getDrugPrdtPrmsnInq08")
EASY = ("DrbEasyDrugInfoService", "getDrbEasyDrugList")
# 낱알식별은 버전 번호가 바뀌어 왔으므로 차례로 시도
PILL_CANDIDATES = [("MdcinGrnIdntfcInfoService03", "getMdcinGrnIdntfcInfoList03"),
                   ("MdcinGrnIdntfcInfoService02", "getMdcinGrnIdntfcInfoList02"),
                   ("MdcinGrnIdntfcInfoService01", "getMdcinGrnIdntfcInfoList01")]
IMG_PREFIX = "https://nedrug.mfds.go.kr/pbp/cmn/itemImageDownload/"


def keys():
    out = []
    for name in ("MFDS_API_KEY", "KDCA_API_KEY", "MOFA_API_KEY"):
        k = (os.environ.get(name) or "").strip()
        if k and k not in [x[1] for x in out]:
            out.append((name, k))
    if not out:
        print("[오류] 공공데이터포털 인증키가 없습니다 (MFDS_API_KEY 시크릿을 등록하세요).", file=sys.stderr)
        sys.exit(1)
    return out


def enc(k):
    return k if "%" in k else quote(k, safe="")


def call(key, svc, op, page, rows, extra=""):
    url = f"{BASE}{svc}/{op}?serviceKey={enc(key)}&type=json&pageNo={page}&numOfRows={rows}{extra}"
    for attempt in range(4):
        try:
            r = requests.get(url, timeout=60)
            t = r.text.strip()
            if r.status_code == 200 and t.startswith("{"):
                j = r.json()
                hdr = j.get("header") or (j.get("response") or {}).get("header") or {}
                body = j.get("body") or (j.get("response") or {}).get("body") or {}
                code = str(hdr.get("resultCode", "00"))
                if code not in ("00", "0"):
                    return None, f"resultCode {code} {hdr.get('resultMsg', '')}"
                items = body.get("items") or []
                if isinstance(items, dict):
                    items = items.get("item") or []
                if isinstance(items, dict):
                    items = [items]
                total = int(str(body.get("totalCount", "0")).replace(",", "") or 0)
                return (items, total), None
            err = f"HTTP {r.status_code}: {re.sub(r'<[^>]+>', ' ', t)[:200]}"
            if r.status_code in (401, 403) or "SERVICE_KEY" in t or "NO_OPENAPI" in t or "SERVICE ACCESS DENIED" in t.upper():
                return None, err
        except Exception as e:  # 네트워크 오류는 잠깐 쉬었다 다시
            err = str(e)
        time.sleep(2 + attempt * 3)
    return None, err


def pick_key(all_keys, svc, op):
    """이 API에 실제로 응답하는 키를 찾는다."""
    errs = []
    for name, k in all_keys:
        res, err = call(k, svc, op, 1, 1)
        if res is not None:
            print(f"  - {svc}: {name} 키로 응답 확인 (전체 {res[1]:,}건)")
            if res[0]:
                print("    응답 칸:", ", ".join(sorted(res[0][0].keys())))
            return k, res[1]
        errs.append(f"{name}: {err}")
    print(f"  - {svc}: 응답 없음 → " + " / ".join(errs))
    return None, 0


def fetch_all(key, svc, op, total, rows=100, label=""):
    out, page = [], 1
    pages = (total + rows - 1) // rows
    while page <= pages:
        res, err = call(key, svc, op, page, rows)
        if res is None:
            raise RuntimeError(f"{label} {page}쪽 실패: {err}")
        items, _ = res
        out.extend(items)
        if page % 50 == 0:
            print(f"    {label} {page}/{pages}쪽 · {len(out):,}건")
        if not items:
            break
        page += 1
        time.sleep(0.05)
    return out


def s(v, n=None):
    v = "" if v is None else re.sub(r"<[^>]+>", " ", str(v))
    v = re.sub(r"[ \t]+", " ", v).strip()
    return v[:n] if n else v


def write(name, data):
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, name), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  저장: {OUT_DIR}/{name} ({os.path.getsize(os.path.join(OUT_DIR, name)) / 1024:,.0f} KB)")


def is_cancelled(x):
    for k in ("CANCEL_NAME", "CANCEL_DATE"):
        v = s(x.get(k))
        if k == "CANCEL_NAME" and v and v not in ("정상", "-"):
            return True
        if k == "CANCEL_DATE" and v and v not in ("-", "None"):
            return True
    return False


def main():
    all_keys = keys()
    now = datetime.now(timezone.utc).isoformat()
    meta = {"updatedAt": now, "source": "식품의약품안전처 (공공데이터포털)", "parts": {}}
    ok_any = False

    # 1) 허가 목록 → index.json
    print("[1] 의약품 제품 허가정보")
    k, total = pick_key(all_keys, *PERMIT)
    if k:
        rows = fetch_all(k, *PERMIT, total, label="허가")
        cols = ["seq", "name", "eng", "maker", "makerEng", "kind", "cat", "ingr"]
        data = []
        for x in rows:
            if is_cancelled(x):
                continue
            data.append([s(x.get("ITEM_SEQ")), s(x.get("ITEM_NAME"), 120), s(x.get("ITEM_ENG_NAME"), 120), s(x.get("ENTP_NAME"), 60),
                         s(x.get("ENTP_ENG_NAME"), 60), s(x.get("SPCLTY_PBLC")), s(x.get("PRDUCT_TYPE"), 60), s(x.get("ITEM_INGR_NAME"), 200)])
        write("index.json", {"cols": cols, "rows": data})
        meta["parts"]["index"] = len(data)
        ok_any = True

    # 2) e약은요 → otc-0..9.json
    print("[2] 의약품개요정보 (e약은요)")
    k, total = pick_key(all_keys, *EASY)
    if k:
        rows = fetch_all(k, *EASY, total, label="e약은요")
        shards = {str(i): {} for i in range(10)}
        for x in rows:
            seq = s(x.get("itemSeq"))
            if not seq:
                continue
            shards[seq[-1]][seq] = {
                "name": s(x.get("itemName"), 120), "maker": s(x.get("entpName"), 60),
                "efcy": s(x.get("efcyQesitm"), 700), "use": s(x.get("useMethodQesitm"), 700),
                "warn": s(x.get("atpnWarnQesitm"), 500), "atpn": s(x.get("atpnQesitm"), 900),
                "intrc": s(x.get("intrcQesitm"), 500), "se": s(x.get("seQesitm"), 500),
                "store": s(x.get("depositMethodQesitm"), 200),
            }
        for i, d in shards.items():
            write(f"otc-{i}.json", d)
        meta["parts"]["otc"] = len(rows)
        ok_any = True

    # 3) 낱알식별 → pills.json
    print("[3] 의약품 낱알식별 정보")
    pill = None
    for svc, op in PILL_CANDIDATES:
        k, total = pick_key(all_keys, svc, op)
        if k:
            pill = (k, svc, op, total)
            break
    if pill:
        k, svc, op, total = pill
        rows = fetch_all(k, svc, op, total, label="낱알")
        cols = ["seq", "name", "maker", "front", "back", "shape", "color1", "color2", "lineF", "lineB", "form", "img", "long", "short", "thick", "cls", "kind", "chart"]
        data = []
        for x in rows:
            img = s(x.get("ITEM_IMAGE"))
            data.append([s(x.get("ITEM_SEQ")), s(x.get("ITEM_NAME"), 120), s(x.get("ENTP_NAME"), 60),
                         s(x.get("PRINT_FRONT"), 40), s(x.get("PRINT_BACK"), 40), s(x.get("DRUG_SHAPE")),
                         s(x.get("COLOR_CLASS1")), s(x.get("COLOR_CLASS2")), s(x.get("LINE_FRONT")), s(x.get("LINE_BACK")),
                         s(x.get("FORM_CODE_NAME")), img[len(IMG_PREFIX):] if img.startswith(IMG_PREFIX) else img,
                         s(x.get("LENG_LONG")), s(x.get("LENG_SHORT")), s(x.get("THICK")), s(x.get("CLASS_NAME"), 60),
                         s(x.get("ETC_OTC_NAME")), s(x.get("CHART"), 120)])
        write("pills.json", {"cols": cols, "imgPrefix": IMG_PREFIX, "rows": data})
        meta["parts"]["pills"] = len(data)
        ok_any = True

    if not ok_any:
        print("[오류] 받은 데이터가 없습니다. 위의 API 활용신청과 인증키를 확인하세요.", file=sys.stderr)
        sys.exit(1)
    # 이번에 못 받은 부분은 예전 기록 유지
    try:
        with open(os.path.join(OUT_DIR, "meta.json"), encoding="utf-8") as f:
            old = json.load(f)
        for p, n in (old.get("parts") or {}).items():
            meta["parts"].setdefault(p, n)
    except Exception:
        pass
    write("meta.json", meta)


if __name__ == "__main__":
    main()
