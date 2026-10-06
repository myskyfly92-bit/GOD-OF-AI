"""
세계 대기질(AQI) 나라·도시 순위를 만들어 aqi-rank.json 으로 저장합니다.
(환경 > 세계 대기질 순위)

자료 (두 곳을 섞어 씀)
  1) WAQI (aqicn.org, World Air Quality Index Project) — 측정소 실측 AQI · GitHub Secret WAQI_TOKEN
     도시에서 가장 가까운 측정소가 40km 안에 있고, 최근 6시간 안에 측정한 값이면 이 값을 씀
  2) Open-Meteo 대기질 API (인증키 필요 없음 · 유럽 CAMS 대기질 모델 값)
     측정소가 없거나 오래된 도시는 이 값으로 채움. PM2.5 24시간 평균도 여기서.
  - AQI는 모두 미국 EPA 기준
  - 나라 순위 = 그 나라 주요 도시(아래 목록) 값의 평균
"""

import json
import math
import os
import sys
import time
from datetime import datetime, timezone

import requests

OUTPUT_PATH = "aqi-rank.json"
API = "https://air-quality-api.open-meteo.com/v1/air-quality"
CHUNK = 40  # 한 번에 묻는 도시 수
WAQI = "https://api.waqi.info/feed/geo:{lat};{lon}/"
WAQI_MAX_KM = 40
WAQI_MAX_AGE_H = 6

# (ISO2, 나라, 도시, 위도, 경도)
CITIES = [
    # ── 중동 ──
    ("IQ", "이라크", "바그다드", 33.31, 44.37), ("IQ", "이라크", "바스라", 30.51, 47.81), ("IQ", "이라크", "모술", 36.34, 43.13),
    ("IQ", "이라크", "아르빌", 36.19, 44.01), ("IQ", "이라크", "나자프", 32.03, 44.35),
    ("IR", "이란", "테헤란", 35.69, 51.39), ("IR", "이란", "마슈하드", 36.30, 59.61), ("IR", "이란", "아흐바즈", 31.32, 48.67),
    ("SA", "사우디아라비아", "리야드", 24.71, 46.68), ("SA", "사우디아라비아", "제다", 21.49, 39.19), ("SA", "사우디아라비아", "담맘", 26.43, 50.10),
    ("KW", "쿠웨이트", "쿠웨이트시티", 29.38, 47.98), ("AE", "아랍에미리트", "두바이", 25.20, 55.27), ("AE", "아랍에미리트", "아부다비", 24.45, 54.38),
    ("QA", "카타르", "도하", 25.29, 51.53), ("BH", "바레인", "마나마", 26.23, 50.59), ("OM", "오만", "무스카트", 23.59, 58.41),
    ("YE", "예멘", "사나", 15.37, 44.19), ("YE", "예멘", "아덴", 12.79, 45.04), ("JO", "요르단", "암만", 31.95, 35.93),
    ("SY", "시리아", "다마스쿠스", 33.51, 36.29), ("SY", "시리아", "알레포", 36.20, 37.13), ("LB", "레바논", "베이루트", 33.89, 35.50),
    ("IL", "이스라엘", "텔아비브", 32.09, 34.78), ("IL", "이스라엘", "예루살렘", 31.77, 35.21), ("PS", "팔레스타인", "가자", 31.50, 34.47),
    ("TR", "튀르키예", "이스탄불", 41.01, 28.98), ("TR", "튀르키예", "앙카라", 39.93, 32.86), ("TR", "튀르키예", "가지안테프", 37.07, 37.38),
    ("EG", "이집트", "카이로", 30.04, 31.24), ("EG", "이집트", "알렉산드리아", 31.20, 29.92),
    # ── 남·중앙아시아 ──
    ("IN", "인도", "뉴델리", 28.61, 77.21), ("IN", "인도", "뭄바이", 19.08, 72.88), ("IN", "인도", "콜카타", 22.57, 88.36),
    ("IN", "인도", "러크나우", 26.85, 80.95), ("IN", "인도", "벵갈루루", 12.97, 77.59),
    ("PK", "파키스탄", "라호르", 31.55, 74.34), ("PK", "파키스탄", "카라치", 24.86, 67.01), ("PK", "파키스탄", "이슬라마바드", 33.68, 73.05),
    ("BD", "방글라데시", "다카", 23.81, 90.41), ("BD", "방글라데시", "치타공", 22.36, 91.78), ("NP", "네팔", "카트만두", 27.72, 85.32),
    ("AF", "아프가니스탄", "카불", 34.56, 69.21), ("LK", "스리랑카", "콜롬보", 6.93, 79.86), ("BT", "부탄", "팀부", 27.47, 89.64),
    ("UZ", "우즈베키스탄", "타슈켄트", 41.30, 69.24), ("KZ", "카자흐스탄", "알마티", 43.24, 76.89), ("KZ", "카자흐스탄", "아스타나", 51.17, 71.45),
    ("TM", "투르크메니스탄", "아시가바트", 37.96, 58.33), ("TJ", "타지키스탄", "두샨베", 38.56, 68.79), ("KG", "키르기스스탄", "비슈케크", 42.87, 74.59),
    ("MN", "몽골", "울란바토르", 47.89, 106.91),
    # ── 동·동남아시아 ──
    ("KR", "대한민국", "서울", 37.57, 126.98), ("KR", "대한민국", "부산", 35.18, 129.08), ("KR", "대한민국", "대구", 35.87, 128.60),
    ("CN", "중국", "베이징", 39.90, 116.40), ("CN", "중국", "상하이", 31.23, 121.47), ("CN", "중국", "청두", 30.57, 104.07),
    ("CN", "중국", "시안", 34.34, 108.94), ("CN", "중국", "광저우", 23.13, 113.26), ("CN", "중국", "우루무치", 43.83, 87.62),
    ("JP", "일본", "도쿄", 35.68, 139.69), ("JP", "일본", "오사카", 34.69, 135.50), ("TW", "대만", "타이베이", 25.03, 121.57),
    ("HK", "홍콩", "홍콩", 22.32, 114.17), ("KP", "북한", "평양", 39.04, 125.76),
    ("VN", "베트남", "하노이", 21.03, 105.85), ("VN", "베트남", "호찌민", 10.82, 106.63), ("TH", "태국", "방콕", 13.76, 100.50),
    ("TH", "태국", "치앙마이", 18.79, 98.98), ("MM", "미얀마", "양곤", 16.87, 96.20), ("LA", "라오스", "비엔티안", 17.97, 102.63),
    ("KH", "캄보디아", "프놈펜", 11.56, 104.93), ("MY", "말레이시아", "쿠알라룸푸르", 3.14, 101.69), ("SG", "싱가포르", "싱가포르", 1.35, 103.82),
    ("ID", "인도네시아", "자카르타", -6.21, 106.85), ("ID", "인도네시아", "수라바야", -7.25, 112.75), ("PH", "필리핀", "마닐라", 14.60, 120.98),
    # ── 아프리카 ──
    ("NG", "나이지리아", "라고스", 6.52, 3.38), ("NG", "나이지리아", "카노", 12.00, 8.52), ("NG", "나이지리아", "아부자", 9.08, 7.40),
    ("TD", "차드", "은자메나", 12.13, 15.06), ("NE", "니제르", "니아메", 13.51, 2.11), ("ML", "말리", "바마코", 12.64, -8.00),
    ("BF", "부르키나파소", "와가두구", 12.37, -1.52), ("SD", "수단", "하르툼", 15.50, 32.56), ("MR", "모리타니", "누악쇼트", 18.08, -15.98),
    ("SN", "세네갈", "다카르", 14.72, -17.47), ("GH", "가나", "아크라", 5.60, -0.19), ("CI", "코트디부아르", "아비장", 5.36, -4.01),
    ("CM", "카메룬", "야운데", 3.85, 11.50), ("CD", "콩고민주공화국", "킨샤사", -4.44, 15.27), ("ET", "에티오피아", "아디스아바바", 9.03, 38.74),
    ("KE", "케냐", "나이로비", -1.29, 36.82), ("TZ", "탄자니아", "다르에스살람", -6.79, 39.21), ("UG", "우간다", "캄팔라", 0.35, 32.58),
    ("ZA", "남아프리카공화국", "요하네스버그", -26.20, 28.05), ("ZA", "남아프리카공화국", "케이프타운", -33.92, 18.42),
    ("DZ", "알제리", "알제", 36.75, 3.06), ("MA", "모로코", "카사블랑카", 33.57, -7.59), ("TN", "튀니지", "튀니스", 36.81, 10.18),
    ("LY", "리비아", "트리폴리", 32.89, 13.19), ("AO", "앙골라", "루안다", -8.84, 13.23), ("MZ", "모잠비크", "마푸투", -25.97, 32.57),
    # ── 유럽 ──
    ("GB", "영국", "런던", 51.51, -0.13), ("FR", "프랑스", "파리", 48.86, 2.35), ("DE", "독일", "베를린", 52.52, 13.40),
    ("DE", "독일", "뮌헨", 48.14, 11.58), ("IT", "이탈리아", "로마", 41.90, 12.50), ("IT", "이탈리아", "밀라노", 45.46, 9.19),
    ("ES", "스페인", "마드리드", 40.42, -3.70), ("PT", "포르투갈", "리스본", 38.72, -9.14), ("NL", "네덜란드", "암스테르담", 52.37, 4.90),
    ("BE", "벨기에", "브뤼셀", 50.85, 4.35), ("CH", "스위스", "취리히", 47.38, 8.54), ("AT", "오스트리아", "빈", 48.21, 16.37),
    ("PL", "폴란드", "바르샤바", 52.23, 21.01), ("PL", "폴란드", "크라쿠프", 50.06, 19.94), ("CZ", "체코", "프라하", 50.08, 14.44),
    ("HU", "헝가리", "부다페스트", 47.50, 19.04), ("RO", "루마니아", "부쿠레슈티", 44.43, 26.10), ("BG", "불가리아", "소피아", 42.70, 23.32),
    ("RS", "세르비아", "베오그라드", 44.79, 20.45), ("BA", "보스니아헤르체고비나", "사라예보", 43.86, 18.41), ("MK", "북마케도니아", "스코페", 42.00, 21.43),
    ("GR", "그리스", "아테네", 37.98, 23.73), ("UA", "우크라이나", "키이우", 50.45, 30.52), ("RU", "러시아", "모스크바", 55.76, 37.62),
    ("SE", "스웨덴", "스톡홀름", 59.33, 18.07), ("NO", "노르웨이", "오슬로", 59.91, 10.75), ("FI", "핀란드", "헬싱키", 60.17, 24.94),
    ("DK", "덴마크", "코펜하겐", 55.68, 12.57), ("IE", "아일랜드", "더블린", 53.35, -6.26), ("IS", "아이슬란드", "레이캬비크", 64.15, -21.94),
    ("GE", "조지아", "트빌리시", 41.72, 44.79), ("AM", "아르메니아", "예레반", 40.18, 44.51), ("AZ", "아제르바이잔", "바쿠", 40.41, 49.87),
    # ── 아메리카 ──
    ("US", "미국", "뉴욕", 40.71, -74.01), ("US", "미국", "로스앤젤레스", 34.05, -118.24), ("US", "미국", "시카고", 41.88, -87.63),
    ("US", "미국", "휴스턴", 29.76, -95.37), ("CA", "캐나다", "토론토", 43.65, -79.38), ("CA", "캐나다", "밴쿠버", 49.28, -123.12),
    ("MX", "멕시코", "멕시코시티", 19.43, -99.13), ("MX", "멕시코", "몬테레이", 25.69, -100.32), ("GT", "과테말라", "과테말라시티", 14.63, -90.51),
    ("CO", "콜롬비아", "보고타", 4.71, -74.07), ("PE", "페루", "리마", -12.05, -77.04), ("CL", "칠레", "산티아고", -33.45, -70.67),
    ("AR", "아르헨티나", "부에노스아이레스", -34.60, -58.38), ("BR", "브라질", "상파울루", -23.55, -46.63), ("BR", "브라질", "리우데자네이루", -22.91, -43.17),
    ("BO", "볼리비아", "라파스", -16.49, -68.12), ("EC", "에콰도르", "키토", -0.18, -78.47), ("VE", "베네수엘라", "카라카스", 10.48, -66.90),
    # ── 오세아니아 ──
    ("AU", "오스트레일리아", "시드니", -33.87, 151.21), ("AU", "오스트레일리아", "멜버른", -37.81, 144.96), ("NZ", "뉴질랜드", "오클랜드", -36.85, 174.76),
]
SITE = ("IQ", "이라크", "비스마야 현장", 33.19, 44.62)  # 비교용 (나라 평균에는 넣지 않음)


def aqi_grade(v):
    if v is None:
        return ""
    for lim, g in ((50, "좋음"), (100, "보통"), (150, "민감군 나쁨"), (200, "나쁨"), (300, "매우 나쁨")):
        if v <= lim:
            return g
    return "위험"


def fetch_chunk(cities):
    params = {
        "latitude": ",".join(f"{c[3]}" for c in cities),
        "longitude": ",".join(f"{c[4]}" for c in cities),
        "current": "us_aqi,pm2_5,pm10",
        "hourly": "pm2_5",
        "past_hours": 24,
        "forecast_hours": 1,
        "timezone": "UTC",
    }
    for attempt in range(4):
        r = requests.get(API, params=params, timeout=60)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(10 * (attempt + 1))
            continue
        r.raise_for_status()
        j = r.json()
        return j if isinstance(j, list) else [j]
    raise RuntimeError(f"Open-Meteo 응답 실패 (HTTP {r.status_code})")


def num(v):
    try:
        return None if v is None else round(float(v), 1)
    except (TypeError, ValueError):
        return None


def km(a, b, c, d):
    r = math.radians
    x = math.sin(r(c - a) / 2) ** 2 + math.cos(r(a)) * math.cos(r(c)) * math.sin(r(d - b) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(x))


def waqi_station(token, lat, lon):
    """가까운 측정소의 실측 AQI → (aqi, 측정소이름, 거리km, 측정시각) 또는 (None, 사유)"""
    j, err = None, ""
    for attempt in range(3):
        try:
            r = requests.get(WAQI.format(lat=lat, lon=lon), params={"token": token}, timeout=30)
            j = r.json()
        except Exception as e:
            j, err = None, str(e)[:120]
            time.sleep(3 * (attempt + 1))
            continue
        if j.get("status") != "ok" and "connect" in str(j.get("data")):
            time.sleep(3 * (attempt + 1))   # WAQI 서버 일시 오류 → 다시
            continue
        break
    if j is None:
        return None, f"접속 실패 {err}"
    if j.get("status") != "ok":
        return None, f"WAQI 오류: {str(j.get('data'))[:120]}"
    d = j.get("data") or {}
    try:
        aqi = int(str(d.get("aqi")).strip())
    except ValueError:
        return None, "측정값 없음"
    geo = (d.get("city") or {}).get("geo") or []
    dist = km(lat, lon, float(geo[0]), float(geo[1])) if len(geo) == 2 else 9999
    if dist > WAQI_MAX_KM:
        return None, f"가까운 측정소 없음 ({round(dist)}km)"
    t = (d.get("time") or {})
    ts = t.get("v")
    try:
        # time.v 는 측정소 현지 시각을 초로 적은 값이라 tz 만큼 보정
        tz = t.get("tz") or "+00:00"
        sign = -1 if tz.startswith("-") else 1
        hh, mm = tz.lstrip("+-").split(":")[:2]
        utc = float(ts) - sign * (int(hh) * 3600 + int(mm) * 60)
        age_h = (time.time() - utc) / 3600
    except Exception:
        age_h = 0
    if age_h > WAQI_MAX_AGE_H:
        return None, f"측정값이 오래됨 ({round(age_h)}시간 전)"
    return {"aqi": aqi, "station": str((d.get("city") or {}).get("name") or "")[:80],
            "km": round(dist, 1), "time": t.get("iso") or t.get("s") or ""}, None


def waqi_bounds(token, lat, lon):
    """가장 가까운 측정소가 꺼져 있을 때: 주변(약 40km) 측정소들 중 값이 있는 곳을 찾는다"""
    dl, dn = 0.36, 0.36 / max(0.2, math.cos(math.radians(lat)))
    try:
        r = requests.get("https://api.waqi.info/v2/map/bounds",
                         params={"latlng": f"{lat-dl},{lon-dn},{lat+dl},{lon+dn}", "networks": "all", "token": token}, timeout=30)
        j = r.json()
    except Exception:
        return None
    if j.get("status") != "ok":
        return None
    best = None
    for st in j.get("data") or []:
        try:
            aqi = int(str(st.get("aqi")).strip())
            dist = km(lat, lon, float(st["lat"]), float(st["lon"]))
        except (ValueError, KeyError, TypeError):
            continue
        t = str((st.get("station") or {}).get("time") or "")
        try:
            age_h = (time.time() - datetime.fromisoformat(t).timestamp()) / 3600
        except ValueError:
            age_h = 99
        if dist <= WAQI_MAX_KM and age_h <= WAQI_MAX_AGE_H and (best is None or dist < best["km"]):
            best = {"aqi": aqi, "station": str((st.get("station") or {}).get("name") or "")[:80], "km": round(dist, 1), "time": t}
    return best


def main():
    allc = CITIES + [SITE]
    rows = []
    errors = {}
    # 1) 모델 값 (Open-Meteo) — 모든 도시
    for i in range(0, len(allc), CHUNK):
        part = allc[i:i + CHUNK]
        try:
            res = fetch_chunk(part)
        except Exception as e:
            errors["openmeteo"] = str(e)[:200]
            res = [{} for _ in part]
        if len(res) != len(part):
            print(f"[경고] {len(part)}곳을 물었는데 {len(res)}곳 응답", file=sys.stderr)
            res = (res + [{}] * len(part))[:len(part)]
        for c, d in zip(part, res):
            cur = d.get("current") or {}
            pm = [x for x in ((d.get("hourly") or {}).get("pm2_5") or []) if x is not None]
            aqi = cur.get("us_aqi")
            rows.append({
                "iso2": c[0], "country": c[1], "city": c[2], "lat": c[3], "lon": c[4],
                "aqi": None if aqi is None else int(round(aqi)),
                "modelAqi": None if aqi is None else int(round(aqi)),
                "src": "모델",
                "pm25": num(cur.get("pm2_5")), "pm10": num(cur.get("pm10")),
                "pm25_24h": num(sum(pm) / len(pm)) if pm else None,
                "site": c is SITE,
            })
        time.sleep(1.5)

    # 2) 실측 값 (WAQI) — 있으면 덮어씀
    token = (os.environ.get("WAQI_TOKEN") or "").strip()
    measured = 0
    if not token:
        errors["waqi"] = "WAQI_TOKEN 이 없습니다 (모델 값만 사용)"
    else:
        reasons = {}
        for r in rows:
            st, why = waqi_station(token, r["lat"], r["lon"])
            if not st and not str(why).startswith("WAQI 오류: Invalid"):
                st2 = waqi_bounds(token, r["lat"], r["lon"])
                if st2:
                    st = st2
                else:
                    r["why"] = why   # 실측을 못 쓴 이유 (확인용)
            if st:
                r.update(aqi=st["aqi"], src="실측", station=st["station"], stationKm=st["km"], measuredAt=st["time"])
                measured += 1
            else:
                reasons[why.split(" (")[0]] = reasons.get(why.split(" (")[0], 0) + 1
                if why.startswith("WAQI 오류"):
                    errors["waqi"] = why
                    if "Invalid key" in why or "invalid" in why.lower():
                        break
            time.sleep(0.25)
        print(f"[WAQI] 실측 {measured}곳 · 모델로 채움 {len(rows) - measured}곳 · 사유 {reasons}")
    for r in rows:
        r.pop("lat", None)
        r.pop("lon", None)

    cities = [r for r in rows if r["aqi"] is not None and not r["site"]]
    if len(cities) < len(CITIES) * 0.5:
        print(f"[오류] 받은 도시가 너무 적습니다 ({len(cities)}곳) {errors}. 기존 파일을 유지합니다.", file=sys.stderr)
        sys.exit(1)
    cities.sort(key=lambda r: r["aqi"], reverse=True)
    for i, r in enumerate(cities, 1):
        r["rank"] = i
        r["grade"] = aqi_grade(r["aqi"])

    by = {}
    for r in cities:
        by.setdefault(r["iso2"], {"iso2": r["iso2"], "country": r["country"], "list": []})["list"].append(r)
    countries = []
    for c in by.values():
        lst = c["list"]
        a = round(sum(x["aqi"] for x in lst) / len(lst))
        p = [x["pm25_24h"] for x in lst if x["pm25_24h"] is not None]
        worst = max(lst, key=lambda x: x["aqi"])
        countries.append({"iso2": c["iso2"], "country": c["country"], "aqi": a, "grade": aqi_grade(a),
                          "measured": sum(1 for x in lst if x["src"] == "실측"),
                          "pm25_24h": round(sum(p) / len(p), 1) if p else None,
                          "cities": len(lst), "worstCity": worst["city"], "worstAqi": worst["aqi"]})
    countries.sort(key=lambda r: r["aqi"], reverse=True)
    for i, r in enumerate(countries, 1):
        r["rank"] = i

    site = next((r for r in rows if r["site"]), None)
    if site and site["aqi"] is not None:
        site["grade"] = aqi_grade(site["aqi"])
        site["rankAmongCities"] = 1 + sum(1 for r in cities if r["aqi"] > site["aqi"])
    for r in cities:
        r.pop("site", None)

    out = {
        "_readme": "이 파일은 GitHub Actions가 Open-Meteo 대기질 API로 자동 생성/갱신합니다. 직접 수정하지 마세요.",
        "source": "WAQI(aqicn.org) 측정소 실측 + Open-Meteo(CAMS 모델) 보충 · 미국 EPA 기준 AQI",
        "measuredCount": measured,
        "errors": errors,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "countries": countries,
        "cities": cities,
        "site": site,
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    iq = next((c for c in countries if c["iso2"] == "IQ"), None)
    print(f"{len(countries)}개국 · {len(cities)}개 도시 저장" + (f" · 이라크 {iq['rank']}위 (AQI {iq['aqi']})" if iq else ""))


if __name__ == "__main__":
    main()
