#!/usr/bin/env python3
"""Fetch N images per Wikimedia Commons category into DIR (slowly; Commons rate-limits).
Usage: python3 fetch.py DIR N Category_A Category_B ..."""
import json, os, ssl, sys, time, urllib.parse, urllib.request
ctx = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
UA = {"User-Agent": "hallucination-check-eval/0.1"}
out, n, cats = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
os.makedirs(out, exist_ok=True)
src = os.path.join(out, "sources.json")
got = json.load(open(src)) if os.path.exists(src) else []

def get(url):
    for wait in (0, 10, 30):
        time.sleep(wait + 3)
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), context=ctx, timeout=60).read()
        except urllib.error.HTTPError as e:
            if e.code != 429: raise
    raise RuntimeError("rate limited")

for c in cats:
    q = urllib.parse.urlencode({"action": "query", "generator": "categorymembers", "gcmtitle": "Category:" + c,
        "gcmtype": "file", "gcmlimit": "25", "prop": "imageinfo", "iiprop": "url|mime|size", "iiurlwidth": "2000", "format": "json"})
    try:
        pages = list((json.loads(get("https://commons.wikimedia.org/w/api.php?" + q)).get("query") or {}).get("pages", {}).values())
    except Exception as e:
        print(c, "ERR", e); continue
    k = 0
    for p in pages:
        if k >= n: break
        ii = p["imageinfo"][0]
        if ii.get("mime") not in ("image/jpeg", "image/png") or min(ii.get("width", 0), ii.get("height", 0)) < 600: continue
        name = f"{c[:14]}_{p['pageid']}.jpg"
        if not os.path.exists(os.path.join(out, name)):
            try: data = get(ii["thumburl"])
            except Exception as e: print(name, "ERR", e); continue
            open(os.path.join(out, name), "wb").write(data)
            got.append([name, p["title"]])
        k += 1
    print(c, k, flush=True)
json.dump(got, open(src, "w"), indent=1)
