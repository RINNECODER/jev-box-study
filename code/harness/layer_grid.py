"""Ensemble layer check (local server mode 'layer') on overlapping windows of size WIN over the whole image."""
import base64, io, json, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageOps
src = Image.open(sys.argv[1]).convert("RGB"); WIN = int(sys.argv[2]); W, H = src.size
def enc(im):
    s = min(1568 / max(im.size), max(1, 1024 / max(im.size))); im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, "JPEG", quality=92); return base64.b64encode(b.getvalue()).decode()
def ask(box):
    req = urllib.request.Request("http://127.0.0.1:4871/api/check", json.dumps({"mode": "layer", "images": [enc(src.crop(box))]}).encode(), {"Content-Type": "application/json"})
    return box, json.load(urllib.request.urlopen(req, timeout=120))["layer"]
step = WIN * 0.6
xs = [round(i * step) for i in range(int((W - WIN) / step) + 2)]; ys = [round(i * step) for i in range(int((H - WIN) / step) + 2)]
boxes = [(min(x, W - WIN), min(y, H - WIN), min(x, W - WIN) + WIN, min(y, H - WIN) + WIN) for y in ys for x in xs]
boxes = list(dict.fromkeys(boxes))
with ThreadPoolExecutor(6) as ex: r = sorted(ex.map(ask, boxes), key=lambda t: -t[1])
print(f"{sys.argv[1]} win {WIN}: {len(r)} windows, top: {[(b, round(v, 2)) for b, v in r[:3]]}, >=0.62: {sum(v >= .62 for _, v in r)}")
