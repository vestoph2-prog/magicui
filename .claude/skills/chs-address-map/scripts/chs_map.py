#!/usr/bin/env python3
"""Разметка частного сектора по скриншоту Конструктора карт Яндекса.

Шаг 1 (detect): GeoJSON с полигоном зоны + скриншот, где этот полигон виден
красной линией. Скрипт находит красный контур, привязывает картинку к
координатам (аффинное преобразование), находит здания внутри зоны и рисует
превью с номерами найденных зданий.

Шаг 2 (build): JSON с подписями домов (текст + пиксель на скриншоте).
Скрипт привязывает подписи к зданиям и выдаёт:
  * GeoJSON для Конструктора карт: полигон, зелёные метки домов с номером,
    жёлтые метки "?" на зданиях без номера;
  * пустой костяк таблицы адресной программы (.xls) по образцу "АП ЧС".

Зависимости: numpy, pillow, xlrd, xlwt, xlutils.
"""

import argparse
import json
import shutil
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE.parent / "assets" / "template_AP_CHS.xls"

def _font(size=13):
    from PIL import ImageFont
    for f in ("DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "arial.ttf",
              "C:/Windows/Fonts/arial.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()


GREEN = "#1bad03"
YELLOW = "#ffd21e"
RED = "#ed4543"


# ---------------------------------------------------------------- геометрия
def load_polygon(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    feats = data["features"] if data.get("type") == "FeatureCollection" else [data]
    for f in feats:
        g = f["geometry"]
        if g["type"] == "Polygon":
            return data, f, np.array(g["coordinates"][0], dtype=float)
        if g["type"] == "MultiPolygon":
            return data, f, np.array(g["coordinates"][0][0], dtype=float)
    sys.exit("В GeoJSON не найден полигон зоны")


def red_mask(img):
    a = np.asarray(img, dtype=np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (r > 190) & (g < 140) & (b < 140) & (r - g > 90)


def components(mask):
    """Связные компоненты (4-связность) -> список массивов точек (x, y)."""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    comps = []
    for y0, x0 in zip(*np.nonzero(mask)):
        if lab[y0, x0]:
            continue
        cid = len(comps) + 1
        q = deque([(y0, x0)])
        lab[y0, x0] = cid
        pts = []
        while q:
            y, x = q.popleft()
            pts.append((x, y))
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lab[ny, nx]:
                    lab[ny, nx] = cid
                    q.append((ny, nx))
        comps.append(np.array(pts))
    return comps


def largest_component(mask):
    comps = components(mask)
    out = np.zeros_like(mask)
    if comps:
        big = max(comps, key=len)
        out[big[:, 1], big[:, 0]] = True
    return out


def sample_ring(ring, step):
    pts = []
    for p, q in zip(ring[:-1], ring[1:]):
        n = max(2, int(np.hypot(*(q - p)) / step))
        for t in np.linspace(0, 1, n, endpoint=False):
            pts.append(p + (q - p) * t)
    return np.array(pts)


def fit_affine(src, dst):
    a = np.c_[src, np.ones(len(src))]
    m, *_ = np.linalg.lstsq(a, dst, rcond=None)
    return m  # 3x2: [x y 1] @ m


def apply(m, pts):
    pts = np.atleast_2d(pts)
    return np.c_[pts, np.ones(len(pts))] @ m


def georeference(img, ring):
    """Подгоняет geo->pixel по красному контуру (ICP с аффинной моделью)."""
    mask = largest_component(red_mask(img))
    ys, xs = np.nonzero(mask)
    if len(xs) < 200:
        sys.exit("На скриншоте не найден красный контур полигона")
    red = np.c_[xs, ys].astype(float)
    if len(red) > 6000:
        red = red[:: len(red) // 6000 + 1]
    # без замыкающей точки для подсчёта
    lon0, lat0 = ring[:, 0].mean(), ring[:, 1].mean()
    k = np.cos(np.radians(lat0))
    loc = np.c_[(ring[:, 0] - lon0) * k, ring[:, 1] - lat0]  # почти метрика
    # начальное приближение — по габаритам
    sx = (xs.max() - xs.min()) / (np.ptp(loc[:, 0]) or 1)
    sy = (ys.max() - ys.min()) / (np.ptp(loc[:, 1]) or 1)
    s = (sx + sy) / 2
    cx, cy = (xs.max() + xs.min()) / 2, (ys.max() + ys.min()) / 2
    mx, my = (loc[:, 0].max() + loc[:, 0].min()) / 2, (loc[:, 1].max() + loc[:, 1].min()) / 2
    m = np.array([[s, 0], [0, -s], [cx - s * mx, cy + s * my]])
    samp = sample_ring(loc, np.ptp(loc[:, 0]) / 400)
    for _ in range(60):
        px = apply(m, samp)
        d = ((px[:, None, :] - red[None, :, :]) ** 2).sum(-1)
        idx = d.argmin(1)
        near = red[idx]
        dist = np.sqrt(d[np.arange(len(px)), idx])
        keep = dist < max(15, np.percentile(dist, 90))
        m_new = fit_affine(samp[keep], near[keep])
        if np.abs(m_new - m).max() < 1e-3:
            m = m_new
            break
        m = m_new
    px = apply(m, samp)
    d = ((px[:, None, :] - red[None, :, :]) ** 2).sum(-1).min(1)
    rms = float(np.sqrt(np.median(d)))
    # pixel -> geo
    full = np.c_[loc, np.ones(len(loc))]
    pix = full @ m
    inv = fit_affine(pix, ring[:, :2])
    m_per_px = 1 / abs(s) * 111_320 if s else 0
    return inv, pix, rms, m_per_px


# ---------------------------------------------------------------- здания
def point_in_poly(x, y, poly):
    inside = np.zeros(x.shape, bool)
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        cond = ((y1 > y) != (y2 > y)) & (x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-9) + x1)
        inside ^= cond
    return inside


def detect_buildings(img, pix_ring, min_area=60, max_area=20000):
    a = np.asarray(img, dtype=np.int16)
    h, w, _ = a.shape
    mx, mn = a.max(-1), a.min(-1)
    mean = a.mean(-1)
    gray = (mx - mn <= 16) & (mean >= 200) & (mean <= 249)
    yy, xx = np.mgrid[0:h, 0:w]
    zone = point_in_poly(xx, yy, pix_ring[:-1] if np.allclose(pix_ring[0], pix_ring[-1]) else pix_ring)
    mask = gray & zone & ~red_mask(img)
    comps = components(mask)
    out = []
    for pts in comps:
        area = len(pts)
        if area < min_area or area > max_area:
            continue
        x0, y0 = pts.min(0)
        x1, y1 = pts.max(0)
        bw, bh = x1 - x0 + 1, y1 - y0 + 1
        fill = area / (bw * bh)
        if fill < 0.45 or min(bw, bh) < 5 or max(bw, bh) / min(bw, bh) > 4:  # линии, тротуары
            continue
        cx, cy = pts.mean(0)
        out.append({"bbox": [int(x0), int(y0), int(x1), int(y1)], "area": int(area),
                    "px": [round(float(cx), 1), round(float(cy), 1)]})
    out.sort(key=lambda b: (b["px"][1] // 60, b["px"][0]))
    for i, b in enumerate(out, 1):
        b["id"] = i
    return out


def cmd_detect(args):
    _, _, ring = load_polygon(args.geojson)
    img = Image.open(args.screenshot).convert("RGB")
    inv, pix_ring, rms, mpp = georeference(img, ring)
    blds = detect_buildings(img, pix_ring, args.min_area)
    for b in blds:
        lon, lat = apply(inv, b["px"])[0]
        b["lon"], b["lat"] = float(lon), float(lat)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    state = {"geojson": str(Path(args.geojson).resolve()), "screenshot": str(Path(args.screenshot).resolve()),
             "pixel_to_geo": inv.tolist(), "polygon_px": pix_ring.round(1).tolist(),
             "fit_rms_px": rms, "meters_per_px": mpp, "buildings": blds}
    (out / "detect.json").write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    prev = img.copy()
    d = ImageDraw.Draw(prev)
    d.line([tuple(p) for p in pix_ring], fill=(0, 120, 255), width=2)
    for b in blds:
        d.rectangle(b["bbox"], outline=(0, 90, 255), width=2)
        x0, y0 = b["bbox"][:2]
        d.rectangle([x0, y0 - 13, x0 + 7 * len(str(b["id"])) + 4, y0], fill=(0, 90, 255))
        d.text((x0 + 2, y0 - 13), str(b["id"]), fill=(255, 255, 255), font=_font(11))
    prev.save(out / "detect_preview.png")
    print(f"Привязка: невязка ~{rms:.1f} px (~{rms * mpp:.1f} м), {mpp:.2f} м/px")
    print(f"Найдено зданий в зоне: {len(blds)}")
    print(f"Превью: {out / 'detect_preview.png'}")
    if rms > 4:
        print("ВНИМАНИЕ: красный контур совпал плохо — проверьте превью (синяя линия должна лечь на красную).")


# ---------------------------------------------------------------- build
def split_house(text):
    t = text.strip()
    num = ""
    for ch in t:
        if ch.isdigit():
            num += ch
        else:
            break
    rest = t[len(num):].strip().lstrip("/").strip()
    return num, rest


def house_sort_key(text):
    num, rest = split_house(text)
    n = int(num) if num else 10**6
    return (n % 2 == 0, n, rest)


def assign(labels, blds, max_gap):
    """Каждой подписи — здание (по id из превью или по пикселю подписи).

    Возвращает [(label, building|None, [px, py])] и множество занятых зданий.
    Если на одно здание пришлось несколько подписей (сдвоенный дом), точки
    разводятся по его частям вдоль длинной стороны.
    """
    by_id = {b["id"]: b for b in blds}
    links = []
    for lb in labels:
        b = None
        if lb.get("building") is not None:
            b = by_id.get(lb["building"])
            if b is None:
                print(f"ВНИМАНИЕ: здание #{lb['building']} для «{lb['text']}» не найдено")
        elif "x" in lb and "y" in lb:
            x, y = lb["x"], lb["y"]
            best_d = None
            for cand in blds:
                x0, y0, x1, y1 = cand["bbox"]
                dd = np.hypot(max(x0 - x, 0, x - x1), max(y0 - y, 0, y - y1))
                if best_d is None or dd < best_d:
                    b, best_d = cand, dd
            if best_d is None or best_d > max_gap:
                b = None
        links.append([lb, b])
    groups = {}
    for i, (lb, b) in enumerate(links):
        if b is not None:
            groups.setdefault(b["id"], []).append(i)
    res = []
    pos = {}
    for bid, idxs in groups.items():
        b = by_id[bid]
        if len(idxs) == 1:
            pos[idxs[0]] = b["px"]
            continue
        x0, y0, x1, y1 = b["bbox"]
        horiz = (x1 - x0) >= (y1 - y0)
        idxs.sort(key=lambda i: (links[i][0].get("x", 0), links[i][0].get("y", 0), links[i][0].get("part", 0)))
        n = len(idxs)
        for k, i in enumerate(idxs):
            lb = links[i][0]
            if "x" in lb and "y" in lb:
                pos[i] = [lb["x"], lb["y"]]
            elif horiz:
                pos[i] = [x0 + (x1 - x0) * (k + 0.5) / n, (y0 + y1) / 2]
            else:
                pos[i] = [(x0 + x1) / 2, y0 + (y1 - y0) * (k + 0.5) / n]
    for i, (lb, b) in enumerate(links):
        if b is None:
            if "x" not in lb:
                sys.exit(f"Для «{lb['text']}» нужен building или x/y")
            res.append((lb, None, [lb["x"], lb["y"]]))
        else:
            res.append((lb, b, pos[i]))
    return res, set(groups)


def write_skeleton(path, title):
    import xlrd
    from xlutils.copy import copy
    rb = xlrd.open_workbook(str(TEMPLATE), formatting_info=True)
    wb = copy(rb)
    if title:
        ws = wb.get_sheet(0)
        row = ws._Worksheet__rows.get(1)
        cell = row._Row__cells.get(0) if row else None
        xf = cell.xf_idx if cell else None
        ws.write(1, 0, f"Адресная программа строительства сетей ШПД (существующий жилой фонд) — {title}")
        if xf is not None:
            ws._Worksheet__rows[1]._Row__cells[0].xf_idx = xf
    wb.save(str(path))


def cmd_build(args):
    state = json.loads((Path(args.out) / "detect.json").read_text(encoding="utf-8"))
    spec = json.loads(Path(args.labels).read_text(encoding="utf-8"))
    inv = np.array(state["pixel_to_geo"])
    blds = state["buildings"]
    skip = set(spec.get("ignore_buildings", []))
    blds = [b for b in blds if b["id"] not in skip]
    for e in spec.get("extra_buildings", []):  # здания, которые детектор пропустил
        x, y = e["x"], e["y"]
        blds.append({"id": 10_000 + len(blds), "bbox": [x - 4, y - 4, x + 4, y + 4], "px": [x, y]})
    street = spec.get("street", "")
    labels = spec["labels"]
    for lb in labels:
        lb.setdefault("street", street)
    pairs, used = assign(labels, blds, spec.get("max_gap_px", 12))

    data, poly_feat, _ = load_polygon(state["geojson"])
    name = spec.get("name") or data.get("metadata", {}).get("name") or "Зона ЧС"
    feats = []
    pf = json.loads(json.dumps(poly_feat))
    pf["id"] = 0
    pf.setdefault("properties", {})
    feats.append(pf)

    def geo(px):
        lon, lat = apply(inv, px)[0]
        return [round(float(lon), 8), round(float(lat), 8)]

    def street_txt(s):
        s = s.strip()
        return s if not s or s.split()[0].lower().rstrip(".") in {"ул", "улица", "пер", "переулок", "пр", "проезд", "мкр", "пр-кт", "проспект", "тупик", "туп"} else f"ул. {s}"

    rows = []
    for lb, b, pos in sorted(pairs, key=lambda p: (p[0]["street"], house_sort_key(p[0]["text"]))):
        cap = f"{street_txt(lb['street'])}, д. {lb['text']}".strip(", ")
        if lb.get("note"):
            cap += f" {lb['note']}"
        feats.append({"type": "Feature", "id": len(feats),
                      "geometry": {"type": "Point", "coordinates": geo(pos)},
                      "properties": {"description": cap, "iconCaption": cap, "marker-color": GREEN}})
        rows.append((lb, pos, b))
    yellow = [b for b in blds if b["id"] not in used]
    for b in yellow:
        feats.append({"type": "Feature", "id": len(feats),
                      "geometry": {"type": "Point", "coordinates": geo(b["px"])},
                      "properties": {"description": "строение без номера на карте — уточнить (дом/хозпостройка)",
                                     "iconCaption": "?", "marker-color": YELLOW}})
    out = Path(args.out)
    gj = {"type": "FeatureCollection",
          "metadata": {"name": name, "creator": "Yandex Map Constructor",
                       "description": "зеленые - дома с номером (потенциальные Абоненты), желтые - строения без номера, уточнить"},
          "features": feats}
    safe = "".join(c if c not in '\\/:*?"<>|' else "_" for c in name)
    gj_path = out / f"{safe}.geojson"
    gj_path.write_text(json.dumps(gj, ensure_ascii=False), encoding="utf-8")
    xls_path = out / f"АП ЧС {safe}.xls"
    write_skeleton(xls_path, spec.get("table_title", name))

    # контрольное превью итоговых меток
    img = Image.open(state["screenshot"]).convert("RGB")
    d = ImageDraw.Draw(img)
    for lb, px, _ in rows:
        x, y = px
        d.ellipse([x - 6, y - 6, x + 6, y + 6], fill=(27, 173, 3), outline=(0, 0, 0))
        d.text((x + 8, y - 8), lb["text"], fill=(0, 100, 0), font=_font(14))
    for b in yellow:
        x, y = b["px"]
        d.ellipse([x - 6, y - 6, x + 6, y + 6], fill=(255, 210, 30), outline=(0, 0, 0))
    img.save(out / "result_preview.png")
    unmatched = [lb["text"] for lb, b, _ in pairs if b is None]
    print(f"Зелёных (с номером): {len(rows)}; жёлтых (без номера): {len(yellow)}")
    if unmatched:
        print("Подписи без здания под ними (метка стоит по подписи):", ", ".join(unmatched))
    print(f"GeoJSON: {gj_path}")
    print(f"Таблица (пустой костяк): {xls_path}")
    print(f"Превью: {out / 'result_preview.png'}")


def cmd_skeleton(args):
    write_skeleton(Path(args.out), args.title)
    print(args.out)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="cmd", required=True)
    a = sp.add_parser("detect", help="привязать скриншот и найти здания")
    a.add_argument("geojson")
    a.add_argument("screenshot")
    a.add_argument("--out", required=True)
    a.add_argument("--min-area", type=int, default=60)
    a.set_defaults(func=cmd_detect)
    b = sp.add_parser("build", help="собрать GeoJSON и костяк таблицы")
    b.add_argument("--out", required=True, help="та же папка, что у detect")
    b.add_argument("--labels", required=True, help="JSON с подписями домов")
    b.set_defaults(func=cmd_build)
    c = sp.add_parser("skeleton", help="только пустая таблица")
    c.add_argument("out")
    c.add_argument("--title", default="")
    c.set_defaults(func=cmd_skeleton)
    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
