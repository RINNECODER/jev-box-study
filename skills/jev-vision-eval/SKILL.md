---
name: jev-vision-eval
description: Evaluate a Jev (TypeSafe) vision or Box pipeline honestly: build human ground truth, a real-photo false-flag set, planted-error positive controls, repeated runs, and a headless-browser harness. Use when measuring, tuning thresholds for, or claiming accuracy of any Jev image/video checker.
---

# Evaluate a Jev vision pipeline honestly

Distilled from the jev-box-study. Harness examples are in `code/harness/`;
raw score files in `data/scores/` show the storage format.

## 1. Ground truth from a human

- Have a human list every real defect in each target image, each with its
  location. Do not let the model or yourself label them.
- Verify labels before blaming the model: deskew tilted pages first. One table
  was mislabeled misaligned; its offset was paper tilt and Jev read it fine.
- Keep ground truth separate from prompts; never copy the wording of a test
  image into a prompt (it leaks the answer).

## 2. Negative set: real photos

- Keep 20+ real photos including busy scenes, not just clean ones (the study
  used 26 Wikimedia Commons Featured/Quality pictures; see
  `code/harness/fetch.py`, attributions in `data/attribution/`).
- Wikimedia returns HTTP 429: slow down, retry with backoff, and never leave
  empty files after a failed download (delete and refetch).
- Metric: false-flag rate (images with any flag / images). Report the item
  that flagged and why (a street sign in another language, Daft Punk helmets
  read as broken glasses).

## 3. Positive controls

- Planted-error synthetic documents (misspelling, wrong percentage,
  self-contradiction, date conflict, wrong total) plus a **clean twin** of each
  with no errors. The twin must flag nothing.
- Synthetic controls are easier than natural AI artifacts: never report them
  as the headline number.

## 4. Repeat runs

- Jev is non-deterministic. The identical crop x5 gave 0.57-0.67 (layering)
  and 0.39-0.49 (contradiction); the same helmets scored 0.77 then 0.85 in
  consecutive runs. Run every target at least 3 times.
- Report per-error catch rate as n/N runs, and the false-flag rate, together
  in one table. A catch rate without a false-flag rate is meaningless.

## 5. Harness

- Run the **real page** in a headless browser so the shipped client pipeline
  is what gets measured: `code/harness/browser_eval.mjs <out.json> <dir>...`
  (override `PW` and `CHROME` env vars for your Playwright and Chromium).
- Store raw per-check scores and boxes as JSON, not just pass/fail, so
  thresholds can be re-chosen offline (the study swept 0.6/0.7/0.8/0.9 from
  one run: real photos flagged 8/4/1/1 of 26).
- Put the key in `TYPESAFE_API_KEY` in the environment; never in files.

## 6. Debugging method

- Look at the crops the pipeline actually sent before blaming the model;
  wrong crops (giant boxes, split spots, tilted pages) explain most misses.
- Isolate one variable per experiment (question wording, crop scale,
  framing, threshold) with a small `q_test`-style script on saved crops:
  see `q_test.py`, `crop_test.py`, `fmt_test.mjs`, `window_test.py`.
  Example: crop scale alone moved the same sentence from 0.60 to 0.90.
- Verify every Box result with a second question; Box has no "none" answer.
- Ask whether a failure is the model's perception limit (table row offsets
  were: six techniques all failed) before adding more prompt engineering.

## Report template

| target | errors | caught (n/N runs) | real false flags | cost/image |
|---|---|---|---|---|

State the threshold, model id (`jev-1.14.0`), date, and number of runs.
