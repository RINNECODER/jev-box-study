// POST /api/check — thin proxy to Jev. Prompts live here so the endpoint can't be used as a general Jev proxy.
// Two layers (asking "is something wrong?" up front primes the model toward yes, so discovery is neutral):
//   find:  box one distinct thing not yet covered by gray (a page, object, person, animal or sign)
//   item:  on a sharp crop of one found thing, one flat list: "everything is correct" + every hallucination type + "can't tell"
//   pinpoint: box a specific problem inside a region already flagged for it
//   row:   what is physically on one thin strip of a table (for misaligned-table detection)
//   layer: is text from a lower sheet printed over the top sheet (two wordings averaged)
//   confirm: specific yes/no for a flagged hallucination type, naming normal look-alikes
//   scene: whole-image list question + AI likelihood
//   pair:  two consecutive video frames
const API = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-1.14.0";
const PRICE_PER_MTOK = 0.042;  // USD per million input tokens (docs.typesafe.ai/models, 2026-10-14); output is free
const MAX_B64 = 3_000_000;
const MASKED = "Solid gray rectangles cover areas already found; ignore them.";

// One flat list of hallucination types, asked about every item (no object categories: the user's call, and the
// classifier's run-to-run flips were costing catches). Built from published AI-artifact taxonomies (SynArtifact,
// Northwestern/Kellogg guide, GeneVA) and practitioner checklists.
const FLAT = {
  words: ["Misspelled or invented words", "a common word is misspelled or a word doesn't exist"],
  glyphs: ["Corrupted characters", "smudged, half-formed or squiggly characters posing as text"],
  absurd: ["Absurd or impossible statement", "a sentence or sign says something absurd, impossible or self-contradictory for its context"],
  contradiction: ["Text contradicts its data", "a sentence contradicts a table or chart next to it (for example it names a different highest value than the chart shows)"],
  numbers: ["Numbers don't add up", "a total, difference or percentage doesn't match its figures, or a date is impossible"],
  chart: ["Chart contradicts its labels", "a chart's bars, slices or axes disagree with its own labels or numbers"],
  fingers: ["Wrong number of fingers", "a hand with clearly four, six or more fingers"],
  hand: ["Malformed hand", "fingers fused, branching or bending backwards"],
  grip: ["Impossible grip", "a held object merges into the hand, passes through it or floats beside the fingers"],
  eyes: ["Mismatched eyes", "pupils or irises of different shape or size, or eyes looking different ways"],
  teeth: ["Malformed teeth", "teeth merged into one bar, or far too many"],
  face: ["Melting face or hair", "facial features, ears or hair smeared or fusing into skin or background"],
  limbs: ["Extra or missing limbs", "an extra or missing arm, leg, paw or head with nothing hiding it"],
  joints: ["Impossible joints", "a limb or neck bends where no joint exists"],
  fused: ["Things fused together", "two objects, bodies, or a body and an object melt into each other or one passes through the other"],
  glasses: ["Broken glasses", "lenses of different shape, a missing frame edge, or an arm that ends nowhere or fuses into skin or a surface"],
  ends: ["Strap, cable or chain with no ends", "a strap, cable or chain that starts or ends nowhere, or changes thickness or style"],
  seams: ["Broken seams or pattern", "seams, buttons, zippers, tiles or a fabric pattern that don't line up or change midway"],
  dial: ["Wrong dial or keys", "duplicated or nonsense numbers on a dial, extra clock hands, merged keys, or the wrong number of strings"],
  structure: ["Impossible structure", "legs that merge, vanish or change count; stairs, rails or frames that don't connect; straight lines that bend"],
  wheels: ["Mismatched wheels or parts", "wheels of different sizes or spoke counts, or parts in impossible places"],
  liquid: ["Impossible liquid or food", "liquid at an impossible level, a glass with no bottom, or food that defies gravity"],
  halfformed: ["Half-formed or hybrid object", "an object that is half-formed, dissolving, a mix of two different things, or floating without support"],
  cloned: ["Cloned elements", "the same face, leaf, object or detail copied unnaturally"],
  reflection: ["Wrong reflection", "a reflection that shows a different scene, pose or number of things than its source"],
  lighting: ["Lighting & shadows disagree", "shadows point different ways under one light, or one subject is lit differently"],
  perspective: ["Impossible perspective or scale", "vanishing lines disagree, or something is far too big or small for where it is"],
  background: ["Meaningless background", "background shapes that look like people, signs or buildings but aren't anything"],
};
// Discovery targets: whole-image passes for large things, then a general pass per section for small things.
const FIND = {
  any: "one distinct thing (a sheet of paper or page, an object, a person, an animal, or a sign)",
  page: "one single sheet of paper, page, card or screen (just one, not a group)",
  person: "one single person or animal (just one, not a group)",
  table: "one single table of rows and columns (just one, not a group)",
  object: "one single physical object that is not paper (such as glasses, a cup, a plant, a phone, a tool or furniture)",
};
// Row strips: Jev reads layout semantically (it "fixes" a shifted table in its head), so code cuts a table into
// thin rotated strips and Jev says what is physically on each line. Clean tables read confidently at their
// best angle (0.89-1.00 measured); tables with shifted rows/columns never do (0.69-0.74).
const ROW = { type: "choice", instructions: "`img` is a thin horizontal strip cut from a table. Describe only what is physically inside this strip.",
  criteria: { "label with its values": "a row label and the numbers or cells that belong to it, on the same line",
    "label with no values": "a row label but the value cells on its line are empty",
    "values with no label": "values but no row label on this line",
    "header": "column headers",
    "between rows or not a row": "a border line, the gap between two rows, or not part of a table" } };
// Layering (text from a lower sheet drawn over the sheet on top): two differently-worded questions on small
// sub-cells of each page, averaged. Alone each is noisy (0.62 vs 0.53 worst clean); the mean separates
// the real error (0.71-0.74) from clean cells (<= 0.31).
const LAYER = {
  own: { type: "choice", instructions: "Look only at the top sheet of paper in `img`. Does everything printed on it belong to that sheet's own content?",
    criteria: { "only its own content": "every word and line on this sheet belongs to its own text and layout",
      "contains something from another sheet": "a stray word, number or table line that belongs to a different document is printed on this sheet", "can't tell": "unclear" } },
  overlap: { type: "choice", instructions: "Where two sheets of paper overlap in `img`, the upper sheet should hide everything under it. Is any word, number or table line from the lower sheet visible on top of the upper sheet?",
    criteria: { "yes, something shows on top": "a word, number or line from the lower sheet is drawn over the upper sheet's surface",
      "no, the upper sheet hides it": "the upper sheet cleanly covers the lower one", "no overlapping sheets": "there are no overlapping sheets here" } },
};
// Confirmation: a flat-list flag is re-asked as a specific yes/no that names the real-photo look-alikes, and the
// two are averaged. Measured: real-photo false flags (helmets, real fonts, hidden fingers) fall to <= 0.79,
// real hallucinations stay 0.82-0.94.
const LOOK_ALIKES = "Real photos and documents often look unusual without being wrong: helmets, masks, costumes and props; stylised or decorative fonts, " +
  "real brand names, other languages and abbreviations; hands, fingers and objects partly hidden, angled, blurred or cut off by the frame; " +
  "reflections in curved or textured surfaces.";
const CORRECT = "everything is correct", UNSURE = "can't tell";
// Normal look-alikes from the research, so busy real photos have a correct answer to choose.
const NORMAL = "everything looks like a real, coherent thing; blur, motion, glare, retouching, lens distortion, " +
  "and parts hidden by other objects or cut by the image edge are normal";

const TEMPORAL = {
  morph: ["Morphing", "an object, face or text turns into something else or changes count between the frames"],
  pop: ["Popping", "something vanishes or appears out of nowhere between the frames"],
};
const OVERALL = { type: "noul", instructions: "`img` is AI-generated or AI-edited rather than an untouched photo, scan, screenshot or video frame.",
  criteria: { true: "made or altered by AI", false: "an untouched real capture" } };

const listQ = (instructions, problems) => ({ type: "choice", instructions,
  criteria: { [CORRECT]: NORMAL, ...Object.fromEntries(Object.values(problems).map(([l, d]) => [l, d])),
    [UNSURE]: "it's too small, blurry or covered to judge" } });
// Split a list answer into correct / unsure / each problem slug.
const split = (problems, a) => ({ correct: a.probabilities[CORRECT] ?? 0, unsure: a.probabilities[UNSURE] ?? 0,
  problems: Object.fromEntries(Object.entries(problems).map(([k, [l]]) => [k, Math.round((a.probabilities[l] ?? 0) * 1000) / 1000])) });
const PROBLEMS = Object.fromEntries(Object.entries(FLAT).map(([k, [, d]]) => [`x.${k}`, d]));
PROBLEMS["x.layering"] = "a word or table line belongs to a lower sheet but is printed on top of the sheet covering it";
const META_CHECKS = Object.fromEntries([
  ...Object.entries(FLAT).map(([k, [l]]) => [`x.${k}`, { label: l, group: "all" }]),
  ["x.alignment", { label: "Misaligned table", group: "all" }],          // from the row-strip check
  ["x.layering", { label: "Text printed over the wrong sheet", group: "all" }],  // from the layer check
]);

// --- rate limiting: Upstash Redis if configured (shared across instances), else best-effort per instance ---
const PER_IP_HOUR = +(process.env.LIMIT_PER_IP_HOUR || 300);
const GLOBAL_DAY = +(process.env.LIMIT_GLOBAL_DAY || 5000);
const mem = new Map();

async function incr(key, ttl) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    const r = await fetch(`${url}/pipeline`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify([["INCR", key], ["EXPIRE", key, ttl, "NX"]]),
    });
    return (await r.json())[0].result;
  }
  const now = Date.now(), e = mem.get(key);
  if (!e || e.reset < now) { mem.set(key, { n: 1, reset: now + ttl * 1000 }); return 1; }
  return ++e.n;
}

async function limited(ip) {
  const hour = Math.floor(Date.now() / 3.6e6), day = Math.floor(Date.now() / 8.64e7);
  const [a, b] = await Promise.all([incr(`rl:ip:${ip}:${hour}`, 3600), incr(`rl:all:${day}`, 86400)]);
  if (a > PER_IP_HOUR) return "You've hit the hourly limit. Try again later.";
  if (b > GLOBAL_DAY) return "The site hit its daily limit. Try again tomorrow.";
  return null;
}

async function jev(images, questions) {
  const state = {}, assets = {};
  for (const [name, b64] of Object.entries(images)) {
    const id = `${crypto.randomUUID()}-${name}`;
    state[name] = id;
    assets[id] = { type: "image", format: "jpeg", data_base64: b64 };
  }
  // Jev rate-limits bursts (many crops per image): retry 429/5xx with backoff before giving up.
  let r;
  for (let attempt = 0; ; attempt++) {
    r = await fetch(API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
        "Content-Type": "application/json",
        "TypeSafe-Danger-Zone-Images": "true",
      },
      body: JSON.stringify({ model: MODEL, state, assets, questions }),
    });
    if (r.ok || attempt >= 4 || !(r.status === 429 || r.status >= 500)) break;
    await new Promise(ok => setTimeout(ok, 800 * 2 ** attempt + Math.random() * 400));
  }
  if (!r.ok) throw new Error(`Jev ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  Object.defineProperty(j.answers, "usage", { value: j.usage });  // token usage, for the UI's cost meter
  return j.answers;
}

const isJpeg = s => typeof s === "string" && s.length <= MAX_B64 && s.startsWith("/9j/") && /^[A-Za-z0-9+/]+=*$/.test(s);
const round = x => Math.round(x * 1000) / 1000;

export default async function handler(req, res) {
  if (req.method === "GET") return res.json({ checks: META_CHECKS, price_per_mtok: PRICE_PER_MTOK,
    temporal: Object.fromEntries(Object.entries(TEMPORAL).map(([k, v]) => [k, v[0]])),
    groups: { all: "Hallucinations" } });
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.TYPESAFE_API_KEY) return res.status(500).json({ error: "Server is missing TYPESAFE_API_KEY" });
  const { mode, images } = req.body || {};
  const want = mode === "pair" ? 2 : 1;
  if (mode === "pinpoint" && !PROBLEMS[req.body.problem]) return res.status(400).json({ error: "Bad request" });
  if (!["find", "item", "scene", "pair", "pinpoint", "row", "istable", "layer", "confirm"].includes(mode) || !Array.isArray(images) || images.length !== want || !images.every(isJpeg))
    return res.status(400).json({ error: "Bad request" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const msg = await limited(ip);
  if (msg) return res.status(429).json({ error: msg });

  let usage = { input_tokens: 0 };
  const jevU = async (...a) => { const x = await jev(...a); usage = { input_tokens: usage.input_tokens + (x.usage?.input_tokens || 0) }; return x; };
  const json = res.json.bind(res);
  res.json = o => json({ ...o, usage });
  try {
    if (mode === "find") {
      const target = FIND[req.body.target] || FIND.any;
      const ans = await jevU({ img: images[0] }, { b: { type: "box", instructions: `${target} in \`img\` that is not covered by a gray rectangle. ${MASKED}` } });
      return res.json({ box: ans.b.box, confidence: ans.b.confidence });
    }
    if (mode === "confirm") {
      const k = String(req.body.problem || "").replace(/^x\./, "");
      if (!FLAT[k]) return res.status(400).json({ error: "Bad request" });
      const [l, d] = FLAT[k];
      const ans = await jevU({ img: images[0] }, { c: { type: "noul",
        instructions: { look_alikes_that_are_fine: LOOK_ALIKES, question: `Look closely at \`img\`. Is this really present: ${l.toLowerCase()} (${d})?` },
        criteria: { true: "clearly present, and not one of the fine look-alikes", false: "not present, or only a normal look-alike" } } });
      return res.json({ confirm: round(ans.c.noul) });
    }
    if (mode === "layer") {
      const ans = await jevU({ img: images[0] }, LAYER);
      return res.json({ layer: round(((ans.own.probabilities["contains something from another sheet"] ?? 0) + (ans.overlap.probabilities["yes, something shows on top"] ?? 0)) / 2) });
    }
    if (mode === "istable") {
      // gate for the row-strip check: Jev's "find a table" also boxes non-tables in photos
      const ans = await jevU({ img: images[0] }, { t: { type: "noul", instructions: "`img` shows a printed or on-screen table: text or numbers arranged in labelled rows and columns.",
        criteria: { true: "a table with rows and columns", false: "not a table (a photo, a chart, a sign, plain text, or an object)" } } });
      return res.json({ table: round(ans.t.noul) });
    }
    if (mode === "row") {
      const ans = await jevU({ img: images[0] }, { row: ROW });
      const p = ans.row.probabilities, top = Object.entries(p).sort((a, b) => b[1] - a[1])[0];
      return res.json({ top: top[0], confidence: round(top[1]) });
    }
    if (mode === "pinpoint") {
      // only used after a region was already judged to contain this problem
      const ans = await jevU({ img: images[0] }, { b: { type: "box", instructions: req.body.problem === "x.layering" ? "the word or table line in `img` that belongs to a lower sheet but is printed on top of the sheet covering it" : `the exact spot in \`img\` where ${PROBLEMS[req.body.problem]}` } });
      return res.json({ box: ans.b.box, confidence: ans.b.confidence });
    }
    if (mode === "item") {
      // one flat list for every item, plus "is this mostly text?" so close-up windows can stick to text
      const ans = await jevU({ img: images[0] }, { list: listQ("Look closely at `img`. Which best describes it?", FLAT),
        text: { type: "noul", instructions: "`img` mainly shows printed or written text, a table or a chart.",
          criteria: { true: "mostly text, a table or a chart", false: "mostly objects, people, animals or scenery" } } });
      return res.json({ list: split(FLAT, ans.list), text: round(ans.text.noul) });
    }
    if (mode === "scene") {
      const ans = await jevU({ img: images[0] }, { overall: OVERALL, scene: listQ("Look at the whole of `img`. Which best describes it?", FLAT) });
      return res.json({ overall: round(ans.overall.noul), list: split(FLAT, ans.scene) });
    }
    const ans = await jevU({ a: images[0], b: images[1] }, { pair: listQ("Compare frame `a` with the next frame `b` of a video. Which best describes the change?", TEMPORAL) });
    return res.json({ list: split(TEMPORAL, ans.pair) });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "The detector is unavailable right now." });
  }
}
