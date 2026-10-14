import base64, io, json, sys, urllib.request
from PIL import Image, ImageDraw
src = Image.open(sys.argv[1]).convert("RGB"); W, H = src.size
cols, rows, per = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]); MISSES = int(sys.argv[6]) if len(sys.argv) > 6 else 1; TARGET = sys.argv[7] if len(sys.argv) > 7 else "any"
def call(im):
    b = io.BytesIO(); im.save(b, "JPEG", quality=90)
    req = urllib.request.Request("http://127.0.0.1:4871/api/check", json.dumps({"mode": "find", "target": TARGET, "images": [base64.b64encode(b.getvalue()).decode()]}).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=120))
def ov(a, b):
    w = min(a[2], b[2]) - max(a[0], b[0]); h = min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0: return False
    i = w * h; A = (a[2]-a[0])*(a[3]-a[1]); B = (b[2]-b[0])*(b[3]-b[1]); return i/(A+B-i) > .5 or i/min(A,B) > .8
found, calls = [], 0
sw, sh = min(1, 1.15/cols), min(1, 1.15/rows)
for r in range(rows):
    for c in range(cols):
        x0 = (c*(1-sw)/(cols-1) if cols > 1 else 0)*W; y0 = (r*(1-sh)/(rows-1) if rows > 1 else 0)*H
        crop = src.crop((x0, y0, x0+sw*W, y0+sh*H)); cw, ch = crop.size; mine = []; misses = 0
        for i in range(per):
            res = call(crop); calls += 1; b = res["box"]
            bx = (b["left"]*cw, b["top"]*ch, b["right"]*cw, b["bottom"]*ch)
            if bx[2]-bx[0] < 8 or bx[3]-bx[1] < 8 or any(ov(m, bx) for m in mine):
                misses += 1
                if misses >= MISSES: break
                ImageDraw.Draw(crop).rectangle(bx, fill=(128,128,128)); continue
            mine.append(bx); ImageDraw.Draw(crop).rectangle(bx, fill=(128,128,128))
        found += [(x0+m[0], y0+m[1], x0+m[2], y0+m[3]) for m in mine]
out = src.copy(); d = ImageDraw.Draw(out)
for i, f in enumerate(found): d.rectangle(f, outline=(255,0,0), width=3); d.text((f[0]+4, f[1]+2), str(i+1), fill=(255,0,0))
out.save(sys.argv[5]); print(len(found), "objects,", calls, "calls")
