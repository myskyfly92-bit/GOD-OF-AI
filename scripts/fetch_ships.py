"""
aisstream.io 웹소켓 API로 페르시안만(걸프만) 일대의 실시간 선박 위치를
수집하여 ships.json 파일로 저장합니다.

aisstream.io는 REST가 아니라 웹소켓(WebSocket) 방식이라,
일정 시간(기본 45초) 동안 접속해서 들어오는 메시지를 모은 뒤 저장하고 종료합니다.

사전 준비:
    https://aisstream.io 에서 무료 가입 후 API 키 발급
    저장소 Settings > Secrets and variables > Actions 에 AISSTREAM_API_KEY 로 등록

로컬 실행:
    pip install websockets
    AISSTREAM_API_KEY=발급받은키 python scripts/fetch_ships.py
"""

import asyncio
import json
import os
import sys
from datetime import datetime, timezone

import websockets

# 페르시안만(걸프만) 대략적인 범위
BOUNDING_BOX = [[[24.0, 48.0], [30.5, 56.5]]]

LISTEN_SECONDS = 45  # 이 시간 동안 메시지를 수집합니다.
OUTPUT_PATH = "ships.json"
WS_URL = "wss://stream.aisstream.io/v0/stream"


async def collect_ships(api_key):
    ships = {}  # mmsi -> 최신 위치 정보

    try:
        async with websockets.connect(WS_URL, open_timeout=15) as ws:
            subscribe_msg = {
                "APIKey": api_key,
                "BoundingBoxes": BOUNDING_BOX,
                "FilterMessageTypes": ["PositionReport", "ShipStaticData"],
            }
            await ws.send(json.dumps(subscribe_msg))

            end_time = asyncio.get_event_loop().time() + LISTEN_SECONDS
            while asyncio.get_event_loop().time() < end_time:
                remaining = end_time - asyncio.get_event_loop().time()
                if remaining <= 0:
                    break
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                except asyncio.TimeoutError:
                    break

                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                msg_type = data.get("MessageType")
                meta = data.get("MetaData", {})
                mmsi = meta.get("MMSI")
                if not mmsi:
                    continue

                if mmsi not in ships:
                    ships[mmsi] = {"mmsi": mmsi, "name": meta.get("ShipName", "").strip()}

                if msg_type == "PositionReport":
                    pr = data.get("Message", {}).get("PositionReport", {})
                    ships[mmsi].update({
                        "lat": pr.get("Latitude"),
                        "lon": pr.get("Longitude"),
                        "speed": pr.get("Sog"),  # 속도(knots)
                        "course": pr.get("Cog"),  # 방위각
                        "updatedAt": meta.get("time_utc", ""),
                    })
                elif msg_type == "ShipStaticData":
                    sd = data.get("Message", {}).get("ShipStaticData", {})
                    name = (sd.get("ShipName") or meta.get("ShipName") or "").strip()
                    if name:
                        ships[mmsi]["name"] = name

    except Exception as exc:
        print(f"[오류] 웹소켓 수집 중 예외 발생: {exc}", file=sys.stderr)

    return ships


def main():
    api_key = os.environ.get("AISSTREAM_API_KEY")
    if not api_key:
        print("[오류] 환경변수 AISSTREAM_API_KEY가 설정되지 않았습니다.", file=sys.stderr)
        sys.exit(1)

    ships_dict = asyncio.run(collect_ships(api_key))

    # 위치 정보가 있는 선박만 남김
    ships_list = [s for s in ships_dict.values() if s.get("lat") is not None and s.get("lon") is not None]
    ships_list.sort(key=lambda s: s.get("name") or "")

    output = {
        "_readme": "이 파일은 GitHub Actions가 aisstream.io 웹소켓 API로 자동 생성/갱신합니다. 직접 수정하지 마세요.",
        "region": "Persian Gulf",
        "count": len(ships_list),
        "ships": ships_list,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"걸프만 선박 {len(ships_list)}척 위치 수집 완료 → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
