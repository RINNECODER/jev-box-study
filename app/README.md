# Hallucination Check — the website

The exact code running at https://hallucination-check.vercel.app.

- `public/index.html` — the whole pipeline in the browser: decodes images and video frames, discovers items
  (targeted Box searches + two window scales), crops, averages repeats, runs confirmation, the table and layering
  checks, merges boxes, draws results, share image, cost meter.
- `api/check.js` — Vercel function: every prompt sent to Jev, the flat hallucination list, retries with backoff,
  per-IP and daily rate limits. The TypeSafe key stays server-side; the endpoint only accepts its own question shapes.

## Run locally

```
export TYPESAFE_API_KEY=...        # your TypeSafe key
node dev.mjs                       # http://127.0.0.1:4871
```

## Deploy

```
vercel                              # then set TYPESAFE_API_KEY as an environment variable in the Vercel project
vercel --prod
```

Optional: connect Upstash Redis (Vercel Marketplace) so rate limits are shared across instances
(`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`); limits are `LIMIT_PER_IP_HOUR` (default 300) and
`LIMIT_GLOBAL_DAY` (default 5000).
