---
name: jev-image-hallucination
description: Detect AI-image or video hallucinations (garbled text, contradictions, layering, malformed objects) with TypeSafe Jev images + Box and localize them. Use when building or debugging an image/video artifact checker on Jev 1.14, or when a Jev vision pipeline flags real photos or misses errors in AI-generated documents.
---

# Detect AI-image hallucinations with Jev (images + Box)

Recipe distilled from the jev-box-study (v1 to v6). Reference implementation:
`code/prompts/v6_check.js` (server prompts and retries) and `app/public/index.html`
(client pipeline: cropping, windows, drawing boxes). Read them before writing code.

Measured result of v6 on a 6-error AI office image: 4/6 caught in 3/3 runs,
0/26 real photos falsely flagged, about $0.02 per image.

## API shape

- `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer $TYPESAFE_API_KEY`
  (env var, server side only), header `TypeSafe-Danger-Zone-Images: true`.
- Model `jev-1.14.0` (Box works there; `jev-preview` returned 400 for Box).
- Images go in `assets` as base64 placeholders referenced from the question
  text. Each side 256-1568 px, at least 78,400 px total (so about 280 px both
  sides), 16 MiB per image, 32 MiB per request. Oversize is rejected, not
  resized. EXIF is ignored: decode and re-encode in the browser.
- Question types: Noul = probability of yes; Choice = distribution over named
  options; Box = exactly one box (fractions 0-1) plus `confidence`.
- Questions in one request run in parallel and in isolation: batch them.
- Keep prompts on the server; the browser only decodes, crops, draws boxes.
- Retry 429/5xx with backoff; cap about 6 in-flight requests from the browser.

## Pipeline (v6)

a. **Neutral discovery.** Never ask "is something wrong" up front. Run
   targeted Box searches on the whole image: "one single sheet of paper (just
   one, not a group)", table, object, person. Discard boxes covering over 60%
   of the image. Mask (gray out) each find and repeat. Add close-up windows at
   two scales: 3x3 coarse cells (keeps a chart next to the text describing it)
   and about 24 overlapping square windows of 26% of the long side (small text
   readable). Each scale alone missed an error type.
b. **One flat list per item, no object categories.** Choice options:
   "everything is correct" (name real-photo look-alikes in it) + 28
   hallucination types + "can't tell". Flag when the sum of the hallucination
   options is at least the threshold (default 0.8). Label the item with the
   top hallucination option. Windows only judge crops that are at least 30%
   "mostly text" (ask that noul in the same call); objects and people are
   judged on their own boxes.
c. **Jev is not deterministic.** Same crop x5 gave layer 0.57-0.67 and
   contradiction 0.39-0.49. Ask anything within 0.2 of the bar 2 more times on
   the same crop and average. Do not re-frame the crop for the repeat (0.88
   fell to 0.77).
d. **Two-format confirmation.** Re-ask every flag as a specific yes/no noul
   with structured instructions that name normal look-alikes: helmets, masks,
   costumes, decorative fonts, real brand names, other languages, partly
   hidden/angled/blurred hands, curved reflections. Final score =
   mean(list, confirm). This took real-photo false flags from 4/26 to 0/26
   (helmets "broken glasses": list 0.83, confirm 0.07) with true catches
   staying 0.82-0.94.
e. **Layering** (content of a lower sheet printed on the top sheet): on the
   window grid ask two differently worded questions and average them:
   "does everything on the top sheet belong to it?" and "is anything from the
   lower sheet visible on top?". Score = clamp((mean - 0.3) / 0.4). Window
   size matters: about 300 px splits the spot (max 0.40), about 400 px (26% of
   the long side) catches it (0.64-0.69); real photos max 0.40. Pinpoint a
   flagged window with Box: "the word or table line that belongs to a lower
   sheet but is printed on top of the sheet covering it" (confidence about 0.6).
f. **Merge** same-type boxes that touch; keep the tighter one.
g. **Filter degenerate boxes** (zero width, e.g. left = right = 0.45,
   confidence 0.11). Verify every box with a second question: Box has no
   "none" answer and always returns something.
h. **Tables.** Row-strip check only behind a Jev "is this a table?" gate
   (0.8 or more) and a minimum box size (at least 12% width, 8% height; tiny
   slivers read incoherent). Search tables on the whole image and inside each
   found page. Cut the table into about 6 overlapping horizontal strips,
   rotate (0, +/-4, +/-8, stop early when clean), ask Choice "describe only
   what is physically inside this strip". Misalignment =
   clamp((0.88 - coherence) / 0.15). This is weak, see below.

Question shape (Choice, abbreviated):

```json
{"type":"choice","question":"Look only at the attached crop. Which describes it best?",
 "options":["everything is correct (a real photo can show helmets, masks, decorative fonts, real brand names, other languages, hands partly hidden or blurred, curved reflections)",
            "misspelled or invented words","text truncated mid-word","absurd or impossible statement",
            "text contradicts its data","content from another sheet printed on top", "... 28 types total ...",
            "can't tell"]}
```

## Do NOT

- Ask hallucination- or "AI"-worded yes/no questions on whole images: it
  primes yes (v1 flagged 7/8 real photos).
- Take the max over many tiles/views of many checks: multiple comparisons
  inflate the maximum (real photos reached 0.64 on tiles vs 0.53 whole).
- Use object categories with a classifier step; its run-to-run flips cost catches.
- Re-frame the crop for confirmation.
- Trust a single call near the bar.
- Use Box alone for discovery on cluttered scenes: one "find anything" call
  returns one giant box; mask-and-repeat returns the same region.
- Expect table-offset or other geometry detection. Jev reads layout
  semantically: asked which Variance value is on the Marketing row it said
  -2.2% (mathematically right) while -0.7% is drawn there. Whole-table
  "rows line up" scored misaligned 0.89-0.96 vs clean 0.92-0.98; row strips
  0.69-0.90 depending on the box; border-line and vertical-band questions
  failed too. Row and column offsets are a Jev 1.14 perception limit.
- Copy wording of your test images into prompts.
- Judge text at page scale: the same absurd sentence scored 0.90 on a
  paragraph crop and 0.60-0.64 on a whole-page crop. Upscale small crops to at
  least 1024 px on the long side.

## Cost

One box/find call on a ~1.5k px image is about 4-5k input tokens; a tiny
image about 676. Jev 1.14 is $0.042 per million input tokens, output free
(checked 2026-10-14). A full scan is about 170-250 calls, 0.5-0.6M input
tokens, about $0.02 per image; about 12 verified items per image.

## Rule: separate looking from judging (v7)
Never make a verdict on a crop cut by a fixed grid: it can slice a word ("research" -> "esearch" -> "invented word"),
a hand or a face, and every repeat/confirm on that crop inherits the cut. Use grid windows only to raise leads; frame
the complete unit around each lead with Box ("the single complete thing at the center ..."; the whole sheet for
contradictions/sums), widen and reframe if the unit touches the context edge, then judge that unit. Pinpoint only
for display, after the verdict.
