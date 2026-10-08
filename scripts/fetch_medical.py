"""
비스마야 현장 주변 의료시설 (병원·의원·응급실) 수집 → medical-facilities.json

- 오픈스트리트맵(OSM) Overpass API 에서 현장 반경 RADIUS_KM 안의 병원·의원을 찾는다
- 현장에서 직선거리를 계산하고, 가까운 곳은 OSRM(공개 길찾기)로 도로 거리·차 이동 시간도 구한다
- 공립/사립 구분은 OSM 의 operator:type 태그와 이름(حكومي/مستشفى ... العام 등)으로 추정한다
- GitHub Actions 가 매주 한 번 실행 (병원 정보는 자주 바뀌지 않음)
"""
import json, math, time, datetime, sys
import requests

SITE = (33.193, 44.618)          # 비스마야 현장 (위도, 경도)
RADIUS_KM = 45
ROUTE_TOP = 40                    # 도로 거리를 계산할 가까운 시설 수
OUT = "medical-facilities.json"
HEAD = {"User-Agent": "BNCP-HSE-Dashboard/1.0 (GitHub Actions; contact via repo)"}
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.private.coffee/api/interpreter"]


def hav(a, b):
    R = 6371.0
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def overpass():
    r = RADIUS_KM * 1000
    lat, lon = SITE
    q = f"""[out:json][timeout:90];
(
  nwr(around:{r},{lat},{lon})["amenity"~"^(hospital|clinic|doctors)$"];
  nwr(around:{r},{lat},{lon})["healthcare"~"^(hospital|clinic|centre|doctor)$"];
  nwr(around:{r},{lat},{lon})["emergency"="yes"]["amenity"];
);
out center tags;"""
    last = None
    for url in OVERPASS:
        for attempt in range(2):
            try:
                res = requests.post(url, data={"data": q}, headers=HEAD, timeout=120)
                if res.status_code == 200:
                    return res.json().get("elements", [])
                last = f"{url} → {res.status_code}"
            except Exception as e:  # noqa
                last = f"{url} → {e}"
            time.sleep(5)
    raise RuntimeError(f"Overpass 실패: {last}")


def kind_of(t):
    a, h = t.get("amenity", ""), t.get("healthcare", "")
    if a == "hospital" or h == "hospital":
        return "hospital"
    if a == "doctors" or h == "doctor":
        return "doctors"
    return "clinic"


def ownership(t):
    ot = (t.get("operator:type") or "").lower()
    name = " ".join(t.get(k, "") for k in ("name", "name:ar", "name:en", "operator")).lower()
    if ot in ("government", "public", "state"):
        return "public"
    if ot in ("private", "commercial"):
        return "private"
    if any(w in name for w in ("حكومي", "العام", "التعليمي", "general hospital", "teaching hospital", "ministry of health", "وزارة الصحة")):
        return "public"
    if any(w in name for w in ("أهلي", "الأهلي", "private", "خاص")):
        return "private"
    return ""


def main():
    els = overpass()
    print(f"OSM 결과 {len(els)}건")
    seen, items = set(), []
    for e in els:
        t = e.get("tags", {}) or {}
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        lon = e.get("lon") or (e.get("center") or {}).get("lon")
        if lat is None or lon is None:
            continue
        name = t.get("name") or t.get("name:en") or t.get("name:ar") or ""
        if not name and kind_of(t) != "hospital":
            continue  # 이름 없는 작은 의원은 뺀다
        key = (round(lat, 4), round(lon, 4), name)
        if key in seen:
            continue
        seen.add(key)
        items.append({
            "id": f"{e['type']}/{e['id']}",
            "name": name or "(이름 없는 병원)",
            "nameEn": t.get("name:en", ""), "nameAr": t.get("name:ar", ""),
            "kind": kind_of(t), "own": ownership(t),
            "emergency": t.get("emergency") == "yes",
            "beds": t.get("beds", ""), "phone": t.get("phone") or t.get("contact:phone", ""),
            "website": t.get("website") or t.get("contact:website", ""),
            "addr": ", ".join(x for x in (t.get("addr:street", ""), t.get("addr:city", "") or t.get("addr:district", "")) if x),
            "lat": round(lat, 6), "lon": round(lon, 6),
            "km": round(hav(SITE, (lat, lon)), 1),
        })
    items.sort(key=lambda x: x["km"])

    # 도로 거리·시간 (가까운 병원 우선, 그다음 의원)
    near = [x for x in items if x["kind"] == "hospital"][:ROUTE_TOP] + [x for x in items if x["kind"] != "hospital"][:ROUTE_TOP // 2]
    if near:
        coords = f"{SITE[1]},{SITE[0]};" + ";".join(f"{x['lon']},{x['lat']}" for x in near)
        try:
            res = requests.get(f"https://router.project-osrm.org/table/v1/driving/{coords}",
                               params={"sources": "0", "annotations": "duration,distance"}, headers=HEAD, timeout=60)
            j = res.json()
            if j.get("code") == "Ok":
                durs, dists = j["durations"][0][1:], j["distances"][0][1:]
                for x, du, di in zip(near, durs, dists):
                    if du is not None and di is not None:
                        x["roadKm"] = round(di / 1000, 1)
                        x["min"] = int(round(du / 60))
                print(f"도로 거리 계산 {len(near)}곳")
            else:
                print("OSRM 응답:", j.get("code"), j.get("message"))
        except Exception as e:  # noqa
            print("OSRM 실패:", e)

    out = {
        "_readme": "비스마야 현장 주변 의료시설. 출처: OpenStreetMap(© OpenStreetMap contributors), 도로 거리·시간: OSRM. GitHub Actions 가 매주 갱신.",
        "site": {"lat": SITE[0], "lon": SITE[1]},
        "radiusKm": RADIUS_KM,
        "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "items": items,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    h = sum(1 for x in items if x["kind"] == "hospital")
    print(f"저장: 병원 {h} · 의원 등 {len(items) - h} → {OUT}")
    if not items:
        sys.exit(1)


if __name__ == "__main__":
    main()
