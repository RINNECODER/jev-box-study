"""Isolation question on each quadrant of a page crop."""
import base64, io, json, ssl, subprocess, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageOps
import os; key = os.environ["TYPESAFE_API_KEY"]
ctx = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
src = Image.open(sys.argv[1]).convert("RGB")
def enc(im):
    s = min(1568 / max(im.size), max(1, 1024 / max(im.size))); im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    if min(im.size) < 280: im = ImageOps.pad(im, (max(im.width, 280), max(im.height, 280)), color=(255, 255, 255))
    b = io.BytesIO(); im.save(b, "JPEG", quality=92); return base64.b64encode(b.getvalue()).decode()
ISO = {"own": {"type": "choice", "instructions": "Look only at the top sheet of paper in `img`. Does everything printed on it belong to that sheet's own content?",
  "criteria": {"only its own content": "every word and line on this sheet belongs to its own text and layout",
               "contains something from another sheet": "a stray word, number or table line that belongs to a different document is printed on this sheet",
               "can't tell": "unclear"}}}
def ask(im):
    body = {"model": "jev-1.14.0", "state": {"img": "q-img"}, "assets": {"q-img": {"type": "image", "format": "jpeg", "data_base64": enc(im)}}, "questions": ISO}
    req = urllib.request.Request("https://api.typesafe.ai/v1/systemone", json.dumps(body).encode(), {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "TypeSafe-Danger-Zone-Images": "true"})
    return json.load(urllib.request.urlopen(req, timeout=120, context=ctx))["answers"]["own"]["probabilities"]["contains something from another sheet"]
GRID = 3
for arg in sys.argv[2:]:
    name, box = arg.split(":"); x0, y0, x1, y1 = map(int, box.split(",")); w, h = x1 - x0, y1 - y0
    n = int(sys.argv[2]) if False else GRID
    cw, ch = w * 1.3 / n, h * 1.3 / n
    cells = [(x0 + c * (w - cw) / (n - 1), y0 + r * (h - ch) / (n - 1)) for r in range(n) for c in range(n)]
    with ThreadPoolExecutor(6) as ex: r = list(ex.map(lambda p: ask(src.crop((p[0], p[1], p[0] + cw, p[1] + ch))), cells))
    top = max(range(len(r)), key=lambda i: r[i])
    print(f"{name:20s} max {r[top]:.2f} at cell {top}  others: {sorted(round(v,2) for v in r)[-3:]}")
