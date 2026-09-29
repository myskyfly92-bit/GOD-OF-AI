"""
중동 전역의 실시간 항공기 위치를 여러 무료 공개 데이터에서 모아 planes.json으로 저장합니다.

데이터 출처 (모두 무료, 자원봉사 수신기 네트워크):
  1) OpenSky Network  - 로그인(OAuth2) 사용, 넓은 범위를 한 번에 조회
  2) adsb.lol         - API 키 불필요, 반경 250해리까지 조회 가능
  3) adsb.fi          - API 키 불필요, 반경 250해리까지 조회 가능

네트워크마다 수신기 위치가 달라서, 합치면 한 곳만 쓸 때보다 더 많은 항공기가 잡힙니다.
같은 항공기(ICAO 고유번호가 같은 경우)는 하나로 합칩니다.
한 출처가 실패해도 나머지 출처로 계속 진행합니다.

사전 준비 (OpenSky만 해당, 없으면 익명으로 조회):
    저장소 Settings > Secrets and variables > Actions 에
    OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET 등록
"""

import json
import os
import sys
import time
from datetime import datetime, timezone

import requests

OUTPUT_PATH = "planes.json"

# 중동 전역 (튀르키예 남부·레바논·사우디·이란·예멘·오만 포함)
LAT_MIN, LAT_MAX = 12.0, 42.0
LON_MIN, LON_MAX = 30.0, 63.0

# ---------------- OpenSky ----------------
OPENSKY_TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
OPENSKY_STATES_URL = "https://opensky-network.org/api/states/all"

# ---------------- adsb.lol / adsb.fi ----------------
# 두 서비스 모두 "중심점 + 반경(해리)" 방식이라, 중동 범위를 격자 모양의
# 여러 원으로 나눠서 조회한다. 반경 250해리(약 460km) 원이 빈틈없이 겹치도록
# 위도 5도, 경도 6도 간격으로 중심점을 둔다.
RADIUS_NM = 250
GRID_LATS = [14, 19, 24, 29, 34, 39]
GRID_LONS = [33, 39, 45, 51, 57, 62]
ADSB_SOURCES = {
    "adsb.lol": "https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{dist}",
    "adsb.fi": "https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{dist}",
}
REQUEST_GAP_SEC = 1.2  # 무료 서비스에 부담을 주지 않도록 요청 사이에 쉬는 시간
MAX_POSITION_AGE_SEC = 120  # 2분 넘게 위치 갱신이 없는 항공기는 제외

HEADERS = {"User-Agent": "BNCP-HSE-Dashboard/1.0 (GitHub Actions)"}


def in_region(lat, lon):
    return LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX


def fetch_opensky():
    client_id = os.environ.get("OPENSKY_CLIENT_ID")
    client_secret = os.environ.get("OPENSKY_CLIENT_SECRET")
    headers = dict(HEADERS)
    if client_id and client_secret:
        try:
            resp = requests.post(
                OPENSKY_TOKEN_URL,
                data={"grant_type": "client_credentials", "client_id": client_id, "client_secret": client_secret},
                timeout=20,
            )
            resp.raise_for_status()
            headers["Authorization"] = f"Bearer {resp.json()['access_token']}"
        except Exception as exc:
            print(f"[경고] OpenSky 토큰 발급 실패, 익명으로 시도합니다: {exc}", file=sys.stderr)

    params = {"lamin": LAT_MIN, "lomin": LON_MIN, "lamax": LAT_MAX, "lomax": LON_MAX}
    resp = requests.get(OPENSKY_STATES_URL, params=params, headers=headers, timeout=30)
    if resp.status_code != 200:
        raise RuntimeError(f"OpenSky 응답 코드 {resp.status_code}: {resp.text[:300]}")

    planes = {}
    for s in resp.json().get("states") or []:
        # 순서: icao24, callsign, origin_country, time_position, last_contact,
        #       longitude, latitude, baro_altitude, on_ground, velocity, true_track ...
        lon, lat, on_ground = s[5], s[6], s[8]
        if lat is None or lon is None or on_ground or not in_region(lat, lon):
            continue
        icao = (s[0] or "").lower()
        planes[icao] = {
            "icao24": icao,
            "callsign": (s[1] or "").strip() or icao,
            "originCountry": s[2] or "",
            "type": "",
            "lat": lat,
            "lon": lon,
            "altitude": s[7],   # m
            "speed": s[9],      # m/s
            "heading": s[10],
            "source": "OpenSky",
        }
    return planes


def fetch_adsb_source(name, url_template):
    planes = {}
    fail = 0
    for lat in GRID_LATS:
        for lon in GRID_LONS:
            url = url_template.format(lat=lat, lon=lon, dist=RADIUS_NM)
            try:
                resp = requests.get(url, headers=HEADERS, timeout=20)
                if resp.status_code != 200:
                    fail += 1
                    if fail <= 2:
                        print(f"[경고] {name} 응답 코드 {resp.status_code} ({lat},{lon})", file=sys.stderr)
                    time.sleep(REQUEST_GAP_SEC)
                    continue
                data = resp.json()
            except Exception as exc:
                fail += 1
                if fail <= 2:
                    print(f"[경고] {name} 요청 실패 ({lat},{lon}): {exc}", file=sys.stderr)
                time.sleep(REQUEST_GAP_SEC)
                continue

            for a in data.get("ac") or data.get("aircraft") or []:
                a_lat, a_lon = a.get("lat"), a.get("lon")
                alt = a.get("alt_baro")
                if a_lat is None or a_lon is None or alt == "ground":
                    continue
                if not in_region(a_lat, a_lon):
                    continue
                if (a.get("seen_pos") or 0) > MAX_POSITION_AGE_SEC:
                    continue
                icao = (a.get("hex") or "").lower().lstrip("~")
                if not icao:
                    continue
                gs = a.get("gs")
                planes[icao] = {
                    "icao24": icao,
                    "callsign": (a.get("flight") or "").strip() or (a.get("r") or icao),
                    "originCountry": "",
                    "type": a.get("t") or "",
                    "lat": a_lat,
                    "lon": a_lon,
                    "altitude": round(alt * 0.3048, 1) if isinstance(alt, (int, float)) else None,  # ft → m
                    "speed": round(gs * 0.514444, 2) if isinstance(gs, (int, float)) else None,       # knot → m/s
                    "heading": a.get("track") if a.get("track") is not None else a.get("true_heading"),
                    "source": name,
                }
            time.sleep(REQUEST_GAP_SEC)

    total = len(GRID_LATS) * len(GRID_LONS)
    if fail == total:
        raise RuntimeError(f"{name} 전체 요청 실패")
    return planes


def merge(base, extra):
    """이미 있는 항공기는 비어 있는 정보(기종·국가)만 채우고, 없는 항공기는 추가"""
    added = 0
    for icao, p in extra.items():
        if icao in base:
            for key in ("type", "originCountry"):
                if not base[icao].get(key) and p.get(key):
                    base[icao][key] = p[key]
        else:
            base[icao] = p
            added += 1
    return added


def main():
    all_planes = {}
    source_counts = {}

    try:
        opensky = fetch_opensky()
        source_counts["OpenSky"] = len(opensky)
        merge(all_planes, opensky)
        print(f"OpenSky: {len(opensky)}대")
    except Exception as exc:
        print(f"[경고] OpenSky 수집 실패: {exc}", file=sys.stderr)

    for name, tmpl in ADSB_SOURCES.items():
        try:
            got = fetch_adsb_source(name, tmpl)
            source_counts[name] = len(got)
            added = merge(all_planes, got)
            print(f"{name}: {len(got)}대 (새로 추가 {added}대)")
        except Exception as exc:
            print(f"[경고] {name} 수집 실패: {exc}", file=sys.stderr)

    if not source_counts:
        print("[오류] 모든 데이터 출처에서 수집에 실패했습니다. 기존 파일을 유지합니다.", file=sys.stderr)
        sys.exit(1)

    planes = list(all_planes.values())
    output = {
        "_readme": "이 파일은 GitHub Actions가 OpenSky·adsb.lol·adsb.fi 공개 데이터를 합쳐 자동 생성/갱신합니다. 직접 수정하지 마세요.",
        "region": "Middle East",
        "sources": source_counts,
        "count": len(planes),
        "planes": planes,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"합계: 중복 제외 항공기 {len(planes)}대 → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
