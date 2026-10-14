#!/usr/bin/env python3
"""Score images through the site's API exactly as the browser does (full image + tiles), no boxes.
Usage: python3 run.py DIR [DIR...]  -> scores.json ; needs `node dev.mjs` on :4871"""
import base64, io, json, math, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image, ImageOps

MIN, MAX, TILE, GRID = 280, 1568, 1400, 3

def fit(im):
    w, h = im.size
    s = min(1, MAX / max(w, h))
    if min(w, h) * s < MIN: s = min(MIN / min(w, h), MAX / max(w, h))
    im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    if min(im.size) < MIN: im = ImageOps.pad(im, (max(im.width, MIN), max(im.height, MIN)))
    return im

def parts(path):
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    out = [("full", fit(im))]
    s = min(1, GRID * TILE * 0.88 / max(im.size)); W, H = im.width * s, im.height * s
    cols, rows = min(GRID, math.ceil(W / (TILE * .88))), min(GRID, math.ceil(H / (TILE * .88)))
    if cols * rows > 1:
        tw, th = min(W, W / cols * 1.15), min(H, H / rows * 1.15)
        for r in range(rows):
            for c in range(cols):
                x = c * (W - tw) / (cols - 1) if cols > 1 else 0
                y = r * (H - th) / (rows - 1) if rows > 1 else 0
                out.append(("tile", fit(im.crop((x / s, y / s, (x + tw) / s, (y + th) / s)))))
    return out

def score(scope, im):
    b = io.BytesIO(); im.save(b, "JPEG", quality=90)
    body = json.dumps({"mode": "image", "scope": scope, "images": [base64.b64encode(b.getvalue()).decode()]}).encode()
    req = urllib.request.Request("http://127.0.0.1:4871/api/check", body, {"Content-Type": "application/json"})
    return scope, json.load(urllib.request.urlopen(req, timeout=180))["scores"]

files = [p for d in sys.argv[1:] for p in sorted(Path(d).iterdir()) if p.suffix.lower() in (".jpg", ".jpeg", ".png")]
res = {}
with ThreadPoolExecutor(4) as ex:
    for f in files:
        ps = parts(f)
        res[f"{f.parent.name}/{f.name}"] = list(ex.map(lambda p: score(*p), ps))
        print(f.name, len(ps), "parts", flush=True)
json.dump(res, open("scores.json", "w"))
