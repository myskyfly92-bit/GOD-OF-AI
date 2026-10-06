"""
국가법령정보센터 공동활용 API(DRF)로 한국 산업안전 법령 조문을 받아 kr-laws.json 으로 저장합니다.
(사이트 화면에는 보이지 않고, AI 법령 도우미(챗봇)가 조문을 찾아 근거로 답할 때 씁니다)

받는 법령
  - 산업안전보건법 / 시행령 / 시행규칙
  - 산업안전보건기준에 관한 규칙  (현장 기술 기준 대부분)
  - 중대재해 처벌 등에 관한 법률 / 시행령

인증: 저장소 Secrets 의 LAW_OC (open.law.go.kr 에서 정한 OC 값)

로컬 실행:
    pip install requests
    LAW_OC=내OC값 python scripts/fetch_kr_laws.py
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timezone

import requests

BASE = "https://www.law.go.kr/DRF"
OUTPUT_PATH = "kr-laws.json"
LAWS = [
    ("산업안전보건법", "산안법"),
    ("산업안전보건법 시행령", "산안법 시행령"),
    ("산업안전보건법 시행규칙", "산안법 시행규칙"),
    ("산업안전보건기준에 관한 규칙", "안전보건규칙"),
    ("중대재해 처벌 등에 관한 법률", "중대재해처벌법"),
    ("중대재해 처벌 등에 관한 법률 시행령", "중대재해처벌법 시행령"),
]
MAX_TEXT = 3500   # 조문 하나에 담을 최대 글자 수 (별표처럼 아주 긴 조문은 앞부분만)


def get_json(path, params):
    for attempt in range(3):
        try:
            r = requests.get(f"{BASE}/{path}", params=params, timeout=60,
                             headers={"User-Agent": "Mozilla/5.0 (BismayahHSE law fetcher)"})
            text = r.text.strip()
            if r.status_code == 200 and text.startswith("{"):
                return r.json()
            print(f"  [경고] {path} 응답 {r.status_code}: {text[:200]!r}", file=sys.stderr)
        except Exception as e:
            print(f"  [경고] {path} 접속 실패: {e}", file=sys.stderr)
        time.sleep(2 + attempt * 3)
    return None


def find_law(oc, name):
    """법령명이 정확히 같은 현행 법령의 ID·MST 를 찾는다."""
    j = get_json("lawSearch.do", {"OC": oc, "target": "law", "type": "JSON", "query": name, "display": 20})
    if not j:
        return None
    laws = (j.get("LawSearch") or {}).get("law") or []
    if isinstance(laws, dict):
        laws = [laws]
    norm = lambda s: re.sub(r"\s+", "", s or "")
    for it in laws:
        if norm(it.get("법령명한글")) == norm(name) and it.get("현행연혁코드", "현행") == "현행":
            return it
    for it in laws:
        if norm(it.get("법령명한글")) == norm(name):
            return it
    print(f"  [경고] '{name}' 을(를) 검색 결과에서 찾지 못함. 결과: {[x.get('법령명한글') for x in laws]}", file=sys.stderr)
    return None


def as_list(v):
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def flatten(node):
    """조문 안의 항·호·목 내용을 순서대로 이어 붙인다 (구조가 dict/list/str 어느 쪽이든)."""
    out = []
    if isinstance(node, str):
        out.append(node)
    elif isinstance(node, list):
        for x in node:
            out.extend(flatten(x))
    elif isinstance(node, dict):
        for k, v in node.items():
            if k.endswith("내용") or k in ("항", "호", "목"):
                out.extend(flatten(v))
    return out


def clean(t):
    t = re.sub(r"<[^>]+>", "", t or "")
    t = t.replace(" ", " ")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in t.split("\n")]
    return "\n".join(ln for ln in lines if ln)


def parse_articles(j, law_idx):
    law = j.get("법령") or j
    units = as_list(((law.get("조문") or {}).get("조문단위")))
    arts, chapter = [], ""
    for u in units:
        if not isinstance(u, dict):
            continue
        if u.get("조문여부") == "전문":          # 장·절 제목줄
            chapter = clean(u.get("조문내용", ""))
            continue
        no = str(u.get("조문번호", "")).strip()
        gaji = str(u.get("조문가지번호", "") or "").strip()
        if not no:
            continue
        art_no = f"제{no}조" + (f"의{gaji}" if gaji and gaji != "0" else "")
        title = clean(u.get("조문제목", ""))
        body = clean("\n".join(flatten({"조문내용": u.get("조문내용"), "항": u.get("항")})))
        if not body:
            continue
        deleted = bool(re.match(r"^제\d+조(의\d+)?\s*삭제", body))
        if deleted:
            continue
        arts.append({"l": law_idx, "no": art_no, "t": title, "x": body[:MAX_TEXT], "ch": chapter[:60]})
    return arts


def main():
    oc = (os.environ.get("LAW_OC") or "").strip()
    if not oc:
        print("[오류] LAW_OC (국가법령정보센터 OC 값)가 없습니다.", file=sys.stderr)
        sys.exit(1)

    laws_meta, articles = [], []
    for name, short in LAWS:
        info = find_law(oc, name)
        if not info:
            continue
        law_id, mst = info.get("법령ID"), info.get("법령일련번호")
        j = get_json("lawService.do", {"OC": oc, "target": "law", "type": "JSON", "MST": mst})
        if not j and law_id:
            j = get_json("lawService.do", {"OC": oc, "target": "law", "type": "JSON", "ID": law_id})
        if not j:
            print(f"  [경고] '{name}' 본문을 받지 못함", file=sys.stderr)
            continue
        idx = len(laws_meta)
        arts = parse_articles(j, idx)
        if not arts:
            print(f"  [경고] '{name}' 조문 0개. 응답 앞부분: {json.dumps(j, ensure_ascii=False)[:500]}", file=sys.stderr)
            continue
        laws_meta.append({
            "name": name, "short": short, "id": law_id, "mst": mst,
            "efYd": info.get("시행일자", ""), "promulgated": info.get("공포일자", ""),
            "link": "https://www.law.go.kr/법령/" + re.sub(r"\s+", "", name),
        })
        articles.extend(arts)
        print(f"[완료] {name}: 조문 {len(arts)}개 (시행 {info.get('시행일자', '')})")
        time.sleep(1)

    if len(laws_meta) < 2:
        print("[오류] 받은 법령이 너무 적어 기존 파일을 유지합니다.", file=sys.stderr)
        sys.exit(1)

    out = {
        "_readme": "GitHub Actions가 국가법령정보센터 API로 자동 생성합니다. AI 법령 도우미가 근거 조문을 찾는 데 씁니다. 직접 수정하지 마세요.",
        "source": "국가법령정보센터 (www.law.go.kr)",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "laws": laws_meta,
        "articles": articles,
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(OUTPUT_PATH) / 1024
    print(f"[저장] {OUTPUT_PATH}: 법령 {len(laws_meta)}개 · 조문 {len(articles)}개 · {size:.0f} KB")


if __name__ == "__main__":
    main()
