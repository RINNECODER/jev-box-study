"""Cut a table crop into overlapping horizontal strips and ask Jev what each strip physically contains."""
import base64, io, json, ssl, subprocess, sys, urllib.request
from PIL import Image, ImageOps
import os; key = os.environ["TYPESAFE_API_KEY"]
ctx = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
src = Image.open(sys.argv[1]).convert("RGB")
Q = {"row": {"type": "choice", "instructions": "`img` is a thin horizontal strip cut from a table. Describe only what is physically inside this strip.",
  "criteria": {"label with its values": "a row label and the numbers that belong to it, on the same line",
               "label with no values": "a row label but the value cells on its line are empty",
               "values with no label": "numbers but no row label on this line",
               "header": "column headers",
               "between rows or not a row": "a border line, the gap between two rows, or not part of a table"}}}
def enc(im):
    s = min(1568 / im.width, 4); im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    im = ImageOps.pad(im, (im.width, max(im.height, 280)), color=(255, 255, 255))
    b = io.BytesIO(); im.save(b, "JPEG", quality=92); return base64.b64encode(b.getvalue()).decode()
name, box, n = sys.argv[2], tuple(map(int, sys.argv[3].split(","))), int(sys.argv[4])
angles = [float(a) for a in sys.argv[5].split(",")] if len(sys.argv) > 5 else [0]
from concurrent.futures import ThreadPoolExecutor
def ask(strip):
    body = {"model": "jev-1.14.0", "state": {"img": "s-img"}, "assets": {"s-img": {"type": "image", "format": "jpeg", "data_base64": enc(strip)}}, "questions": Q}
    req = urllib.request.Request("https://api.typesafe.ai/v1/systemone", json.dumps(body).encode(), {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "TypeSafe-Danger-Zone-Images": "true"})
    p = json.load(urllib.request.urlopen(req, timeout=120, context=ctx))["answers"]["row"]["probabilities"]
    top = max(p, key=p.get); return top, p[top]
for ang in angles:
    t = src.crop(box).rotate(ang, resample=Image.BICUBIC, expand=False, fillcolor=(255, 255, 255)); h = t.height / n
    strips = [t.crop((0, max(0, i * h - h * 0.15), t.width, min(t.height, (i + 1) * h + h * 0.15))) for i in range(n)]
    with ThreadPoolExecutor(6) as ex: res = list(ex.map(ask, strips))
    conf = sum(c for _, c in res) / n
    print(f"{name} angle {ang:+.0f}: mean conf {conf:.2f}  ", " | ".join(f"{t[:12]} {c:.2f}" for t, c in res))
raise SystemExit
for i in range(n):
    strip = t.crop((0, max(0, i * h - h * 0.15), t.width, min(t.height, (i + 1) * h + h * 0.15)))
    body = {"model": "jev-1.14.0", "state": {"img": "s-img"}, "assets": {"s-img": {"type": "image", "format": "jpeg", "data_base64": enc(strip)}}, "questions": Q}
    req = urllib.request.Request("https://api.typesafe.ai/v1/systemone", json.dumps(body).encode(), {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "TypeSafe-Danger-Zone-Images": "true"})
    p = json.load(urllib.request.urlopen(req, timeout=120, context=ctx))["answers"]["row"]["probabilities"]
    top = max(p, key=p.get); print(f"  strip {i}: {top} {p[top]:.2f}")
