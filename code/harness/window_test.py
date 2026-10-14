"""Slide small windows over an image; ask the isolation question in each; print top windows."""
import base64, io, json, ssl, subprocess, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageOps, ImageDraw
import os; key = os.environ["TYPESAFE_API_KEY"]
ctx = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
src = Image.open(sys.argv[1]).convert("RGB"); win = int(sys.argv[2]); out = sys.argv[3]
def enc(im):
    s = min(1568 / max(im.size), max(1, 1024 / max(im.size))); im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, "JPEG", quality=92); return base64.b64encode(b.getvalue()).decode()
Q = {"own": {"type": "choice", "instructions": "`img` is a small window onto a desk covered with papers. Look at the sheet that lies on top in this window. Does everything printed on it belong to that sheet's own content?",
  "criteria": {"only its own content": "every word and line on the top sheet belongs to its own text and layout, or there is no clear top sheet",
               "contains something from another sheet": "a stray word, number or table line that belongs to a different, lower sheet is printed on the top sheet",
               "can't tell": "unclear"}}}
def ask(box):
    body = {"model": "jev-1.14.0", "state": {"img": "w-img"}, "assets": {"w-img": {"type": "image", "format": "jpeg", "data_base64": enc(src.crop(box))}}, "questions": Q}
    req = urllib.request.Request("https://api.typesafe.ai/v1/systemone", json.dumps(body).encode(), {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "TypeSafe-Danger-Zone-Images": "true"})
    return box, json.load(urllib.request.urlopen(req, timeout=120, context=ctx))["answers"]["own"]["probabilities"]["contains something from another sheet"]
step = win // 2; W, H = src.size
boxes = [(x, y, min(W, x + win), min(H, y + win)) for y in range(0, max(1, H - win // 2), step) for x in range(0, max(1, W - win // 2), step)]
with ThreadPoolExecutor(6) as ex: res = sorted(ex.map(ask, boxes), key=lambda r: -r[1])
print(len(res), "windows; >=0.8:", sum(p >= .8 for _, p in res), " >=0.6:", sum(p >= .6 for _, p in res))
for b, p in res[:6]: print("  ", b, round(p, 2))
d = ImageDraw.Draw(src)
for b, p in res:
    if p >= .6: d.rectangle(b, outline=(255, 0, 0) if p >= .8 else (255, 170, 0), width=3); d.text((b[0] + 4, b[1] + 4), f"{p:.2f}", fill=(255, 0, 0))
src.save(out)
