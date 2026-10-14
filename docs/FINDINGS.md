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
- Full v4 evaluation: see below.

## v4 evaluation

Measured with the v4 prompts on 2026-10-14. Defect = sum of the hallucination
options in the per-category list Choice; an item is flagged when it reaches the
threshold. Raw data: [`data/scores/v4_all.json`](data/scores/v4_all.json).

| Set | @0.6 | @0.7 | @0.8 (default) | @0.9 |
|---|---:|---:|---:|---:|
| User's AI office image | 1/1 | 1/1 | 1/1 | 1/1 |
| Planted-error documents | 2/2 | 2/2 | 2/2 | 2/2 |
| Real photos incl. busy scenes (26), flagged | 8/26 | 4/26 | 1/26 | 1/26 |

- **Office image in the live UI:** 2 spots boxed exactly: the "Marketing Campai"
  truncated title (misspelled/invented words 0.92) and the purple-octopus
  sentence (absurd or impossible statement 0.81), both found via grid cell plus
  pinpoint box. The glasses merge is still not flagged.
- **The one real false positive at 0.8:** a street sign judged "misspelled
  words" 0.91 (likely a real non-English word).
- **Real false positives at 0.7** included Daft Punk helmets read as "glasses
  merge" 0.77 and a chest tattoo as "half-formed object" 0.70.
- **Cost:** Jev 1.14 is priced at $0.042 per million input tokens, output free
  (docs.typesafe.ai/models, 2026-10-14). The office image scan took 28 calls and
  134k input tokens, $0.0056. One box/find call on a ~1.5k px image is about
  4-5k input tokens; a tiny image about 676 tokens. About 12 verified items per
  image on average.
- **Discovery that worked best:** targeted whole-image box searches ("one single
  sheet of paper (just one, not a group)", objects, people; boxes covering more
  than 60% of the image discarded), plus overlapping 3x3 grid cells for
  coverage, plus a pinpoint box inside a flagged cell.

## v5: geometry vs meaning

Office image = the user's AI image "Overlapping Office Reports on a Desk".
Raw data: [`data/scores/v4b_all.json`](data/scores/v4b_all.json),
[`data/scores/v5_docs.json`](data/scores/v5_docs.json). Prompts:
[`code/prompts/v5_check.js`](code/prompts/v5_check.js).

1. **New page-list option "Text contradicts its data"** caught the Marketing
   page at 0.95-0.97 (the takeaways say Paid Search drove the most leads and
   Display underperformed, but the chart shows Display highest). Re-run on all
   sets at 0.8: user image 1/1, planted 2/2, real 2/26 (Daft Punk helmets
   "glasses merge" 0.85, plus the street sign). The same helmets scored 0.77 in
   the previous run, so run-to-run variance is several points.
2. **Jev reads layout semantically, not geometrically.** On a crop of a table,
   "which Variance value is on the Marketing row?" gave -2.2% (0.99): correct
   for Marketing mathematically, though -0.7% is drawn on that line. "On which
   paper is the word 'Total' printed?" gave "the table page" 0.87-0.96, which is
   wrong (it is printed on the IT Security Brief lying on top), while "which
   paper is on top?" gave IT Security Brief 1.00 (correct). The yes/no "rows
   line up" scored 0.89-0.96 on misaligned tables, the same as clean ones
   (0.92-0.98). Whole-table views let Jev mentally fix the layout.
3. **Ground-truth correction.** One table the assistant had labeled misaligned
   (Quarterly Financial Review) is actually fine: its apparent offset was paper
   tilt, and deskewed it reads perfectly (Jev said so). Verify labels by
   deskewing before blaming the model.
4. **Technique that works: row strips.** The code only cuts the image; Jev does
   the judging. Cut a table into about 6 thin overlapping horizontal strips,
   rotate through angles (0, +/-4, +/-8; stop early when clean), and ask a
   Choice "describe only what is physically inside this strip" (label with its
   values / label with no values / values with no label / header / between
   rows). Best-angle mean confidence: clean tables 0.89-1.00 (Marketing 1.00,
   budget 0.98, report 0.97, Orion 0.93, Quarterly 0.90, synthetic clean table
   rotated 4 degrees 0.89); truly misaligned 0.69-0.74 (Facilities Status column
   shifted a row; Client Feedback columns stepping down). In the full pipeline
   with Jev-found table boxes: Facilities flagged (0.69), Client Feedback missed
   (0.81, a looser box than the hand crop's 0.74), clean tables 0.92-0.97, and a
   bar chart mistaken for a table 0.78. Mapping:
   misalignment = clamp((0.88 - coherence) / 0.15).
5. **Layering is not reliably detectable.** The "Total" from the lower table
   printed on top of the IT Security Brief. The isolation question "does
   everything on the top sheet belong to it?" gave 0.81 "stray content" on a
   tight hand crop, 0.53 on a looser crop, 0.18-0.39 when Jev boxes "the sheet
   on top" itself (it picks the wrong sheet), and 0.40 in a 300 px sliding-window
   sweep (no window at or above 0.6 out of 60). Clean sheets scored 0.73-0.99
   "own content". Known limit.
6. **Background corrupted characters:** weak signal only (0.44-0.56 versus
   0.07-0.23 on clean text).

## v6: the version that works

Ground truth: the author (a human) found 6 hallucinations in the AI office
image "Overlapping Office Reports on a Desk":

1. Truncated title "Marketing Campai".
2. Absurd sentence: "the office printer turned into a purple octopus and
   approved the quarterly budget".
3. Marketing takeaways contradict their chart (text says Paid Search drove most
   leads and Display underperformed; the chart shows Display highest).
4. Client Feedback table columns step down (5 rows of numbers vs 4 labels).
5. Facilities table Status column shifted a row.
6. The word "Total" from the Orion table printed on top of the IT Security
   Brief sheet covering it.

**Final v6 result (production):** 4 of 6 caught in 3 of 3 runs: #1, #2, #3 and
#6 (the layering word boxed exactly). #4 and #5 (table misalignment) were not
caught. Real photos (26 Wikimedia Commons, including busy scenes): 0 of 26
falsely flagged. Planted-error documents: all caught. Cost is about $0.02 per
image (about 170-250 calls, about 0.5-0.6M input tokens at $0.042 per million).

Prompts: [`code/prompts/v6_check.js`](code/prompts/v6_check.js). Client
pipeline: [`code/app/index.html`](code/app/index.html). Raw scores:
[`data/scores/`](data/scores/) (`v9`, `v12`, `v14`, `v15`, `v16`).

### The v6 pipeline

- **(a) Neutral discovery.** Targeted Box searches on the whole image ("one
  single sheet of paper (just one, not a group)", table, object, person; boxes
  over 60% of the image discarded; each find masked), plus close-up windows at
  two scales: 3x3 coarse cells (keep a chart next to the text describing it)
  and about 24 overlapping square windows of 26% of the long side (make small
  text readable). Each scale alone missed one error type.
- **(b) One flat list per item, no object categories** (the author's decision;
  the classifier's run-to-run flips were costing catches). Choice: "everything
  is correct" (real-photo look-alikes named) + 28 hallucination types + "can't
  tell". An item is flagged when the hallucination options sum to at least the
  threshold. Windows only judge crops that are at least 30% "mostly text" (a
  noul asked in the same call); objects and people are judged on their own
  boxes.
- **(c) Jev is not deterministic.** The identical crop asked 5 times gave layer
  0.57-0.67 and contradiction 0.39-0.49. Anything within 0.2 of the bar is
  asked 2 more times on the same crop and averaged. Re-framing the crop instead
  made it worse (0.88 to 0.77).
- **(d) Two-format confirmation.** A flat-list flag is re-asked as a specific
  yes/no noul with structured instructions naming normal look-alikes
  (helmets/masks/costumes, decorative fonts, real brand names, other languages,
  partly hidden/angled/blurred hands, curved reflections). Final =
  mean(list, confirm). Real-photo false flags went from 4/26 to 0/26 (Daft Punk
  helmets "broken glasses": list 0.83, confirm 0.07) while true catches stayed
  0.82-0.94.
- **(e) Layering.** Two differently worded questions ("does everything on the
  top sheet belong to it?" and "is anything from the lower sheet visible on
  top?") are averaged on the fixed window grid; score = clamp((mean - 0.3) /
  0.4). Window size matters: about 300 px windows split the spot (max 0.40),
  about 400 px (26% of the long side) catch it (0.64-0.69); real photos max
  0.40. A flagged window is pinpointed with Box "the word or table line that
  belongs to a lower sheet but is printed on top of the sheet covering it"
  (lands on the word, confidence about 0.6).
- **(f)** Same-type boxes that touch are merged (the tighter kept), fixing
  duplicate spots.
- **(g)** The server retries Jev 429/5xx with backoff; the browser caps 6
  in-flight requests (bursts were rate-limited).
- **(h) Table row-strip check** kept, behind a Jev "is this a table?" gate
  (0.8 or more) and a minimum box size (at least 12% width and 8% height; tiny
  slivers read incoherent and caused false flags). Tables are searched on the
  whole image and inside each found page.

### Tables: a Jev 1.14 perception limit

Six techniques, all measured:

- Whole-table yes/no "rows line up": misaligned 0.89-0.96 vs clean 0.92-0.98.
- Row strips: box-sensitive (Facilities 0.69 with one box, 0.81-0.84 with
  others; Client Feedback 0.74 hand-cropped, 0.81-0.90 otherwise).
- Two strip questions averaged: clean Orion 0.82 equals misaligned Facilities
  0.82.
- Border-line questions: 0.65-0.93 "straight" on both.
- Zoomed vertical bands: 0.02-0.20 "shifted" on all.

Jev reads layout semantically: asked which Variance value is on the Marketing
row, it answered -2.2% (mathematically right) while -0.7% is drawn there. Row
and column offsets are a perception limit of Jev 1.14; the content of those
tables is correct, so meaning-based checks cannot see it.

### Process lessons

- Verify ground truth by deskewing (the assistant mislabeled a tilted but
  correct table).
- Avoid copying test-image wording into prompts (an "object coming to life"
  example was removed).
- One "find anything" box on a whole busy image returns one giant box.
- A Box with no "none" option always returns something, so verify every box
  with a second question.

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
