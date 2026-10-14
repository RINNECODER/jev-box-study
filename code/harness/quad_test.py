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
for arg in sys.argv[2:]:
    name, box = arg.split(":"); x0, y0, x1, y1 = map(int, box.split(",")); w, h = x1 - x0, y1 - y0
    quads = [src.crop((x0 + dx * w * .45, y0 + dy * h * .45, x0 + dx * w * .45 + w * .55, y0 + dy * h * .45 + h * .55)) for dy in (0, 1) for dx in (0, 1)]
    with ThreadPoolExecutor(4) as ex: r = list(ex.map(ask, quads))
    print(f"{name:20s} TL {r[0]:.2f}  TR {r[1]:.2f}  BL {r[2]:.2f}  BR {r[3]:.2f}   max {max(r):.2f}")
