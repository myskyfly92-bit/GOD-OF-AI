"""
NASA FIRMS(위성 화재 감지) API로 이라크 일대의 화재·열 이상 지점을 수집해 fires.json으로 저장합니다.

- 위성(VIIRS 3기 + MODIS)이 이라크 상공을 지날 때 감지한 지점이라, 보통 몇 시간 전 상황입니다.
- 이라크는 유전 가스 플레어(가스를 태우는 불꽃)가 매우 많아서, 최근 5일 중 3일 이상
  같은 자리(약 2km 이내)에서 감지된 지점은 "상시 열원(가스 플레어 추정)"으로 구분합니다.
- 비스마야 현장 반경 10km 안의 최근 24시간 신규 화재는 따로 요약합니다.

사전 준비:
    https://firms.modaps.eosdis.nasa.gov/api/map_key/ 에서 무료 MAP_KEY 발급
    저장소 Settings > Secrets and variables > Actions 에 FIRMS_MAP_KEY 로 등록
"""

import csv
import io
import json
import math
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import requests

OUTPUT_PATH = "fires.json"

# 이라크 전체 + 국경 주변 (서, 남, 동, 북)
AREA = "38.7,29.0,48.8,37.4"
SOURCES = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "MODIS_NRT"]
DAY_RANGE = 5          # 상시 열원 판별용으로 최근 5일치를 받는다
SHOW_HOURS = 48        # 지도에는 최근 48시간만 표시
PERSISTENT_DAYS = 3    # 5일 중 3일 이상 같은 자리 → 상시 열원
CELL_DEG = 0.02        # 같은 자리 판단 격자 (약 2km)

BISMAYAH_LAT = 33.193
BISMAYAH_LON = 44.618
NEARBY_KM = 10

URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/{area}/{days}"


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def cell_of(lat, lon):
    return (round(lat / CELL_DEG), round(lon / CELL_DEG))


def is_low_confidence(conf):
    conf = (conf or "").strip().lower()
    if conf in ("l", "low"):
        return True
    try:
        return float(conf) < 30  # MODIS는 0~100 숫자
    except ValueError:
        return False


def fetch_source(key, source):
    url = URL.format(key=key, source=source, area=AREA, days=DAY_RANGE)
    resp = requests.get(url, timeout=60)
    text = resp.text.strip()
    if resp.status_code != 200 or not text.lower().startswith("latitude"):
        raise RuntimeError(f"응답 코드 {resp.status_code}: {text[:200]}")
    return list(csv.DictReader(io.StringIO(text)))


def main():
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not key:
        print("[오류] FIRMS_MAP_KEY가 등록되지 않았습니다. 저장소 Settings > Secrets 에 등록해 주세요.", file=sys.stderr)
        sys.exit(1)

    now = datetime.now(timezone.utc)
    detections = []
    ok_sources = []
    for source in SOURCES:
        try:
            rows = fetch_source(key, source)
        except Exception as exc:
            print(f"[경고] {source} 수집 실패: {exc}", file=sys.stderr)
            continue
        ok_sources.append(source)
        kept = 0
        for r in rows:
            try:
                lat = float(r["latitude"])
                lon = float(r["longitude"])
                t = str(r.get("acq_time", "0")).zfill(4)
                when = datetime.strptime(f"{r['acq_date']} {t}", "%Y-%m-%d %H%M").replace(tzinfo=timezone.utc)
            except (KeyError, ValueError):
                continue
            if is_low_confidence(r.get("confidence")):
                continue
            try:
                frp = float(r.get("frp") or 0)
            except ValueError:
                frp = 0.0
            detections.append({
                "lat": lat, "lon": lon, "when": when, "frp": frp,
                "sensor": "MODIS" if source.startswith("MODIS") else "VIIRS",
                "satellite": r.get("satellite", ""),
                "confidence": r.get("confidence", ""),
                "daynight": r.get("daynight", ""),
            })
            kept += 1
        print(f"{source}: {kept}건")

    if not ok_sources:
        print("[오류] 모든 위성 데이터 수집에 실패했습니다. 기존 파일을 유지합니다.", file=sys.stderr)
        sys.exit(1)

    # 같은 자리에서 감지된 날짜 수 → 상시 열원(가스 플레어 추정) 판별
    days_by_cell = defaultdict(set)
    for d in detections:
        days_by_cell[cell_of(d["lat"], d["lon"])].add(d["when"].date())
    persistent_cells = {c for c, days in days_by_cell.items() if len(days) >= PERSISTENT_DAYS}

    # 최근 48시간만, 같은 자리·같은 시간대(1시간) 중복은 강도(FRP)가 가장 큰 것 하나만
    cutoff = now - timedelta(hours=SHOW_HOURS)
    best = {}
    for d in detections:
        if d["when"] < cutoff:
            continue
        k = (round(d["lat"] / 0.01), round(d["lon"] / 0.01), d["when"].strftime("%Y%m%d%H"))
        if k not in best or d["frp"] > best[k]["frp"]:
            best[k] = d

    fires = []
    for d in best.values():
        dist = haversine_km(BISMAYAH_LAT, BISMAYAH_LON, d["lat"], d["lon"])
        fires.append({
            "lat": round(d["lat"], 4),
            "lon": round(d["lon"], 4),
            "time": d["when"].isoformat(),
            "hoursAgo": round((now - d["when"]).total_seconds() / 3600, 1),
            "frp": round(d["frp"], 1),
            "sensor": d["sensor"],
            "satellite": d["satellite"],
            "confidence": d["confidence"],
            "daynight": d["daynight"],
            "persistent": cell_of(d["lat"], d["lon"]) in persistent_cells,
            "distanceKm": round(dist, 1),
        })
    fires.sort(key=lambda f: f["time"], reverse=True)

    nearby = [f for f in fires if not f["persistent"] and f["hoursAgo"] <= 24 and f["distanceKm"] <= NEARBY_KM]
    nearby.sort(key=lambda f: f["distanceKm"])

    output = {
        "_readme": "이 파일은 GitHub Actions가 NASA FIRMS 위성 화재 데이터로 자동 생성/갱신합니다. 직접 수정하지 마세요.",
        "area": AREA,
        "sources": ok_sources,
        "count": len(fires),
        "newCount": sum(1 for f in fires if not f["persistent"]),
        "persistentCount": sum(1 for f in fires if f["persistent"]),
        "nearby": {"radiusKm": NEARBY_KM, "count": len(nearby), "closest": nearby[:5]},
        "fires": fires,
        "generatedAt": now.isoformat(),
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=1)

    print(f"최근 {SHOW_HOURS}시간 화재 {len(fires)}건 (신규 {output['newCount']} · 상시 열원 {output['persistentCount']}) "
          f"· 현장 {NEARBY_KM}km 내 24시간 신규 {len(nearby)}건 → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
