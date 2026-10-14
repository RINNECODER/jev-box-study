# Can Jev's Box find AI-image hallucinations?

**A field report on building an AI-image hallucination detector with TypeSafe
Jev 1.14's Box type and image input:** what worked, what did not, why, and how
to build with Box yourself.

**4 prompt versions** · **37 checks in v1** · **raw score JSON** · **Live demo**

Observations from October 14, 2026. Built with Claude Code by
[0xRinne](https://x.com/0xRinne). Independent, AI-assisted research.

[Live app](https://hallucination-check.vercel.app) ·
[Headline findings](#headline-findings) · [Timeline](#iteration-timeline-v1-to-v4) ·
[Guidance](#building-with-jev-box) · [Evidence](#inspect-the-evidence)

> **The central finding:** Jev Box localizes planted errors in documents very
> well, but whether it flags a *real* AI image depends far more on how the
> question is framed and at what scale the crop is taken than on the model
> itself. Finding *which* region to ask about (discovery) is the weakest link.
>
> These are small, hand-picked evaluations on a handful of images, not a
> benchmark or an accuracy score.

## Headline findings

**What worked**

- Synthetic documents with planted errors: misspellings 98%, wrong percentage
  97%, self-contradiction 97%, date conflict 76% (v1). A clean control flagged
  nothing.
- Neutral, per-object verification with a "can't tell" option (v2) cut false
  flags on 26 real images to 1 of 26 at defect >= 0.8.
- Crop scale: the same absurd sentence scored 0.90 on a paragraph crop and
  0.60-0.64 on a whole-page crop.

**What did not**

- v1 flagged 7 of 8 real photos at the default threshold (multiple comparisons:
  37 checks x up to 10 views, maximum taken).
- Wrong table totals were missed (53%, later 0%) until the v2 verify step.
- A real AI image ("Overlapping Office Reports on a Desk") produced no flags in
  v2. Box discovery on many overlapping papers returns giant boxes or the same
  region repeatedly.

**Why:** every v1 question said "hallucination / AI", which primes a yes;
tiles and many checks multiply chances for a high maximum; text read at page
scale is too small; Box has no "nothing here" answer.

**How it was fixed (partly):** narrow checks, a tile penalty, a 3-way Choice
with "can't tell", per-object crops, and a hybrid discovery step.

## Iteration timeline (v1 to v4)

| Version | Design | Measured result |
|---|---|---|
| v1 | One noul per artifact type (37 checks), Box per flagged type, tiles up to 3x3, mask-and-repeat | Planted docs 76-98%; 7/8 real photos flagged at default; with tile penalty +0.1 and threshold 0.6, 0/8 flagged and planted docs still caught |
| v2 | Neutral inventory, then locate (Box), then verify on crop (Choice: normal / defect / can't tell) | Defect >= 0.8 on 1/26 real images; planted errors about 1.0; wrong total caught at 0.79; real AI office image not flagged |
| v3 | Find and classify everything, then verify each item (user's design, taxonomy from literature) | Informed by the question-format experiment below |
| v4 | List Choice per category, classify plus all category lists in one call; hybrid discovery (targeted finds, overlapping 3x3 grid, pinpoint box) | First office-image run: 8 papers found, Orion page "absurd statement" 0.72 (threshold 0.8) |

Details: [docs/FINDINGS.md](docs/FINDINGS.md).

## Question-format experiment

Page crops (enlarged) of the office image. A = yes/no noul with the
hallucination definition; B = list Choice, top answer.

| Paper | A: yes/no noul | B: list Choice top answer |
|---|---:|---|
| Orion (octopus sentence) | 0.82 | absurd statement 0.55 |
| Marketing (truncated title) | 0.90 | misspelled/invented 0.72 |
| Team minutes (clean) | 0.09 | everything correct 0.99 |
| Quarterly review (clean) | 0.23 | everything correct 0.73 |
| Facilities (cut by another paper) | 0.34 | text breaks off 0.66 |
| Client feedback (clean) | 0.64 | text breaks off 0.46 |
| HR update (cut by image edge) | 0.62 | text breaks off 0.95 |

Yes/no noul scores clean papers as high as 0.64; the list Choice names the
problem type and separates clean papers better. But the "text breaks off"
option fires on overlapping papers and image edges, so it was removed.

## Crop scale decides text checks

| Crop of the same absurd sentence | "Text makes sense: defect" |
|---|---:|
| Paragraph crop | 0.90 (0.97 upscaled) |
| Whole page body crop | 0.60-0.64 |

Per-object crops fix stacked documents. Upscaling small crops to at least
1024 px on the long side helps a bit for text.

## Building with Jev Box

- **Filter degenerate boxes.** Box can return zero-width boxes
  (left = right = 0.45, confidence 0.11).
- **One box per question.** For several objects you must ask several
  questions, or tile the image.
- **There is no "none" answer.** Box always points somewhere. Gate it with a
  presence noul first, or treat low confidence as nothing.
- **Masking repeats.** Graying out a found region and re-asking kept returning
  the same region (6 "text block" finds on one page). Do not rely on it alone.
- **Discovery is weak.** "Any distinct thing" gives one giant box; targeted
  prompts ("one single sheet of paper, just one, not a group") do better; add
  an overlapping grid for coverage.
- **Prefer Choice with "can't tell" and "everything is correct"** over a bare
  yes/no noul, and avoid priming words like "AI" or "hallucination" in
  per-object questions.
- **Fan out.** Questions in one request run in parallel and in isolation.
- **Image limits:** 256-1568 px per side, at least 78,400 px total, 16 MiB
  per image; oversize is rejected, not resized.

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

## Limitations

- Small, hand-picked sets: 8 real photos, 26 real images (some Wikimedia
  Commons Featured/Quality pictures), a few planted documents, and one real AI
  image from a user. No large labeled set of real AI images.
- Thresholds were calibrated on the same real photos used for evaluation.
- Planted errors are synthetic and easier than natural AI artifacts.
- Cost per image rose from about 2-8 calls (v1) to about 20-60 (v4).
- Box and image input are experimental ("danger zone") features and may change.
- Single runs; repeated calls are not independent samples.

## Inspect the evidence

- Prompts: [`code/prompts/`](code/prompts/) - `v1_check.js`, `v2_check.js`,
  `v4_check.js`, `v5_check.js` (current).
- Harness: [`code/harness/`](code/harness/) - `browser_eval.mjs` (headless
  Chromium against the real page), `run.py`, `fetch.py`, `fmt_test.mjs`
  (question-format test), `find_test.py`.
- Raw scores: [`data/scores/`](data/scores/).
- Image attributions (Wikimedia Commons): [`data/attribution/`](data/attribution/).
- Live app: <https://hallucination-check.vercel.app>

Images are intentionally not included; `code/harness/fetch.py` re-downloads
the Wikimedia ones from the attribution lists. Set `TYPESAFE_API_KEY` in your
environment to run anything; never commit it.

## Scope and license

Independent research by 0xRinne, built with Claude Code; not affiliated with
TypeSafe. MIT licensed, see [LICENSE](LICENSE).
