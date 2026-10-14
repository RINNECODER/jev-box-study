"""Run item mode on named crops: python3 crop_test.py IMAGE 'name:x0,y0,x1,y1' ..."""
import base64, io, json, sys, urllib.request
from PIL import Image, ImageOps
src = Image.open(sys.argv[1]).convert("RGB")
def enc(im):
    s = min(1568 / max(im.size), max(1, 1024 / max(im.size)))
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    if min(im.size) < 280: im = ImageOps.pad(im, (max(im.width, 280), max(im.height, 280)))
    b = io.BytesIO(); im.save(b, "JPEG", quality=92); return base64.b64encode(b.getvalue()).decode()
for arg in sys.argv[2:]:
    name, box = arg.split(":"); box = tuple(map(int, box.split(",")))
    req = urllib.request.Request("http://127.0.0.1:4871/api/check", json.dumps({"mode": "item", "images": [enc(src.crop(box))]}).encode(), {"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=180))
    cat = max(r["category"], key=r["category"].get); l = r["lists"].get(cat)
    if not l: print(f"{name:24s} cat={cat}"); continue
    tot = sum(l["problems"].values()); top = sorted(l["problems"].items(), key=lambda x: -x[1])[:3]
    print(f"{name:24s} cat={cat:6s} defect={tot:.2f} correct={l['correct']:.2f} top={[(k, round(v, 2)) for k, v in top]}")
