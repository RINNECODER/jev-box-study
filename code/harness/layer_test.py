"""Loose crop -> Box 'the sheet on top' -> tight crop -> isolation question."""
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
ISO = {"own": {"type": "choice", "instructions": "Look only at the top sheet of paper in `img`. Does everything printed on it belong to that sheet's own content?",
  "criteria": {"only its own content": "every word and line on this sheet belongs to its own text and layout",
               "contains something from another sheet": "a stray word, number or table line that belongs to a different document is printed on this sheet",
               "can't tell": "unclear"}}}
for arg in sys.argv[2:]:
    name, box = arg.split(":"); box = tuple(map(int, box.split(","))); loose = src.crop(box)
    b = jev(loose, {"b": {"type": "box", "instructions": "the single sheet of paper in `img` that lies on top of the others"}})["b"]["box"]
    W, H = loose.size; tight = loose.crop((b["left"] * W, b["top"] * H, b["right"] * W, b["bottom"] * H))
    p = jev(tight, ISO)["own"]["probabilities"]
    print(f"{name:26s} tight={tight.size} stray={p['contains something from another sheet']:.2f} own={p['only its own content']:.2f}")
