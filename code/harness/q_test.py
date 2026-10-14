"""Ask custom questions on crops directly against Jev. python3 q_test.py IMAGE QUESTIONS.json 'name:x0,y0,x1,y1' ..."""
import base64, io, json, ssl, subprocess, sys, urllib.request
from PIL import Image, ImageOps
import os; key = os.environ["TYPESAFE_API_KEY"]
ctx = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
src = Image.open(sys.argv[1]).convert("RGB"); qs = json.load(open(sys.argv[2]))
def enc(im):
    s = min(1568 / max(im.size), max(1, 1024 / max(im.size)))
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    if min(im.size) < 280: im = ImageOps.pad(im, (max(im.width, 280), max(im.height, 280)))
    b = io.BytesIO(); im.save(b, "JPEG", quality=92); return base64.b64encode(b.getvalue()).decode()
for arg in sys.argv[3:]:
    name, box = arg.split(":"); box = tuple(map(int, box.split(",")))
    body = {"model": "jev-1.14.0", "state": {"img": "a1-img"}, "assets": {"a1-img": {"type": "image", "format": "jpeg", "data_base64": enc(src.crop(box))}}, "questions": qs}
    req = urllib.request.Request("https://api.typesafe.ai/v1/systemone", json.dumps(body).encode(),
        {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "TypeSafe-Danger-Zone-Images": "true"})
    a = json.load(urllib.request.urlopen(req, timeout=180, context=ctx))["answers"]
    out = {k: (round(v["noul"], 2) if "noul" in v else max(v["probabilities"], key=v["probabilities"].get) + f" {max(v['probabilities'].values()):.2f}") for k, v in a.items()}
    print(f"{name:24s}", out)
