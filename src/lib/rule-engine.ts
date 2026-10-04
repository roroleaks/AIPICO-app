import { KB, QUESTION_TYPES, SYNONYMS, rationalOutcomes, type Analysis, type Clarification, type Formulation, type SpecialtyKey } from "./kb";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function singular(t: string): string {
  return t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t;
}

function canonical(term: string): string {
  const n = normalize(singular(term));
  return SYNONYMS[n] || term;
}

const NORM_SYNONYMS: Record<string, string> = Object.fromEntries(
  Object.entries(SYNONYMS).map(([k, v]) => [normalize(k), v])
);

function matchIn(text: string, list: string[]): string[] {
  const norm = normalize(text);
  const found: string[] = [];
  for (const raw of list) {
    const t = NORM_SYNONYMS[singular(normalize(raw))] || NORM_SYNONYMS[normalize(raw)] || normalize(singular(raw));
    if (t.length >= 4 && norm.includes(t)) {
      found.push(canonical(raw));
    }
  }
  return [...new Set(found)];
}

const FERTILITY_CUES = ["ivf", "icsi", "iui", "infertil", "conception", "fertility", "embryo", "oocyte", "sperm", "ovul", "amh", "implantation", "blastocyst", "recurrent pregnancy loss", "miscarriage"];

export function ruleAnalyze(input: string): Analysis {
  const lower = input.toLowerCase();
  let best: SpecialtyKey[] = [];
  let bestHits = 0;
  for (const key of Object.keys(KB) as SpecialtyKey[]) {
    const hits = matchIn(lower, KB[key].conditions).length * 2 + matchIn(lower, KB[key].interventions).length;
    if (hits > bestHits) { bestHits = hits; best = [key]; }
    else if (hits === bestHits && hits > 0) best.push(key);
  }
  let specKey: SpecialtyKey | null = null;
  if (bestHits > 0) {
    if (best.length === 1) specKey = best[0];
    else if (FERTILITY_CUES.some(w => lower.includes(w))) specKey = best.includes("infertility") ? "infertility" : best[0];
    else specKey = best.includes("gynecology") ? "gynecology" : (best.includes("obstetrics") ? "obstetrics" : best[0]);
  }
  if (!specKey) {
    return {
      specialty: null, specialtyLabel: "Unknown", condition: "", intervention: "",
      comparator: "", questionType: "Therapy / Prevention", framework: "PICO",
      missing: ["condition", "intervention", "comparator", "outcome"],
      interpretation: "Could not map this to a known specialty in offline mode.",
      source: "rules"
    };
  }
  const spec = KB[specKey];
  const conds = matchIn(lower, spec.conditions);
  const ivs = matchIn(lower, spec.interventions);
  const diagWords = ["diagnos", "ultrasound", "mri", "accuracy", "test"];
  const progWords = ["prognos", "predict", "risk of", "likelihood"];
  let qt = QUESTION_TYPES[0];
  if (diagWords.some(w => lower.includes(w))) qt = QUESTION_TYPES[1];
  else if (!ivs.length && !progWords.some(w => lower.includes(w))) qt = QUESTION_TYPES[3];

  const missing: string[] = [];
  if (!conds.length) missing.push("condition");
  if (!ivs.length && qt.framework === "PICO") missing.push("intervention");
  if (ivs.length < 2 && qt.framework === "PICO") missing.push("comparator");
  missing.push("outcome");

  return {
    specialty: specKey,
    specialtyLabel: spec.label,
    condition: conds[conds.length - 1] || "",
    intervention: ivs[ivs.length - 1] || "",
    comparator: ivs.length > 1 ? ivs[ivs.length - 2] : "",
    questionType: qt.type,
    framework: qt.framework,
    missing,
    interpretation: `Recognized ${spec.label} context with ${qt.type} intent.`,
    source: "rules"
  };
}

export function ruleClarify(analysis: Analysis, answered: Record<string, string>): Clarification {
  const spec = analysis.specialty ? KB[analysis.specialty] : null;
  const nextField = analysis.missing.find(f => !answered[f]);
  if (!nextField || !spec) {
    return { done: true, field: null, questionText: "", options: [], allowFreeText: false, source: "rules" };
  }
  const prompts: Record<string, string> = {
    condition: "What is the clinical problem or population?",
    intervention: "What intervention are you considering?",
    comparator: "Compared with what?",
    outcome: "What is your primary outcome?"
  };
  const optionMap: Record<string, string[]> = {
    condition: spec.conditions,
    intervention: spec.interventions,
    comparator: ["no treatment / placebo", "usual care", ...spec.interventions.slice(0, 5)],
    outcome: spec.outcomesRanked
  };
  let options: string[] = (optionMap[nextField] || []).slice(0, 8);
  let rationale: string | undefined;
  if (nextField === "outcome") {
    const condition = answered.condition || analysis.condition || "";
    const logic = rationalOutcomes(condition, analysis.specialty);
    options = [logic.primary, ...logic.alternatives.filter(o => o !== logic.primary)].slice(0, 8);
    rationale = logic.rationale;
  }
  return {
    done: false,
    field: nextField,
    questionText: prompts[nextField] || `Please specify: ${nextField}`,
    options,
    allowFreeText: true,
    source: "rules",
    rationale
  };
}

export function ruleFormulate(analysis: Analysis, answered: Record<string, string>): Formulation {
  const cond = answered.condition || analysis.condition || "the population of interest";
  const iv = answered.intervention || analysis.intervention || "the intervention";
  const comp = answered.comparator || analysis.comparator || "no treatment";
  const out = answered.outcome || "a clinically meaningful outcome";
  let finalQuestion: string;
  let elements: { label: string; value: string }[];
  switch (analysis.framework) {
    case "PICO":
      finalQuestion = `In women with ${cond}, does ${iv} compared with ${comp} improve ${out}?`;
      elements = [
        { label: "P — Population", value: `Women with ${cond}` },
        { label: "I — Intervention", value: iv },
        { label: "C — Comparator", value: comp },
        { label: "O — Outcome", value: out }
      ];
      break;
    case "Diagnostic accuracy (PIRD)":
      finalQuestion = `In patients with suspected ${cond}, what is the diagnostic accuracy of ${iv} compared with the reference standard?`;
      elements = [
        { label: "P — Population", value: `Patients with suspected ${cond}` },
        { label: "I — Index test", value: iv },
        { label: "R — Reference standard", value: "Standard reference test" },
        { label: "D — Accuracy outcomes", value: "Sensitivity and specificity" }
      ];
      break;
    default:
      finalQuestion = `In women with ${cond}, is exposure to ${iv} associated with ${out} compared with unexposed women?`;
      elements = [
        { label: "P — Population", value: `Women with ${cond}` },
        { label: "E — Exposure", value: iv },
        { label: "C — Comparator", value: comp },
        { label: "O — Outcome", value: out }
      ];
  }
  const scores = [
    { name: "Population", value: cond ? 18 : 8 },
    { name: "Intervention/Exposure", value: iv ? 19 : 10 },
    { name: "Comparator", value: comp ? 18 : 12 },
    { name: "Outcome", value: 14 },
    { name: "Specificity", value: 17 }
  ];
  const advisories: string[] = [];
  const logic = rationalOutcomes(cond, analysis.specialty ?? null);
  if (out.toLowerCase() === logic.primary.toLowerCase()) {
    scores[3] = { name: "Outcome", value: 20 };
  } else if (logic.alternatives.some(o => o.toLowerCase() === out.toLowerCase())) {
    scores[3] = { name: "Outcome", value: 17 };
    advisories.push(`'${out}' is a reasonable outcome, but '${logic.primary}' is the most patient-centered for this scenario.`);
  } else {
    scores[3] = { name: "Outcome", value: scores[3].value };
    advisories.push(`'${out}' is not the most appropriate outcome for this scenario. Consider '${logic.primary}' — ${logic.rationale.replace(/\.$/, "")}.`);
  }
  if (/miscarriage rate|implantation rate|clinical pregnancy rate/.test(out.toLowerCase())) {
    advisories.push("Report pregnancy-related outcomes as live birth or ongoing pregnancy where possible — biochemical endpoints are poor surrogates.");
  }
  const spec = analysis.specialty ? KB[analysis.specialty] : null;
  const altOutcomes = [...(logic.alternatives || []), ...(spec ? spec.outcomesRanked : [])]
    .filter(o => o.toLowerCase() !== out.toLowerCase());
  const variants = [
    { question: finalQuestion, rationale: "Recommended default — uses your chosen outcome." },
    ...altOutcomes.map(o => ({
      question: finalQuestion.replace(new RegExp(out.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), o),
      rationale: `Same question with "${o}" as the primary outcome.`
    }))
  ].slice(0, 4);
  return {
    framework: analysis.framework,
    elements,
    finalQuestion,
    variants,
    scores,
    advisories,
    searchTerms: { population: cond, intervention: iv, outcome: out },
    source: "rules"
  };
}
