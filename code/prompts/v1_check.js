// POST /api/check — thin proxy to Jev. Prompts live here so the endpoint can't be used as a general Jev proxy.
// Body: { mode: "image" | "box" | "pair", images: [jpegBase64, ...], flagged?: [checkKey, ...], scope?: "full" | "tile" }
// GET /api/check returns the check list (labels + groups) and the definition for the UI.
const API = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-1.14.0";
const MAX_B64 = 3_000_000; // ~2.2 MB JPEG; client sends <=1568px frames, well under Vercel's 4.5 MB body cap

// What Jev is told a hallucination is. Every check carries it, so the yes/no boundary is the same everywhere.
const DEFINITION = "A hallucination is a detail that could not exist in a real, coherent photo or document: " +
  "physically impossible, internally contradictory, or meaningless where it should carry meaning. " +
  "Ordinary photo flaws (blur, noise, compression, cropping, things hidden behind other things or cut off by the frame) are NOT hallucinations.";

// Narrow checks: one specific, observable failure each (TypeSafe guidance: one coherent judgment per question).
// key: [label, group, question (high = present), box target, criteria.true, criteria.false]
const NONE = "or there is nothing of this kind in `img`";
const CHECKS = {
  // people
  finger_count: ["Finger count", "people", "A visible hand in `img` has more or fewer than five fingers (count thumb as a finger).",
    "the hand with the wrong number of fingers in `img`", "a clearly visible hand with 4, 6 or more fingers",
    `every clearly visible hand has five fingers, fingers are only hidden by pose or objects, ${NONE}`],
  fused_fingers: ["Fused fingers", "people", "Fingers in `img` are fused together, melt into each other, or bend backwards at the joints.",
    "the fused or wrongly bent fingers in `img`", "fingers that merge into one shape or bend the wrong way",
    `fingers are separate and bend normally, ${NONE}`],
  hand_attach: ["Hand attachment", "people", "A hand in `img` is attached wrongly: wrong side, growing from the wrong place, or with no arm leading to it.",
    "the wrongly attached hand in `img`", "a hand that can't belong to any arm in the picture", `every hand connects to a plausible arm, ${NONE}`],
  eyes: ["Eyes", "people", "Eyes in `img` don't match: different sizes, different gaze directions, misshapen pupils or irises, or an extra eye.",
    "the mismatched eyes in `img`", "a face whose two eyes clearly disagree in shape, size, pupil or direction",
    `eyes match (a deliberate side glance or squint is normal), ${NONE}`],
  teeth: ["Teeth", "people", "Teeth in `img` are merged into one strip, too many, or shaped like no real teeth.",
    "the malformed teeth in `img`", "teeth that blend together or are clearly too many", `teeth look like real teeth, ${NONE}`],
  face_melt: ["Melting face", "people", "A face in `img` has features that smear, melt into the skin, or are lopsided in a way no real face is.",
    "the melting or lopsided face in `img`", "a face with smeared or impossibly asymmetric features",
    `faces are coherent (motion blur and small background faces are normal), ${NONE}`],
  ears_hair: ["Ears, hair & jewelry", "people", "Ears, earrings, glasses or hair in `img` melt into the skin or background, or don't match from one side to the other.",
    "the melting ear, hair or accessory in `img`", "an accessory or hair that dissolves or mismatches impossibly",
    `ears, hair and accessories are coherent, ${NONE}`],
  limb_count: ["Limb count", "people", "A person or animal in `img` has an extra or a missing arm, leg or paw that nothing hides.",
    "the body with an extra or missing limb in `img`", "a body with a limb too many, or one missing with nothing covering it",
    `every body has the right limbs, or missing ones are hidden by pose, objects or the frame, ${NONE}`],
  joints: ["Impossible joints", "people", "An arm, leg, neck or spine in `img` bends at a place or angle where no joint exists.",
    "the impossibly bent limb or neck in `img`", "a bend that real anatomy can't make", `bodies bend at real joints, ${NONE}`],
  body_merge: ["Bodies merging", "people", "Two people or animals in `img` are fused, or a limb belongs to the wrong body.",
    "the place where two bodies merge in `img`", "bodies or limbs that grow into each other", `bodies are separate, ${NONE}`],
  // objects & scene
  object_fusion: ["Objects fused", "scene", "Two separate objects in `img` are fused into one, such as a cup melting into a table or a phone merging with a hand.",
    "the place where two objects are fused in `img`", "two things that should be separate grow into each other",
    `objects touch or overlap normally, ${NONE}`],
  pass_through: ["Passing through", "scene", "A solid object in `img` passes through another solid object, like a strap going through an arm.",
    "the object passing through another in `img`", "one solid thing visibly intersects another",
    `objects sit in front of or behind each other normally, ${NONE}`],
  half_formed: ["Half-formed object", "scene", "An object in `img` is unfinished: it fades out, dissolves into the background, or is missing parts it needs to work.",
    "the half-formed object in `img`", "an object that dissolves or is missing essential parts",
    `objects are complete or cut only by the frame or by something in front, ${NONE}`],
  hybrid: ["Hybrid object", "scene", "An object in `img` is a mix of two different things, such as a chair that turns into a table or a bag with a shoe's sole.",
    "the hybrid object in `img`", "one object combining two unrelated things", `each object is one recognisable thing, ${NONE}`],
  floating: ["Floating object", "scene", "An object in `img` floats with nothing supporting it when it should be resting, hanging or held.",
    "the floating object in `img`", "something heavy hovering without support", `objects are supported, thrown, or meant to fly, ${NONE}`],
  grip: ["Grip", "scene", "Something held in `img` isn't actually gripped: the hand doesn't wrap it, or it hovers next to the fingers.",
    "the badly held object in `img`", "a held item that the hand doesn't really hold", `held items are gripped normally, ${NONE}`],
  straight_lines: ["Bent straight lines", "scene", "An edge in `img` that should be straight (door frame, shelf, table edge, window, horizon) wobbles, kinks or breaks.",
    "the wobbly straight edge in `img`", "a man-made straight edge that bends or breaks for no reason",
    `straight edges stay straight (wide-angle lens curvature is normal), ${NONE}`],
  pattern: ["Broken pattern", "scene", "A repeating pattern in `img` (tiles, bricks, keyboard keys, stairs, fence posts, piano keys) is irregular, merges or changes partway.",
    "the broken repeating pattern in `img`", "a regular pattern that loses its regularity", `patterns are regular, ${NONE}`],
  perspective: ["Perspective & scale", "scene", "Parts of `img` disagree on perspective or scale: an object too big or small for its distance, or surfaces that can't meet.",
    "the object with impossible scale or perspective in `img`", "a size or angle that can't fit the rest of the scene",
    "scale and perspective are consistent"],
  background: ["Background mush", "scene", "The background of `img` turns into meaningless shapes where real things (people, signs, buildings, shelves) should be.",
    "the meaningless background area in `img`", "background detail that looks like things but isn't anything",
    "the background is recognisable, or simply out of focus (normal blur is fine)"],
  // light & physics
  shadow_dir: ["Shadow direction", "light", "Shadows in `img` point in different directions under what is clearly a single light source.",
    "the shadow pointing the wrong way in `img`", "shadows that disagree about where the light is",
    "shadows agree, or there are several lights, or no clear shadows"],
  shadow_missing: ["Missing shadow", "light", "An object in `img` casts no shadow when everything around it does.",
    "the object missing its shadow in `img`", "one object without a shadow among shadowed ones", "shadows are where they should be, or lighting is flat/diffuse"],
  reflection: ["Reflection", "light", "A mirror, window, water or glossy surface in `img` reflects something that doesn't match the scene.",
    "the wrong reflection in `img`", "a reflection that shows the wrong thing or nothing", `reflections match, ${NONE}`],
  lighting: ["Lighting mismatch", "light", "A person or object in `img` is lit from a different direction or color than the rest of the scene, as if pasted in.",
    "the inconsistently lit subject in `img`", "one subject whose lighting can't come from this scene", "lighting is consistent"],
  // text & data
  fake_words: ["Fake words", "text", "Readable text in `img` includes words that don't exist in any language.",
    "the fake words in `img`", "a readable word that isn't a real word",
    "all readable words are real, or no text is readable (tiny or blurry text is NOT fake)"],
  misspelling: ["Misspellings", "text", "Readable text in `img` has misspellings a person or spellchecker wouldn't make, like doubled or swapped letters in common words.",
    "the misspelled words in `img`", "common words spelled wrong", "spelling is correct, or no text is readable"],
  glyphs: ["Fake letters", "text", "Letters or numbers in `img` aren't real characters: invented glyphs, letters melting together, or squiggles posing as text.",
    "the fake letters or squiggle text in `img`", "characters that belong to no alphabet", "characters are real, or there is no text"],
  sums: ["Totals don't add up", "text", "A total, subtotal or sum in `img` doesn't equal its listed parts.",
    "the total that doesn't match its parts in `img`", "a total you can check that is wrong", "totals are right, or nothing can be checked"],
  percents: ["Wrong percentages", "text", "A percentage, change or difference in `img` doesn't match the values it describes, such as a drop from 40 to 35 called growth, or shares adding past 100%.",
    "the wrong percentage or change in `img`", "a stated change or share that contradicts its numbers",
    "percentages and changes match their numbers, or nothing can be checked"],
  chart: ["Chart mismatch", "text", "A chart in `img` disagrees with its own labels or with numbers shown beside it: bar heights out of order, axis values that don't progress, slices that don't fit.",
    "the chart that contradicts its numbers in `img`", "a chart whose drawing contradicts its numbers", `the chart matches its numbers, ${NONE}`],
  dates: ["Date conflict", "text", "Dates in `img` contradict each other or their context, like an invoice due before it was issued, or a date that doesn't exist (June 31).",
    "the conflicting date in `img`", "two dates that can't both be true, or an impossible date", "dates are consistent, or there are none"],
  labels: ["Label conflict", "text", "A title, heading, name or label in `img` doesn't match the content under it or another mention of the same thing.",
    "the label that contradicts its content in `img`", "a heading or name that contradicts the content", "labels match their content"],
  statements: ["Self-contradiction", "text", "A sentence or note in `img` contradicts itself or another sentence, like 'all stores opened on time' next to a store listed as delayed.",
    "the self-contradicting sentence in `img`", "two statements that cannot both be true", "statements are consistent, or there's too little text"],
  text_cutoff: ["Text trails off", "text", "Text in `img` stops mid-word or mid-sentence, or fades into scribbles, where the page continues and nothing covers it.",
    "the text that trails off in `img`", "text that breaks off for no physical reason", "text is complete, or it's cut off by the frame, a fold or something covering it"],
  text_repeat: ["Repeated text", "text", "Lines, words or table rows in `img` repeat in a loop where they should differ.",
    "the repeated text in `img`", "text that copies itself in a loop", "no unnatural repetition"],
  clock: ["Clock & dial", "text", "A clock, watch, gauge or dial in `img` has wrong or duplicated numbers, extra hands, or numbers in the wrong order.",
    "the malformed clock or dial in `img`", "a dial whose numbers or hands are impossible", `dials are correct, ${NONE}`],
  logo: ["Distorted logo", "text", "A logo, brand mark or sign in `img` is a warped near-copy of a real one, with wrong letters or melted shapes.",
    "the distorted logo in `img`", "a logo that is almost, but not quite, a real one", `logos are clean, ${NONE}`],
};
const GROUPS = { people: "People", scene: "Objects & scene", light: "Light & physics", text: "Text & data" };
const OVERALL = ["`img` is AI-generated or AI-edited rather than an untouched photo, scan, screenshot or video frame.",
  "made or altered by AI", "an untouched real capture"];
const TEMPORAL_LABELS = { morph: "Morphing", pop: "Popping" };
const TEMPORAL = {
  morph: ["Something in `b` has changed shape, identity or count compared with `a` in a way real motion can't explain.",
    "an object, face or text changes into something else between frames", "differences come from normal motion, camera movement or lighting"],
  pop: ["An object appears in or disappears from `b` compared with `a` without moving in or out of frame or being occluded.",
    "something vanishes or appears from nowhere", "everything that appears or leaves has a physical reason"],
};

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
// Structured instructions (docs: primitives/advanced): the definition travels with every question.
const NOTE_MASKED = "Solid gray rectangles are areas already reviewed; ignore them entirely.";
const noul = ([q, yes, no]) => ({ type: "noul",
  instructions: { hallucination: DEFINITION, note: NOTE_MASKED, question: q }, criteria: { true: yes, false: no } });
const nouls = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, noul(v)]));
const round = x => Math.round(x * 1000) / 1000;

export default async function handler(req, res) {
  if (req.method === "GET") return res.json({ definition: DEFINITION, groups: GROUPS, temporal: TEMPORAL_LABELS,
    checks: Object.fromEntries(Object.entries(CHECKS).map(([k, v]) => [k, { label: v[0], group: v[1] }])) });
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.TYPESAFE_API_KEY) return res.status(500).json({ error: "Server is missing TYPESAFE_API_KEY" });
  const { mode, images, flagged } = req.body || {};
  const want = mode === "pair" ? 2 : 1;
  if (!["image", "box", "pair"].includes(mode) || !Array.isArray(images) || images.length !== want || !images.every(isJpeg))
    return res.status(400).json({ error: "Bad request" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const msg = await limited(ip);
  if (msg) return res.status(429).json({ error: msg });

  try {
    if (mode === "image") {
      // scope "tile" = a full-resolution crop of a bigger image: skip the whole-image verdict
      // `only` = re-ask just these checks (after masking an already-boxed spot)
      const only = Array.isArray(req.body.only) ? req.body.only.filter(k => k in CHECKS) : null;
      const keys = only?.length ? only : Object.keys(CHECKS);
      const qs = nouls(Object.fromEntries(keys.map(k => [k, [CHECKS[k][2], CHECKS[k][4], CHECKS[k][5]]])));
      if (req.body.scope !== "tile" && !only?.length) qs.overall = noul(OVERALL);
      const ans = await jev({ img: images[0] }, qs);
      return res.json({ scores: Object.fromEntries(Object.keys(ans).map(k => [k, round(ans[k].noul)])) });
    }
    if (mode === "pair") {
      const ans = await jev({ a: images[0], b: images[1] }, nouls(TEMPORAL));
      return res.json({ scores: Object.fromEntries(Object.keys(ans).map(k => [k, round(ans[k].noul)])) });
    }
    const keys = Array.isArray(flagged) ? [...new Set(flagged)].filter(k => k in CHECKS) : [];
    if (!keys.length) return res.status(400).json({ error: "Bad request" });
    const ans = await jev({ img: images[0] }, Object.fromEntries(keys.map(k => [k, { type: "box", instructions: { hallucination: DEFINITION, note: NOTE_MASKED, find: CHECKS[k][3] } }])));
    return res.json({ boxes: Object.fromEntries(keys.map(k => [k, { ...ans[k].box, confidence: ans[k].confidence }])) });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "The detector is unavailable right now." });
  }
}
