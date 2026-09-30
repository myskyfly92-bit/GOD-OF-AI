"""
고용노동부 '중대재해 알림e' 첫 화면에서 두 가지를 가져와 moel-serious.json 에 저장합니다.

1) 오른쪽 파란 카드(중대재해 현황): 발생유형별·규모별 사망자수와 전년동기대비 증감률.
   이 카드는 글자(HTML)라서 그대로 읽을 수 있습니다.
2) 왼쪽 배너 이미지의 파일 이름: 배너 속 막대그래프 숫자는 그림이라 못 읽지만,
   파일 이름에 "2026.7.9. … 수치 수정" 처럼 날짜가 들어 있어서 새 통계가 올라왔는지 알 수 있습니다.
"""

import json
import re
import sys
from datetime import datetime, timezone
from html.parser import HTMLParser

import requests

URL = "https://labor.moel.go.kr/sasttc/main.do"
OUTPUT_PATH = "moel-serious.json"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "ko-KR,ko;q=0.9",
}

VOID = {"img", "br", "hr", "input", "meta", "link", "source", "area", "col", "wbr", "base", "embed", "param", "track"}


class MoelParser(HTMLParser):
    """swiper-slide(복제본 제외) 안의 strong/p/dt/dd 글자와 배너 img alt 를 모은다"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.slide_depth = None   # 지금 읽고 있는 슬라이드 div 의 깊이
        self.slide = None
        self.capture = None       # 'strong' | 'p' | 'dt' | 'dd'
        self.buf = []
        self.pending_dt = None
        self.cards = []
        self.banner_alts = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class") or ""
        if tag not in VOID:
            self.depth += 1
        if tag == "div" and "swiper-slide" in cls.split() and self.slide_depth is None:
            if "swiper-slide-duplicate" in cls:
                return  # 무한 반복용 복제 슬라이드는 건너뛴다
            self.slide_depth = self.depth
            self.slide = {"title": "", "subtitle": "", "items": []}
            return
        if self.slide is None:
            return
        if tag == "img" and a.get("alt"):
            self.banner_alts.append(a["alt"].strip())
        if tag in ("strong", "p", "dt", "dd") and self.capture is None:
            self.capture, self.buf = tag, []
        elif tag == "br" and self.capture:
            self.buf.append(" ")

    def handle_endtag(self, tag):
        if self.slide is not None and self.capture == tag:
            text = re.sub(r"\s+", " ", "".join(self.buf)).strip()
            if tag == "strong" and not self.slide["title"]:
                self.slide["title"] = text
            elif tag == "p" and not self.slide["subtitle"]:
                self.slide["subtitle"] = text
            elif tag == "dt":
                self.pending_dt = text
            elif tag == "dd":
                self.slide["items"].append({"label": self.pending_dt or "", "value": text})
                self.pending_dt = None
            self.capture = None
        if tag not in VOID:
            if self.slide_depth is not None and self.depth == self.slide_depth and tag == "div":
                if self.slide["items"]:
                    self.cards.append(self.slide)
                self.slide, self.slide_depth = None, None
            self.depth -= 1

    def handle_data(self, data):
        if self.capture:
            self.buf.append(data)


def to_number(value):
    m = re.search(r"[-+]?\d[\d,]*(?:\.\d+)?", value or "")
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def banner_date(alt):
    m = re.search(r"(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})", alt or "")
    if not m:
        return None
    return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"


def main():
    try:
        resp = requests.get(URL, headers=HEADERS, timeout=40)
    except requests.RequestException as exc:
        print(f"[오류] 중대재해 알림e 접속 실패: {exc}", file=sys.stderr)
        sys.exit(1)
    if resp.status_code != 200:
        print(f"[오류] 응답 코드 {resp.status_code}: {resp.text[:300]}", file=sys.stderr)
        sys.exit(1)
    resp.encoding = resp.apparent_encoding or "utf-8"

    p = MoelParser()
    p.feed(resp.text)

    # 같은 카드가 두 번 잡히면 하나만
    seen, cards = set(), []
    for c in p.cards:
        key = (c["title"], c["subtitle"], tuple((i["label"], i["value"]) for i in c["items"]))
        if key in seen:
            continue
        seen.add(key)
        for it in c["items"]:
            it["number"] = to_number(it["value"])
        m = re.search(r"발생유형\s*\(([^)]+)\)", c["subtitle"])
        c["accidentType"] = m.group(1).strip() if m else None
        cards.append(c)

    alts = list(dict.fromkeys(a for a in p.banner_alts if a))
    dates = sorted(d for d in (banner_date(a) for a in alts) if d)

    if not cards:
        print("[오류] 오른쪽 통계 카드를 찾지 못했습니다. 페이지 구조가 바뀌었을 수 있습니다. 페이지 앞부분:", file=sys.stderr)
        print(re.sub(r"\s+", " ", resp.text[:800]), file=sys.stderr)
        sys.exit(1)

    output = {
        "_readme": "GitHub Actions가 고용노동부 중대재해 알림e 첫 화면에서 자동 수집합니다. 직접 수정하지 마세요.",
        "source": URL,
        "cards": cards,
        "bannerAlts": alts,
        "latestBannerDate": dates[-1] if dates else None,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"통계 카드 {len(cards)}개 수집:")
    for c in cards:
        print(f"  - {c['subtitle']}: " + " / ".join(f"{i['label']} {i['value']}" for i in c["items"]))
    print(f"배너 {len(alts)}개 · 가장 최근 배너 날짜: {output['latestBannerDate']}")


if __name__ == "__main__":
    main()
