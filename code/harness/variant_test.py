import base64, io, json, ssl, subprocess, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageOps
import os; key = os.environ["TYPESAFE_API_KEY"]
ctx = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
src = Image.open(sys.argv[1]).convert("RGB"); qs = json.load(open(sys.argv[2]))
def enc(im):
    s = min(1568 / max(im.size), max(1, 1024 / max(im.size))); im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    if min(im.size) < 280: im = ImageOps.pad(im, (max(im.width, 280), max(im.height, 280)), color=(255, 255, 255))
    b = io.BytesIO(); im.save(b, "JPEG", quality=92); return base64.b64encode(b.getvalue()).decode()
def cell(box, i, n=3):
    x0, y0, x1, y1 = box; w, h = x1 - x0, y1 - y0; cw, ch = w * 1.3 / n, h * 1.3 / n; r, c = divmod(i, n)
    x, y = x0 + c * (w - cw) / (n - 1), y0 + r * (h - ch) / (n - 1); return (x, y, x + cw, y + ch)
def ask(crop):
    body = {"model": "jev-1.14.0", "state": {"img": "v-img"}, "assets": {"v-img": {"type": "image", "format": "jpeg", "data_base64": enc(src.crop(crop))}}, "questions": qs}
    req = urllib.request.Request("https://api.typesafe.ai/v1/systemone", json.dumps(body).encode(), {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "TypeSafe-Danger-Zone-Images": "true"})
    a = json.load(urllib.request.urlopen(req, timeout=120, context=ctx))["answers"]; out = {}
    for k, v in a.items():
        if "noul" in v: out[k] = v["noul"]
        else: out[k] = list(v["probabilities"].values())[1] if k == "v4_belongs" else (v["probabilities"].get("contains something from another sheet") if k == "v1_own" else v["probabilities"].get("yes, something shows on top"))
    return out
crops = {k: (cell(tuple(v[0]), v[1]) if isinstance(v, list) and len(v) == 2 else tuple(v)) for k, v in json.load(open(sys.argv[3])).items()}
with ThreadPoolExecutor(6) as ex: res = dict(zip(crops, ex.map(ask, crops.values())))
keys = list(qs)
print(f"{'crop':28s}" + "".join(f"{k:>12s}" for k in keys))
for name, r in res.items(): print(f"{name:28s}" + "".join(f"{r[k]:12.2f}" for k in keys))
