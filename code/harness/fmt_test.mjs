// Compare question formats on document crops: A = yes/no noul, B = Choice over a list of problems.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
const key = process.env.TYPESAFE_API_KEY;
const crops = JSON.parse(readFileSync(process.argv[2], "utf8"));   // [{name, b64}]
const DEF = "A hallucination is a detail that could not exist in a real document: a misspelled or invented word, " +
  "a sentence that is absurd or impossible for its context, numbers that don't add up, or text that breaks off mid-word where the page continues.";
const A = { type: "noul", instructions: { definition: DEF, question: "Does the document page in `img` contain a hallucination?" },
  criteria: { true: "at least one hallucination is visible on the page", false: "everything on the page is correct and coherent, or nothing is readable" } };
const B = { type: "choice", instructions: "Read the document page in `img` carefully. Which best describes it?",
  criteria: {
    "everything is correct": "all readable words, sentences and numbers are coherent and correct",
    "misspelled or invented words": "a common word is misspelled, or a word doesn't exist",
    "absurd or impossible statement": "a sentence says something absurd or impossible for this kind of document",
    "numbers don't add up": "a total, difference or percentage doesn't match its figures",
    "text breaks off": "a word or sentence stops mid-way although the page continues and nothing covers it",
    "can't tell": "the text is too small or blurry to read" } };
for (const c of crops) {
  const r = await fetch("https://api.typesafe.ai/v1/systemone", { method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "TypeSafe-Danger-Zone-Images": "true" },
    body: JSON.stringify({ model: "jev-1.14.0", state: { img: "ID-" + c.name }, assets: { ["ID-" + c.name]: { type: "image", format: "jpeg", data_base64: c.b64 } }, questions: { A, B } }) });
  const a = (await r.json()).answers;
  const top = Object.entries(a.B.probabilities).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toFixed(2)}`);
  console.log(`${c.name.padEnd(22)} A(yes)=${a.A.noul.toFixed(2)}  B: ${top.join(" | ")}`);
}
