"""Vertical bands across a table (30% width, 5 positions), enlarged; ask if horizontal lines/rows step within the band."""
import base64, io, json, ssl, subprocess, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageOps
import os; key = os.environ["TYPESAFE_API_KEY"]
ctx = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
Q = {"step": {"type": "choice", "instructions": "`img` is a narrow vertical slice of a table showing parts of two or three neighbouring columns. Ignore what the text says. Compare the heights of the rows on the left side of the slice with the rows on the right side.",
  "criteria": {"rows continue level across": "each row on the left continues at the same height on the right",
               "rows are shifted between columns": "the right-hand column's rows sit noticeably higher or lower than the left-hand column's rows, or a column has an extra row",
               "can't tell": "only one column visible, or unclear"}}}
def enc(im):
    s = min(1568 / max(im.size), 1100 / im.width if im.width < 1100 else 1); im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    im = ImageOps.pad(im, (max(im.width, 280), max(im.height, 280)), color=(255, 255, 255))
    b = io.BytesIO(); im.save(b, "JPEG", quality=92); return base64.b64encode(b.getvalue()).decode()
def ask(im):
    body = {"model": "jev-1.14.0", "state": {"img": "b-img"}, "assets": {"b-img": {"type": "image", "format": "jpeg", "data_base64": enc(im)}}, "questions": Q}
    req = urllib.request.Request("https://api.typesafe.ai/v1/systemone", json.dumps(body).encode(), {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "TypeSafe-Danger-Zone-Images": "true"})
    return json.load(urllib.request.urlopen(req, timeout=120, context=ctx))["answers"]["step"]["probabilities"]["rows are shifted between columns"]
cases = json.load(open(sys.argv[1]))
for name, (path, box) in cases.items():
    t = Image.open(path).convert("RGB").crop(tuple(box)); W = t.width; bw = W * 0.3
    bands = [t.crop((x, 0, x + bw, t.height)) for x in [i * (W - bw) / 4 for i in range(5)]]
    with ThreadPoolExecutor(5) as ex: r = list(ex.map(ask, bands))
    print(f"{name:30s} max {max(r):.2f}  bands {[round(v, 2) for v in r]}")
