// Local stand-in for Vercel: serves public/ and /api/check.  TYPESAFE_API_KEY=... node dev.mjs
import http from "node:http";
import { readFile } from "node:fs/promises";
import handler from "./api/check.js";

http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/check")) {
    let raw = ""; for await (const c of req) raw += c;
    req.body = raw ? JSON.parse(raw) : {};
    res.status = code => { res.statusCode = code; return res; };
    res.json = obj => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
    return handler(req, res);
  }
  const path = req.url.split("?")[0] === "/" ? "index.html" : req.url.split("?")[0].slice(1).replace(/\.\./g, "");
  const types = { html: "text/html", jpg: "image/jpeg", png: "image/png", svg: "image/svg+xml" };
  try { res.setHeader("Content-Type", types[path.split(".").pop()] || "application/octet-stream"); res.end(await readFile(`public/${path}`)); }
  catch { res.statusCode = 404; res.end(); }
}).listen(4871, () => console.log("http://127.0.0.1:4871"));
