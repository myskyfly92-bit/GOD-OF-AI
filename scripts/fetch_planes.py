"""
OpenSky Network REST API(OAuth2 client credentials 인증)로 중동 전역의
실시간 항공기 위치를 가져와 planes.json 파일로 저장합니다.

사전 준비:
    https://opensky-network.org 가입 → Account 페이지에서 API 클라이언트 생성
    → client_id, client_secret 발급
    저장소 Settings > Secrets and variables > Actions 에
    OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET 로 각각 등록

로컬 실행:
    pip install requests
    OPENSKY_CLIENT_ID=... OPENSKY_CLIENT_SECRET=... python scripts/fetch_planes.py
"""

import json
import os
import sys
from datetime import datetime, timezone

import requests

TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
STATES_URL = "https://opensky-network.org/api/states/all"

# 중동 전역 (튀르키예 남부·레바논·사우디·이란·예멘·오만 포함)
BBOX = {"lamin": 12.0, "lomin": 30.0, "lamax": 42.0, "lomax": 63.0}

OUTPUT_PATH = "planes.json"


def get_access_token(client_id, client_secret):
    resp = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def fetch_states(token):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    resp = requests.get(STATES_URL, params=BBOX, headers=headers, timeout=20)
    if resp.status_code != 200:
        print(f"[오류] API 응답 코드: {resp.status_code}", file=sys.stderr)
        print(f"[오류] API 응답 본문: {resp.text[:1000]}", file=sys.stderr)
    resp.raise_for_status()
    return resp.json()


def main():
    client_id = os.environ.get("OPENSKY_CLIENT_ID")
    client_secret = os.environ.get("OPENSKY_CLIENT_SECRET")

    token = None
    if client_id and client_secret:
        try:
            token = get_access_token(client_id, client_secret)
        except Exception as exc:
            print(f"[경고] 토큰 발급 실패, 익명으로 시도합니다: {exc}", file=sys.stderr)
    else:
        print("[안내] OPENSKY_CLIENT_ID/SECRET이 없어 익명으로 조회합니다 (요청 제한이 더 낮습니다).", file=sys.stderr)

    data = fetch_states(token)

    states = data.get("states") or []
    planes = []
    for s in states:
        # OpenSky states 배열 순서: icao24, callsign, origin_country, time_position,
        # last_contact, longitude, latitude, baro_altitude, on_ground, velocity,
        # true_track, vertical_rate, sensors, geo_altitude, squawk, spi, position_source
        icao24 = s[0]
        callsign = (s[1] or "").strip()
        lon = s[5]
        lat = s[6]
        altitude = s[7]
        on_ground = s[8]
        velocity = s[9]
        true_track = s[10]

        if lat is None or lon is None or on_ground:
            continue

        planes.append({
            "icao24": icao24,
            "callsign": callsign or icao24,
            "originCountry": s[2],
            "lat": lat,
            "lon": lon,
            "altitude": altitude,
            "speed": velocity,
            "heading": true_track,
        })

    output = {
        "_readme": "이 파일은 GitHub Actions가 OpenSky Network API로 자동 생성/갱신합니다. 직접 수정하지 마세요.",
        "region": "Middle East",
        "count": len(planes),
        "planes": planes,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"항공기 {len(planes)}대 위치 수집 완료 → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
