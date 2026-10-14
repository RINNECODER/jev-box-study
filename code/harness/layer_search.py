"""Search for layering errors with Box, then verify each hit on a tight crop. python3 layer_search.py IMAGE 'region:x0,y0,x1,y1' ..."""
import base64, io, json, ssl, subprocess, sys, urllib.request
from PIL import Image, ImageOps
import os; key = os.environ["TYPESAFE_API_KEY"]
ctx = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
src = Image.open(sys.argv[1]).convert("RGB")
def enc(im):
    s = min(1568 / max(im.size), max(1, 1024 / max(im.size))); im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    if min(im.size) < 280: im = ImageOps.pad(im, (max(im.width, 280), max(im.height, 280)), color=(255, 255, 255))
    b = io.BytesIO(); im.save(b, "JPEG", quality=92); return base64.b64encode(b.getvalue()).decode()
def jev(im, qs):
    body = {"model": "jev-1.14.0", "state": {"img": "l-img"}, "assets": {"l-img": {"type": "image", "format": "jpeg", "data_base64": enc(im)}}, "questions": qs}
    req = urllib.request.Request("https://api.typesafe.ai/v1/systemone", json.dumps(body).encode(), {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "TypeSafe-Danger-Zone-Images": "true"})
    return json.load(urllib.request.urlopen(req, timeout=120, context=ctx))["answers"]
FIND = {"b": {"type": "box", "instructions": "where one sheet of paper lies on top of another in `img`: the spot along the top sheet's edge where a word or table line from the lower sheet continues onto the top sheet"}}
ISO = {"own": {"type": "choice", "instructions": "Look only at the top sheet of paper in `img`. Does everything printed on it belong to that sheet's own content?",
  "criteria": {"only its own content": "every word and line on this sheet belongs to its own text and layout",
               "contains something from another sheet": "a stray word, number or table line that belongs to a different document is printed on this sheet",
               "can't tell": "unclear"}}}
for arg in sys.argv[2:]:
    name, box = arg.split(":"); box = tuple(map(int, box.split(","))); reg = src.crop(box); W, H = reg.size
    b = jev(reg, FIND)["b"]; bb = b["box"]
    x0, y0, x1, y1 = bb["left"] * W, bb["top"] * H, bb["right"] * W, bb["bottom"] * H
    pw, ph = max(40, (x1 - x0) * 0.6), max(40, (y1 - y0) * 0.6)
    tight = reg.crop((max(0, x0 - pw), max(0, y0 - ph), min(W, x1 + pw), min(H, y1 + ph)))
    p = jev(tight, ISO)["own"]["probabilities"]
    print(f"{name:22s} hit=({box[0]+x0:.0f},{box[1]+y0:.0f},{box[0]+x1:.0f},{box[1]+y1:.0f}) conf={b['confidence']:.2f} stray={p['contains something from another sheet']:.2f}")
