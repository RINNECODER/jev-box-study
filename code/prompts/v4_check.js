// POST /api/check — thin proxy to Jev. Prompts live here so the endpoint can't be used as a general Jev proxy.
// Two layers (asking "is something wrong?" up front primes the model toward yes, so discovery is neutral):
//   find:  box one distinct thing not yet covered by gray (a page, object, person, animal or sign)
//   item:  on a sharp crop of one found thing, classify it AND ask every category's list question in the same call
//          (speculative fan-out); each list = "everything is correct" + that category's hallucination types + "can't tell"
//   pinpoint: box a specific problem inside a region already flagged for it
//   scene: whole-image list question + AI likelihood
//   pair:  two consecutive video frames
// Categories and hallucination types follow published AI-artifact taxonomies (SynArtifact, the Northwestern/Kellogg
// guide, GeneVA) and practitioner checklists; "everything is correct" names the real-photo look-alikes.
const API = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-1.14.0";
const PRICE_PER_MTOK = 0.042;  // USD per million input tokens (docs.typesafe.ai/models, 2026-10-14); output is free
const MAX_B64 = 3_000_000;
const MASKED = "Solid gray rectangles cover areas already found; ignore them.";

// One list question per category: "everything is correct", the category's known hallucination types, or "can't tell".
// key -> { label, desc (shown to the classifier), group, problems: { slug: [label, description] } }
// Measured on stacked documents: "text breaks off" fired on every page cut by another page or the frame, so it's left out.
const CATS = {
  page: { label: "document page", desc: "a sheet of paper, page, slide, form or screen of a document", group: "text", problems: {
    words: ["Misspelled or invented words", "a common word is misspelled, a word doesn't exist, or shapes pose as letters"],
    absurd: ["Absurd or impossible statement", "a sentence says something absurd, impossible or self-contradictory for this kind of document"],
    numbers: ["Numbers don't add up", "a total, difference or percentage doesn't match its figures, or a date is impossible"],
    chart: ["Chart contradicts its labels", "a chart's bars, slices or axes disagree with its own labels or numbers"],
  } },
  sign: { label: "sign or label", desc: "a sign, label, logo, packaging or screen with text", group: "text", problems: {
    words: ["Misspelled or invented words", "a common word is misspelled, a word doesn't exist, or shapes pose as letters"],
    absurd: ["Absurd text", "the text is nonsense or impossible for this kind of sign"],
  } },
  hand: { label: "hand", desc: "a human hand", group: "people", problems: {
    fingers: ["Wrong number of fingers", "clearly four, six or more fingers on one hand"],
    shape: ["Malformed fingers", "fingers fused, branching or bending backwards"],
    grip: ["Impossible grip", "a held object merges into the hand, passes through it or floats beside the fingers"],
  } },
  face: { label: "face", desc: "a human face or head", group: "people", problems: {
    eyes: ["Mismatched eyes", "pupils or irises of different shape or size, eyes looking different ways, or reflections in the eyes that disagree"],
    teeth: ["Malformed teeth", "teeth merged into one bar, or far too many"],
    melt: ["Melting features", "ears, hairline or features smeared or fusing into the skin or background"],
  } },
  eyewear: { label: "glasses", desc: "eyeglasses or sunglasses", group: "objects", problems: {
    lenses: ["Mismatched lenses", "lenses of different shape or tint, or a frame edge missing"],
    arms: ["Broken arms", "an arm (temple) fuses into skin, hair or the surface, or ends nowhere"],
    merge: ["Merges with surroundings", "the glasses melt into the object they rest on"],
  } },
  body: { label: "person or animal body", desc: "the body of a person or an animal", group: "people", problems: {
    limbs: ["Extra or missing limbs", "an extra or missing arm, leg, paw or head with nothing hiding it"],
    joints: ["Impossible joints", "a limb or neck bends where no joint exists"],
    fused: ["Bodies fused", "two bodies or a body and an object grow into each other"],
  } },
  wearable: { label: "clothing, strap or jewelry", desc: "clothing, a bag strap, a cable, a necklace, an earring or a watch", group: "objects", problems: {
    melt: ["Melts into skin or objects", "a strap, fabric or chain melts into skin or another object"],
    ends: ["No beginning or end", "a strap, cable or chain has no ends, or changes thickness or style along its length"],
    pattern: ["Broken pattern or seams", "seams, buttons, zippers or a fabric pattern don't line up or change midway"],
  } },
  mechanism: { label: "dial, keyboard or instrument", desc: "a clock, watch dial, keyboard, musical instrument or sports gear with regular parts", group: "objects", problems: {
    numbers: ["Wrong numbers or hands", "duplicated or nonsense numbers on a dial, or extra clock hands"],
    parts: ["Broken regular parts", "merged or mislabeled keys, or the wrong number of strings, frets or spokes"],
  } },
  furniture: { label: "furniture or architecture", desc: "furniture, a room, a building, stairs, windows or railings", group: "objects", problems: {
    legs: ["Legs or supports wrong", "legs merge, vanish or change count"],
    connect: ["Parts don't connect", "stairs, railings or frames don't connect"],
    lines: ["Bent straight lines", "straight lines bend or break, or repeated windows or columns change size for no reason"],
  } },
  vehicle: { label: "vehicle", desc: "a car, bike, boat or other vehicle", group: "objects", problems: {
    wheels: ["Mismatched wheels", "wheels of different sizes or spoke counts"],
    parts: ["Parts in impossible places", "mirrors, handles or plates in impossible positions, or panel lines that don't close"],
  } },
  food: { label: "food or tableware", desc: "food, a drink, a cup, a plate or utensils", group: "objects", problems: {
    fused: ["Utensil or food fused", "a utensil fuses into the food, or food merges with the plate or cup"],
    physics: ["Impossible liquid or shape", "liquid at an impossible level, a glass with no bottom, or food that defies gravity"],
  } },
  plant: { label: "plant", desc: "a plant, flower or tree", group: "objects", problems: {
    repeat: ["Cloned leaves", "identical repeated leaves or flowers"],
    branches: ["Broken branches", "branches or stems that end in nothing or fuse together"],
  } },
  reflection: { label: "mirror or glass", desc: "a mirror, window, water or other reflective surface", group: "objects", problems: {
    mismatch: ["Wrong reflection", "the reflection shows a different scene, pose, outfit or number of things than its source"],
  } },
  object: { label: "other object", desc: "any other object", group: "objects", problems: {
    merge: ["Merges with another object", "it melts into what it touches, or passes through it"],
    form: ["Half-formed or hybrid", "half-formed, dissolving, a mix of two different things, or floating without support"],
  } },
  background: { label: "background", desc: "a plain surface, background or empty area", group: "objects", problems: {} },
};
// Discovery targets: whole-image passes for large things, then a general pass per section for small things.
const FIND = {
  any: "one distinct thing (a sheet of paper or page, an object, a person, an animal, or a sign)",
  page: "one single sheet of paper, page, card or screen (just one, not a group)",
  person: "one single person or animal (just one, not a group)",
  object: "one single physical object that is not paper (such as glasses, a cup, a plant, a phone, a tool or furniture)",
};
const CORRECT = "everything is correct", UNSURE = "can't tell";
// Normal look-alikes from the research, so busy real photos have a correct answer to choose.
const NORMAL = "everything looks like a real, coherent thing; blur, motion, glare, retouching, lens distortion, " +
  "and parts hidden by other objects or cut by the image edge are normal";

const SCENE = {
  lighting: ["Lighting & shadows disagree", "shadows point different ways under one light, an object lacks a shadow its neighbours have, or one subject is lit differently"],
  perspective: ["Impossible perspective or scale", "vanishing lines disagree, or something is far too big or small for where it is"],
  background: ["Meaningless background", "background shapes that look like people, signs or buildings but aren't anything"],
  cloned: ["Cloned elements", "the same face, object or detail copied unnaturally, or a repeating pattern that breaks or merges"],
};
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
const CLASSIFY = { type: "choice", instructions: "What is the main thing shown in `img`?",
  criteria: Object.fromEntries(Object.values(CATS).map(c => [c.label, c.desc])) };
const PROBLEMS = Object.fromEntries(Object.entries(CATS).flatMap(([c, v]) => Object.entries(v.problems).map(([k, [, d]]) => [`${c}.${k}`, d])));
const META_CHECKS = Object.fromEntries([
  ...Object.entries(CATS).flatMap(([c, v]) => Object.entries(v.problems).map(([k, [l]]) => [`${c}.${k}`, { label: l, group: v.group }])),
  ...Object.entries(SCENE).map(([k, [l]]) => [`scene.${k}`, { label: l, group: "scene" }]),
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
  const j = await r.json();
  Object.defineProperty(j.answers, "usage", { value: j.usage });  // token usage, for the UI's cost meter
  return j.answers;
}

const isJpeg = s => typeof s === "string" && s.length <= MAX_B64 && s.startsWith("/9j/") && /^[A-Za-z0-9+/]+=*$/.test(s);
const round = x => Math.round(x * 1000) / 1000;

export default async function handler(req, res) {
  if (req.method === "GET") return res.json({ checks: META_CHECKS, price_per_mtok: PRICE_PER_MTOK,
    cats: Object.fromEntries(Object.entries(CATS).map(([k, c]) => [k, { label: c.label }])),
    temporal: Object.fromEntries(Object.entries(TEMPORAL).map(([k, v]) => [k, v[0]])),
    groups: { people: "People", objects: "Objects", text: "Text & documents", scene: "Scene" } });
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.TYPESAFE_API_KEY) return res.status(500).json({ error: "Server is missing TYPESAFE_API_KEY" });
  const { mode, images } = req.body || {};
  const want = mode === "pair" ? 2 : 1;
  if (mode === "pinpoint" && !PROBLEMS[req.body.problem]) return res.status(400).json({ error: "Bad request" });
  if (!["find", "item", "scene", "pair", "pinpoint"].includes(mode) || !Array.isArray(images) || images.length !== want || !images.every(isJpeg))
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
    if (mode === "pinpoint") {
      // only used after a region was already judged to contain this problem
      const ans = await jevU({ img: images[0] }, { b: { type: "box", instructions: `the exact spot in \`img\` where ${PROBLEMS[req.body.problem]}` } });
      return res.json({ box: ans.b.box, confidence: ans.b.confidence });
    }
    if (mode === "item") {
      // classify + every category's list in one call (speculative fan-out); the UI uses the list of the winning category
      const lists = Object.fromEntries(Object.entries(CATS).filter(([, c]) => Object.keys(c.problems).length)
        .map(([k, c]) => [k, listQ(`If \`img\` shows ${c.desc}, look at it closely. Which best describes it?`, c.problems)]));
      const ans = await jevU({ img: images[0] }, { category: CLASSIFY, ...lists });
      const byLabel = Object.fromEntries(Object.entries(CATS).map(([k, c]) => [c.label, k]));
      return res.json({ category: Object.fromEntries(Object.entries(ans.category.probabilities).map(([l, p]) => [byLabel[l], round(p)])),
        lists: Object.fromEntries(Object.keys(lists).map(k => [k, split(CATS[k].problems, ans[k])])) });
    }
    if (mode === "scene") {
      const ans = await jevU({ img: images[0] }, { overall: OVERALL, scene: listQ("Look at the whole of `img`. Which best describes it?", SCENE) });
      return res.json({ overall: round(ans.overall.noul), list: split(SCENE, ans.scene) });
    }
    const ans = await jevU({ a: images[0], b: images[1] }, { pair: listQ("Compare frame `a` with the next frame `b` of a video. Which best describes the change?", TEMPORAL) });
    return res.json({ list: split(TEMPORAL, ans.pair) });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "The detector is unavailable right now." });
  }
}
