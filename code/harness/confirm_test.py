"""Confirm flat-list flags with a specific yes/no question; compare real-photo FPs vs office TPs."""
import base64, io, json, ssl, subprocess, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageOps
sys.path.insert(0, "."); import os; key = os.environ["TYPESAFE_API_KEY"]
ctx = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
FLAT = {}  # filled from the live server's labels + problem descriptions
srv = open("/Users/luisfernandorubiopadilla/jev-box/web/api/check.js").read()
import re
for k, l, d in re.findall(r'\n  (\w+): \["([^"]+)", "([^"]+)"\],', srv[srv.index("const FLAT = {"):srv.index("};", srv.index("const FLAT = {"))]): FLAT[k] = (l, d)
NOT = ("Real photos and documents often look unusual without being wrong: helmets, masks, costumes and props; stylised or decorative fonts, "
       "real brand names, other languages and abbreviations; hands, fingers and objects partly hidden, angled, blurred or cut off by the frame; "
       "reflections in curved or textured surfaces.")
def q(k):
    l, d = FLAT[k]
    return {"c": {"type": "noul", "instructions": {"look_alikes_that_are_fine": NOT, "question": f"Look closely at `img`. Is this really present: {l.lower()} ({d})?"},
                  "criteria": {"true": "clearly present, and not one of the fine look-alikes", "false": "not present, or only a normal look-alike"}}}
def enc(im):
    s = min(1568 / max(im.size), max(1, 1024 / max(im.size))); im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    if min(im.size) < 280: im = ImageOps.pad(im, (max(im.width, 280), max(im.height, 280)))
    b = io.BytesIO(); im.save(b, "JPEG", quality=92); return base64.b64encode(b.getvalue()).decode()
def crop(path, it):
    src = Image.open(path).convert("RGB"); W, H = src.size; b = it["box"]
    if it["kind"] == "find":
        bw, bh = b["right"] - b["left"], b["bottom"] - b["top"]; px, py = max(.03, bw * .25), max(.03, bh * .25)
        b = {"left": max(0, b["left"] - px), "top": max(0, b["top"] - py), "right": min(1, b["right"] + px), "bottom": min(1, b["bottom"] + py)}
    return src.crop((b["left"] * W, b["top"] * H, b["right"] * W, b["bottom"] * H))
def ask(job):
    path, it = job; k = it["verdict"]["key"].split(".")[1]
    body = {"model": "jev-1.14.0", "state": {"img": "c-img"}, "assets": {"c-img": {"type": "image", "format": "jpeg", "data_base64": enc(crop(path, it))}}, "questions": q(k)}
    req = urllib.request.Request("https://api.typesafe.ai/v1/systemone", json.dumps(body).encode(), {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "TypeSafe-Danger-Zone-Images": "true"})
    return json.load(urllib.request.urlopen(req, timeout=120, context=ctx))["answers"]["c"]["noul"]
jobs = []
for r in json.load(open("v14.json")):
    if "error" in r: continue
    grp = r["path"].split("/")[0]
    if grp not in ("real", "complex", "thrice"): continue
    for it in r["frames"][0]["items"]:
        v = it.get("verdict")
        if v and v["total"] >= 0.8: jobs.append((("TP " if grp == "thrice" else "FP ") + r["file"][:24], "user/office.png" if grp == "thrice" else r["path"], it))
with ThreadPoolExecutor(6) as ex: res = list(ex.map(lambda j: ask((j[1], j[2])), jobs))
for (name, _, it), c in sorted(zip(jobs, res), key=lambda x: x[0][0]):
    v = it["verdict"]; print(f"{name:28s} {v['key']:16s} list {v['total']:.2f}  confirm {c:.2f}  mean {(v['total'] + c) / 2:.2f}")
