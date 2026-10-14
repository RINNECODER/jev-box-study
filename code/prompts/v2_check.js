// POST /api/check — thin proxy to Jev. Prompts live here so the endpoint can't be used as a general Jev proxy.
// Two layers, neutral first (asking "is something wrong?" up front primes the model toward yes):
//   inventory: what kinds of things are in the image?            (no mention of errors or AI)
//   locate:    box one instance of an element type               (neutral; gray = already found)
//   verify:    on a full-res crop of that instance, a balanced Choice per property: normal / defect / can't tell
//   scene:     whole-image physics with the same three-way Choice
//   pair:      two consecutive video frames, same three-way Choice
//   pinpoint:  box the specific defect inside an already-flagged text section
// GET returns labels/groups for the UI.
const API = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-1.14.0";
const MAX_B64 = 3_000_000; // ~2.2 MB JPEG; client sends <=1568px images, well under Vercel's 4.5 MB body cap
const MASKED = "Solid gray rectangles cover areas already found; ignore them.";

// A balanced question: [instructions, [normalName, normalDesc], [defectName, defectDesc], [unclearName, unclearDesc]]
const q3 = (instructions, normal, defect, unclear) => ({ instructions, normal, defect, unclear });

// Element types. present = neutral inventory question; find = neutral box target; max = instances to locate;
// checks = what to verify on each instance's crop (key -> label, question).
// (No logo check: on real photos, angled or partly hidden logos scored as 'warped' up to 99%.)
const ELEMENTS = {
  hand: { label: "hands", one: "hand", present: "`img` shows at least one human hand in which the fingers can be seen.",
    find: "a human hand", max: 4, group: "people",
    checks: {
      hand_fingers: ["Finger count", q3("Count the fingers on the hand in `img` (the thumb counts as a finger).",
        ["five", "five fingers, or some fingers naturally hidden by pose, objects or the edge of the image"],
        ["not five", "clearly four, six or more fingers on one hand"],
        ["can't tell", "the hand is too small, blurry or covered to count"])],
      hand_shape: ["Hand shape", q3("Describe the shape of the fingers of the hand in `img`.",
        ["normal", "separate fingers that bend at real joints"],
        ["malformed", "fingers fused or melted together, bending backwards, or a hand that cannot belong to an arm"],
        ["can't tell", "too small, blurry or covered to judge"])],
      grip: ["Grip", q3("If the hand in `img` holds something, how does it hold it?",
        ["normal", "it grips the object normally, or it holds nothing"],
        ["impossible", "the object floats beside the fingers, passes through them, or merges with the hand"],
        ["can't tell", "too small, blurry or covered to judge"])],
    } },
  face: { label: "faces", one: "face", present: "`img` shows at least one human face large enough to see the eyes.",
    find: "a human face", max: 4, group: "people",
    checks: {
      face_eyes: ["Eyes", q3("Compare the two eyes of the face in `img`.",
        ["matching", "the eyes match in size, shape and direction (a deliberate glance or squint is normal)"],
        ["mismatched", "the eyes clearly differ in size, shape, pupil or direction, or there is an extra eye"],
        ["can't tell", "the face is too small, turned away, blurry or covered"])],
      face_features: ["Face & teeth", q3("Describe the features of the face in `img`.",
        ["natural", "a coherent face; asymmetry within normal human range"],
        ["distorted", "features smeared or melting into the skin, teeth merged into one strip or far too many, ears or glasses dissolving"],
        ["can't tell", "too small, blurry or covered to judge"])],
    } },
  body: { label: "bodies", one: "body", present: "`img` shows the body of at least one person or animal, with arms, legs or paws visible.",
    find: "the body of a person or animal", max: 3, group: "people",
    checks: {
      body_limbs: ["Limbs & joints", q3("Look at the limbs of the body in `img`.",
        ["normal", "the right number of limbs, bending at real joints; missing ones are hidden by pose, objects or the frame"],
        ["impossible", "an extra or missing limb with nothing hiding it, a limb bending where no joint exists, or two bodies fused"],
        ["can't tell", "too small, blurry or covered to judge"])],
    } },
  contact: { label: "contact points", one: "contact point", present: "`img` shows separate objects resting on, touching or overlapping each other.",
    find: "a place where two separate objects touch or overlap (such as glasses on paper, a cup on a table, a strap over a shoulder)", max: 6, group: "scene",
    checks: {
      merge: ["Objects merging", q3("Look at where the objects meet in `img`.",
        ["normal contact", "the objects touch, rest on or cover each other the way real things do"],
        ["fused", "the objects melt into each other, one passes through the other, or an edge blends into the other object"],
        ["can't tell", "too small, blurry or covered to judge"])],
    } },
  text: { label: "text sections", one: "text section", present: "`img` contains readable text: a heading, sentence, sign, label or paragraph.",
    find: "a block of readable text (a heading, sentence, sign, label or paragraph)", max: 6, group: "text",
    checks: {
      text_words: ["Spelling & letters", q3("Read the text in `img`. How are the words written?",
        ["correct", "real words spelled correctly (brand names, abbreviations and other languages are fine)"],
        ["broken", "misspelled common words, words that don't exist, or letters that aren't real characters"],
        ["can't read", "the text is too small or blurry to read"])],
      text_logic: ["Text makes sense", q3("Read the text in `img`. Does what it says hold together?",
        ["consistent", "it reads as sensible text for its kind of document"],
        ["contradictory", "it contradicts itself or describes something impossible or absurd for its context, such as June 31 or a rise called a drop"],
        ["can't tell", "too little readable text to judge"])],
    } },
  table: { label: "tables", one: "table", present: "`img` contains a table or list of numbers, such as figures with a total or percentages.",
    find: "a table or list of numbers", max: 3, group: "text",
    checks: {
      table_math: ["Numbers add up", q3("Check the numbers in `img`: do totals, differences and percentages match the figures shown?",
        ["consistent", "the figures that can be checked agree"],
        ["wrong", "a total, difference or percentage does not match its figures"],
        ["can't check", "nothing can be checked, or the numbers are too small to read"])],
    } },
  chart: { label: "charts", one: "chart", present: "`img` contains a chart or graph.", find: "a chart or graph", max: 2, group: "text",
    checks: {
      chart: ["Chart matches labels", q3("Compare the chart in `img` with its own labels and numbers.",
        ["consistent", "bar heights, slices and axes agree with the labels and numbers"],
        ["contradictory", "the drawing contradicts its labels, or the axis values don't progress"],
        ["can't tell", "no numbers to compare, or too small to read"])],
    } },
  dial: { label: "clocks & dials", one: "dial", present: "`img` shows a clock face, watch face, gauge or dial with numbers or marks.",
    find: "a clock face, watch face, gauge or dial", max: 2, group: "text",
    checks: {
      dial: ["Clock & dial", q3("Look at the numbers and hands of the dial in `img`.",
        ["normal", "numbers in the right order and a normal set of hands"],
        ["malformed", "duplicated, missing or out-of-order numbers, or extra hands"],
        ["can't tell", "too small or blurry to read"])],
    } },
};

// After a text section is judged defective, box the specific spot inside that section.
const PINPOINT = {
  text_words: "the misspelled, invented or garbled word in `img`",
  text_logic: "the sentence in `img` that contradicts itself or describes something impossible",
};

// Whole-image physics; same balanced shape. key -> [label, group, question]
const SCENE = {
  shadows: ["Shadows", "scene", q3("Look at the shadows in `img`.",
    ["consistent", "shadows agree with the light, or the light is soft and shadows are faint"],
    ["inconsistent", "shadows point different ways under one light, or one object lacks a shadow that its neighbours have"],
    ["can't tell", "no clear shadows to compare"])],
  reflections: ["Reflections", "scene", q3("Look at any mirrors, windows, water or shiny surfaces in `img`.",
    ["consistent", "reflections match the scene, or there are none"],
    ["wrong", "a reflection shows something that isn't in the scene, or is missing"],
    ["can't tell", "reflections too unclear to judge"])],
  structure: ["Lines & patterns", "scene", q3("Look at straight edges and repeating patterns in `img` (door frames, shelves, tiles, keyboards, fences).",
    ["regular", "edges stay straight and patterns stay regular (lens curvature and perspective are normal)"],
    ["broken", "a straight edge wobbles or breaks, or a regular pattern turns irregular or merges"],
    ["can't tell", "no clear straight edges or patterns"])],
  objects: ["Objects", "scene", q3("Look at how the objects in `img` sit together.",
    ["coherent", "each object is a complete, recognisable thing resting or overlapping normally"],
    ["impossible", "two objects fused into one, an object passing through another, an unsupported object floating, or a half-formed object"],
    ["can't tell", "too cluttered or blurry to judge"])],
  background: ["Background", "scene", q3("Look at the background of `img`.",
    ["recognisable", "background things are recognisable, or simply out of focus"],
    ["meaningless", "shapes that look like people, signs or buildings but aren't anything"],
    ["can't tell", "no distinct background"])],
};

const TEMPORAL = {
  morph: ["Morphing", q3("Compare frame `a` with the next frame `b` of a video.",
    ["normal change", "differences come from motion, camera movement or lighting"],
    ["transforms", "an object, face or text turns into something else or changes count"],
    ["can't tell", "the frames are too different or blurry to compare"])],
  pop: ["Popping", q3("Compare frame `a` with the next frame `b` of a video.",
    ["normal", "everything that appears or leaves moves in or out of view or is covered"],
    ["pops", "something vanishes or appears out of nowhere"],
    ["can't tell", "the frames are too different or blurry to compare"])],
};
const OVERALL = { type: "noul", instructions: "`img` is AI-generated or AI-edited rather than an untouched photo, scan, screenshot or video frame.",
  criteria: { true: "made or altered by AI", false: "an untouched real capture" } };

const CHECK_META = Object.fromEntries([
  ...Object.values(ELEMENTS).flatMap(e => Object.entries(e.checks).map(([k, [label]]) => [k, { label, group: e.group }])),
  ...Object.entries(SCENE).map(([k, [label, group]]) => [k, { label, group }]),
]);
const choice = q => ({ type: "choice", instructions: q.instructions,
  criteria: { [q.normal[0]]: q.normal[1], [q.defect[0]]: q.defect[1], [q.unclear[0]]: q.unclear[1] } });
// Map a Choice answer to roles so the UI never depends on option wording.
const roles = (q, a) => ({ normal: a.probabilities[q.normal[0]] ?? 0, defect: a.probabilities[q.defect[0]] ?? 0,
  unclear: a.probabilities[q.unclear[0]] ?? 0 });

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
  const r = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
      "Content-Type": "application/json",
      "TypeSafe-Danger-Zone-Images": "true",
    },
    body: JSON.stringify({ model: MODEL, state, assets, questions }),
  });
  if (!r.ok) throw new Error(`Jev ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()).answers;
}

const isJpeg = s => typeof s === "string" && s.length <= MAX_B64 && s.startsWith("/9j/") && /^[A-Za-z0-9+/]+=*$/.test(s);
const round = x => Math.round(x * 1000) / 1000;
const r3 = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)]));

export default async function handler(req, res) {
  if (req.method === "GET") return res.json({ checks: CHECK_META, temporal: Object.fromEntries(Object.entries(TEMPORAL).map(([k, v]) => [k, v[0]])),
    elements: Object.fromEntries(Object.entries(ELEMENTS).map(([k, e]) => [k, { label: e.label, one: e.one, max: e.max }])),
    groups: { people: "People", text: "Text & data", scene: "Scene & physics" } });
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.TYPESAFE_API_KEY) return res.status(500).json({ error: "Server is missing TYPESAFE_API_KEY" });
  const { mode, images, element } = req.body || {};
  const want = mode === "pair" ? 2 : 1;
  if (mode === "pinpoint" && !(req.body.check in PINPOINT)) return res.status(400).json({ error: "Bad request" });
  if (!["inventory", "locate", "verify", "scene", "pair", "pinpoint", "find"].includes(mode) || !Array.isArray(images) || images.length !== want || !images.every(isJpeg)
      || (["locate", "verify"].includes(mode) && !(element in ELEMENTS)))
    return res.status(400).json({ error: "Bad request" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const msg = await limited(ip);
  if (msg) return res.status(429).json({ error: msg });

  try {
    if (mode === "inventory") {
      // `only` re-asks presence for a few types after masking found instances
      const keys = Array.isArray(req.body.only) ? req.body.only.filter(k => k in ELEMENTS) : Object.keys(ELEMENTS);
      const qs = Object.fromEntries(keys.map(k => [k, { type: "noul", instructions: `${ELEMENTS[k].present} ${MASKED}` }]));
      if (!req.body.only) qs.overall = OVERALL;
      const ans = await jev({ img: images[0] }, qs);
      return res.json({ present: r3(Object.fromEntries(Object.keys(qs).map(k => [k, ans[k].noul]))) });
    }
    if (mode === "locate") {
      const ans = await jev({ img: images[0] }, { b: { type: "box", instructions: `${ELEMENTS[element].find} in \`img\`. ${MASKED}` } });
      return res.json({ box: ans.b.box, confidence: ans.b.confidence });
    }
    if (mode === "find") {
      // Neutral discovery: any one distinct thing not yet covered by gray.
      const ans = await jev({ img: images[0] }, { b: { type: "box", instructions:
        `one distinct object, person, animal, or block of text in \`img\` that is not covered by a gray rectangle. ${MASKED}` } });
      return res.json({ box: ans.b.box, confidence: ans.b.confidence });
    }
    if (mode === "pinpoint") {
      const ans = await jev({ img: images[0] }, { b: { type: "box", instructions: PINPOINT[req.body.check] } });
      return res.json({ box: ans.b.box, confidence: ans.b.confidence });
    }
    if (mode === "verify") {
      const checks = ELEMENTS[element].checks;
      const ans = await jev({ img: images[0] }, Object.fromEntries(Object.entries(checks).map(([k, [, q]]) => [k, choice(q)])));
      return res.json({ checks: Object.fromEntries(Object.entries(checks).map(([k, [, q]]) => [k, r3(roles(q, ans[k]))])) });
    }
    if (mode === "scene") {
      const ans = await jev({ img: images[0] }, Object.fromEntries(Object.entries(SCENE).map(([k, [, , q]]) => [k, choice(q)])));
      return res.json({ checks: Object.fromEntries(Object.entries(SCENE).map(([k, [, , q]]) => [k, r3(roles(q, ans[k]))])) });
    }
    const ans = await jev({ a: images[0], b: images[1] }, Object.fromEntries(Object.entries(TEMPORAL).map(([k, [, q]]) => [k, choice(q)])));
    return res.json({ checks: Object.fromEntries(Object.entries(TEMPORAL).map(([k, [, q]]) => [k, r3(roles(q, ans[k]))])) });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "The detector is unavailable right now." });
  }
}
