# Findings: iteration log and measurements

Longer write-up behind the [README](../README.md). Everything here comes from
the author's raw notes of 2026-10-14. Model under test: TypeSafe Jev
`jev-1.14.0`, Box type plus image input (both experimental "danger zone"
features). `jev-preview` returned HTTP 400 for Box on launch day; `jev-1.14.0`
worked. Images also work on 1.13 (without Box).

## API facts

- `POST https://api.typesafe.ai/v1/systemone` with header
  `TypeSafe-Danger-Zone-Images: true`; images go in via `assets` placeholders
  (base64 JPEG/PNG or multipart).
- Image limits: 256-1568 px per side, at least 78,400 px total (so effectively
  at least 280 px on both sides), 16 MiB per image, 32 MiB per request.
  Oversize images are rejected, not resized. EXIF is ignored.
- Box returns exactly **one** box per question (fractions 0-1) plus a
  `confidence`. It has no "nothing here" answer.
- Box sometimes returns degenerate boxes (zero width, for example
  left = right = 0.45 with confidence 0.11). They must be filtered.
- Questions in one request run in parallel and in isolation, which makes
  speculative fan-out cheap in latency.
- Noul = probability of yes. Choice = distribution over named options.
  Structured (JSON) instructions are allowed.

## v1: one noul per artifact type, box per flagged type

37 specific checks in 4 groups, with a hallucination definition prepended.

- Worked on synthetic documents with planted errors: misspellings 98%, wrong
  percentage 97%, self-contradiction 97%, date conflict 76%. A clean control
  version of the same document flagged nothing.
- Multiple hallucinations: tiles (up to 3x3, about 1400 px) plus
  "mask and repeat" (gray out the found spot, ask again, at most 4 per type).
- Broad checks misfired (an "Objects" check scored 78% on a plain document
  table), so the checks were narrowed to the 37 specific ones.
- Failed on real photos: at the default threshold 7 of 8 real photos were
  flagged. On real photos no check exceeded 0.53 on the full image, but tiles
  reached 0.64. This is a multiple-comparisons effect (37 checks x up to 10
  views, maximum taken). A tile penalty (+0.1) and threshold 0.6 gave 0/8 real
  photos flagged while planted documents were still caught.
- Still failed on "complex" real scenes (user report). Hypothesis from the
  user: every question says "hallucination / AI", which primes a yes, and busy
  scenes give the model more to say yes to.
- Wrong totals in tables were consistently missed (53%, later 0%).

## v2: neutral two layers (inventory, locate, verify on crop)

Inventory (presence nouls) then locate (Box) then verify on the crop with a
3-way Choice {normal, defect, can't tell}. "Can't tell" absorbs busy or
blurred cases.

- On 26 real images (including busy scenes from Wikimedia Commons), defect
  >= 0.8 occurred on 1 of 26 (an accordion player's hands).
- Planted errors scored about 1.0, and the wrong TOTAL was caught (0.79) for
  the first time.
- The logo check was pure noise (real angled logos scored "warped" up to
  0.99) and was removed.
- Failed on a real AI image (the user's "Overlapping Office Reports on a
  Desk", a GPT-style desk of papers): nothing flagged. Causes: (1)
  mask-and-repeat locate kept returning the same region (6 "text block" finds
  on one page); (2) object merging had only a whole-image question; (3) text
  read at page or document scale is too small.

## Crop scale decides text checks

The same absurd sentence ("The office printer turned into a purple octopus and
approved the quarterly budget"):

| Crop | "Text makes sense: defect" |
|---|---:|
| Paragraph crop | 0.90 (0.97 upscaled) |
| Whole page body crop | 0.60-0.64 |

Upscaling small crops to at least 1024 px on the long side helps a bit for
text.

## v3/v4: find and classify everything, then verify each item

The design came from the user. A research agent produced the artifact
taxonomy: hands, text/logos, faces/teeth, eyewear, objects in contact/straps,
crowds, clothing, jewelry/watches, reflections, furniture/architecture,
vehicles, animals, food, clocks/keyboards/instruments, hair, plants; scene
level: lighting/shadows, perspective, background mush, cloned elements; video:
morphing, popping, physics, flicker. Sources: SynArtifact (arXiv 2402.18068),
Northwestern/Kellogg guide (arXiv 2406.08651), Mirage (arXiv 2510.03840),
GeneVA (arXiv 2509.08818), Artifact-Bench (arXiv 2605.18984), Kellogg Insight.

### Question-format experiment

Each paper of the office image, as an enlarged page crop. A = yes/no noul with
the definition; B = list Choice, top answer.

| Paper | A: yes/no noul | B: list Choice top answer |
|---|---:|---|
| Orion (octopus sentence) | 0.82 | absurd statement 0.55 |
| Marketing ("Marketing Campai" truncated title) | 0.90 | misspelled/invented 0.72 |
| Team minutes (clean) | 0.09 | everything correct 0.99 |
| Quarterly review (clean, math verified) | 0.23 | everything correct 0.73 |
| Facilities (cut by another paper) | 0.34 | text breaks off 0.66 |
| Client feedback (clean) | 0.64 | text breaks off 0.46 |
| HR update (cut by image edge) | 0.62 | text breaks off 0.95 |

Conclusions: per-object crops fix stacked documents; a list Choice names the
type of problem; the "text breaks off" option is a false-positive generator for
overlapping papers and image edges, so it was removed.

### v4 design

A list Choice per category: "everything is correct" (with real-photo
look-alikes spelled out), the category's hallucination types, and "can't
tell". Classify and all category lists are asked in one call (speculative
fan-out). An item is flagged when the sum of its hallucination options reaches
the threshold, and it is labeled with the top option.

### Discovery is the weak link

- Box as an object detector on many overlapping papers returns a giant box
  over half the image, half-pages, or the same region again.
- "Any distinct thing" on the full image gives one giant box.
- Targeted searches ("one single sheet of paper (just one, not a group)") work
  better (5 finds) but still miss papers.
- v4 hybrid: targeted finds, plus overlapping 3x3 grid cells for coverage,
  plus a "pinpoint" box inside a flagged cell.
- First v4 run on the office image: 8 papers found; the Orion page scored
  "absurd statement" 0.72 (threshold 0.8).
- Full v4 evaluation: pending.

## Product and engineering notes

- Hosted on Vercel. The browser decodes images and video frames, crops, and
  draws boxes. The serverless function only proxies Jev with the key held
  server-side and holds all prompts, so the endpoint cannot be used as a
  general Jev proxy. Body cap 4.5 MB.
- The sensitivity slider maps to the probability needed to flag; it was
  calibrated on real photos.
- Cost per image grew from about 2-8 calls (v1, small image) to about 20-60
  (tiles, find plus verify).
- Eval harness: headless Chromium runs the real page
  ([`code/harness/browser_eval.mjs`](../code/harness/browser_eval.mjs)); raw
  scores are saved as JSON in [`data/scores/`](../data/scores/). Real images
  are Wikimedia Commons Featured/Quality pictures
  ([`data/attribution/`](../data/attribution/)). Wikimedia rate-limits hard
  (HTTP 429), and a download bug that left empty files was fixed.

## Open problems

- Box-based discovery of many overlapping objects.
- Object merging (for example glasses on papers) is not caught at the default
  threshold.
- A larger labeled set of real AI images (with known hallucinations) and real
  "complex" photos is needed.
