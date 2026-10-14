"""Two strip questions per strip, angle sweep; report best-angle score per question and averaged."""
import base64, io, json, ssl, subprocess, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageOps
import os; key = os.environ["TYPESAFE_API_KEY"]
ctx = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
Q = {"row": {"type": "choice", "instructions": "`img` is a thin horizontal strip cut from a table. Describe only what is physically inside this strip.",
  "criteria": {"label with its values": "a row label and the numbers or cells that belong to it, on the same line",
               "label with no values": "a row label but the value cells on its line are empty",
               "values with no label": "values but no row label on this line", "header": "column headers",
               "between rows or not a row": "a border line, the gap between two rows, or not part of a table"}},
     "same": {"type": "choice", "instructions": "`img` is a thin horizontal strip cut from a table. Look along the line from left to right: do the cells on it line up as one row?",
  "criteria": {"one aligned row": "every cell on the line sits level with the others, inside the same row lines",
               "cells from different rows": "some cells sit higher or lower than the others, as if columns slid up or down",
               "not a table row": "a header, border or gap between rows"}}}
def enc(im):
    s = min(1568 / im.width, 4); im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    im = ImageOps.pad(im, (im.width, max(im.height, 280)), color=(255, 255, 255))
    b = io.BytesIO(); im.save(b, "JPEG", quality=92); return base64.b64encode(b.getvalue()).decode()
def ask(strip):
    body = {"model": "jev-1.14.0", "state": {"img": "s-img"}, "assets": {"s-img": {"type": "image", "format": "jpeg", "data_base64": enc(strip)}}, "questions": Q}
    req = urllib.request.Request("https://api.typesafe.ai/v1/systemone", json.dumps(body).encode(), {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "TypeSafe-Danger-Zone-Images": "true"})
    a = json.load(urllib.request.urlopen(req, timeout=120, context=ctx))["answers"]
    p1 = a["row"]["probabilities"]; p2 = a["same"]["probabilities"]
    return max(p1.values()), 1 - p2["cells from different rows"]
def score(path, box, n=6, angles=(0, -4, 4, -8, 8)):
    src = Image.open(path).convert("RGB"); best1 = best2 = bestm = 0
    for ang in angles:
        t = src.crop(box).rotate(ang, resample=Image.BICUBIC, fillcolor=(255, 255, 255)); h = t.height / n
        strips = [t.crop((0, max(0, i * h - h * .15), t.width, min(t.height, (i + 1) * h + h * .15))) for i in range(n)]
        with ThreadPoolExecutor(6) as ex: r = list(ex.map(ask, strips))
        m1 = sum(a for a, _ in r) / n; m2 = sum(b for _, b in r) / n
        best1, best2, bestm = max(best1, m1), max(best2, m2), max(bestm, (m1 + m2) / 2)
    return best1, best2, bestm
cases = json.load(open(sys.argv[1]))
for name, (path, box) in cases.items():
    b1, b2, bm = score(path, tuple(box)); print(f"{name:30s} q1 {b1:.2f}  q2 {b2:.2f}  mean {bm:.2f}")
