import { KB, QUESTION_TYPES, SYNONYMS, rationalOutcomes, type Analysis, type Clarification, type Formulation, type SpecialtyKey } from "./kb.ts";

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
  // These two functions are the fallback for the AI path, so they must never be the thing that
  // throws. `analysis` arrives straight from a request body: `{}`, `[]` and `"x"` are all
  // truthy, reached the old unguarded `analysis.missing.find(...)`, and turned a provider
  // failure into an unhandled TypeError. Normalize defensively; the route separately rejects
  // genuinely malformed input with a 400.
  const a = (analysis || {}) as Partial<Analysis>;
  const ans = (answered || {}) as Record<string, string>;
  // Resolve the specialty against the KB once. A truthy but unrecognized value such as "nope"
  // must collapse to null here, because every downstream KB[...] lookup and rationalOutcomes call
  // would otherwise dereference undefined.
  const specKey: SpecialtyKey | null =
    a.specialty && KB[a.specialty as SpecialtyKey] ? (a.specialty as SpecialtyKey) : null;
  const spec = specKey ? KB[specKey] : null;
  const missing = Array.isArray(a.missing) ? a.missing : [];
  const nextField = missing.find(f => !ans[f]);
  if (!nextField) {
    return { done: true, field: null, questionText: "", options: [], allowFreeText: false, source: "rules" };
  }
  // A missing specialty spec is NOT a reason to stop asking. The old code returned done: true
  // whenever `spec` was null, so an unrecognised clinical area skipped clarification entirely and
  // went straight to ruleFormulate with nothing collected - which then fabricated "Women with the
  // population of interest" as a clinical question. The PICO prompts below need no spec; only the
  // suggested options do, and an empty option list still leaves the free-text answer available.
  const prompts: Record<string, string> = {
    condition: "What is the clinical problem or population?",
    intervention: "What intervention are you considering?",
    comparator: "Compared with what?",
    outcome: "What is your primary outcome?"
  };
  const optionMap: Record<string, string[]> = {
    condition: spec ? spec.conditions : [],
    intervention: spec ? spec.interventions : [],
    comparator: spec ? ["no treatment / placebo", "usual care", ...spec.interventions.slice(0, 5)] : [],
    outcome: spec ? spec.outcomesRanked : []
  };
  let options: string[] = (optionMap[nextField] || []).slice(0, 8);
  let rationale: string | undefined;
  if (nextField === "outcome") {
    const condition = ans.condition || a.condition || "";
    const logic = rationalOutcomes(condition, specKey);
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
  const a = (analysis || {}) as Partial<Analysis>;
  const ans = (answered || {}) as Record<string, string>;
  const cond = ans.condition || a.condition || "";
  const iv = ans.intervention || a.intervention || "";
  const comp = ans.comparator || a.comparator || "no treatment";
  const out = ans.outcome || "a clinically meaningful outcome";

  // Without a population and an intervention the switch below emits a fluent, confident question
  // containing invented content - "In women with the population of interest, does the intervention
  // compared with no treatment improve a clinically meaningful outcome?" That reads as a clinical
  // question while asserting nothing, which is worse than an error in a decision-support tool. So
  // refuse and name the elements the caller still owes, rather than fabricate. Comparator and
  // outcome keep their neutral defaults: "no treatment" and "a clinically meaningful outcome" are
  // defensible positions for a PICO, whereas inventing a population is not.
  const missingElements: string[] = [];
  if (!cond.trim()) missingElements.push("condition");
  if (!iv.trim()) missingElements.push("intervention");
  if (missingElements.length) {
    return {
      framework: a.framework as Formulation["framework"],
      elements: [],
      finalQuestion: "",
      variants: [],
      scores: [],
      advisories: [],
      searchTerms: { population: "", intervention: "", outcome: "" },
      source: "rules",
      complete: false,
      missingElements
    };
  }

  let finalQuestion: string;
  let elements: { label: string; value: string }[];
  // Resolve the specialty once, against the KB, so an unrecognized truthy value such as "nope"
  // becomes null here instead of being handed to KB lookups further down.
  const specKey: SpecialtyKey | null =
    a.specialty && KB[a.specialty as SpecialtyKey] ? (a.specialty as SpecialtyKey) : null;
  const spec = specKey ? KB[specKey] : null;
  switch (a.framework) {
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
  const logic = rationalOutcomes(cond, specKey);
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
    framework: a.framework as Formulation["framework"],
    elements,
    finalQuestion,
    variants,
    scores,
    advisories,
    searchTerms: { population: cond, intervention: iv, outcome: out },
    source: "rules",
    complete: true,
    missingElements: []
  };
}
