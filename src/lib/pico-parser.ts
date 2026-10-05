import { KB, type SpecialtyKey } from "./kb.ts";
import { parseClinicalScenario } from "./clinical-semantics.ts";

export interface ExtractedPico {
  condition: string;
  intervention: string;
  comparator: string;
  outcome: string;
  specialty: SpecialtyKey;
  cleanQuestion: string;
}

const FERTILITY_CUES = [
  "ivf", "icsi", "iui", "infertil", "conception", "fertility", "embryo",
  "oocyte", "sperm", "ovul", "amh", "implantation", "blastocyst",
  "recurrent pregnancy loss", "miscarriage", "letrozole", "clomiphene"
];

const OBSTETRICS_CUES = [
  "preterm", "cervix", "cervical", "preeclampsia", "eclampsia", "gestational",
  "placenta", "fetal", "growth restriction", "pprom", "cerclage", "progesterone",
  "corticosteroid", "magnesium", "obstetric", "pregnancy", "pregnant", "birth",
  "neonatal", "perinatal", "labor", "labour", "delivery"
];

const GYNECOLOGY_CUES = [
  "menstrual", "bleeding", "fibroid", "myoma", "pelvic", "endometri", "adenomyosis",
  "uterus", "uterine", "hysterectomy", "myomectomy", "ablation", "prolapse", "ovarian cyst"
];

export function detectSpecialty(text: string, fallback?: SpecialtyKey | null): SpecialtyKey {
  if (fallback && (fallback === "obstetrics" || fallback === "gynecology" || fallback === "infertility")) {
    return fallback;
  }
  const lower = text.toLowerCase();
  let obsScore = 0;
  let gynScore = 0;
  let infScore = 0;

  for (const c of KB.obstetrics.conditions) { if (lower.includes(c.toLowerCase())) obsScore += 2; }
  for (const i of KB.obstetrics.interventions) { if (lower.includes(i.toLowerCase())) obsScore += 1; }
  for (const w of OBSTETRICS_CUES) { if (lower.includes(w)) obsScore += 1; }

  for (const c of KB.infertility.conditions) { if (lower.includes(c.toLowerCase())) infScore += 2; }
  for (const i of KB.infertility.interventions) { if (lower.includes(i.toLowerCase())) infScore += 1; }
  for (const w of FERTILITY_CUES) { if (lower.includes(w)) infScore += 1; }

  for (const c of KB.gynecology.conditions) { if (lower.includes(c.toLowerCase())) gynScore += 2; }
  for (const i of KB.gynecology.interventions) { if (lower.includes(i.toLowerCase())) gynScore += 1; }
  for (const w of GYNECOLOGY_CUES) { if (lower.includes(w)) gynScore += 1; }

  if (obsScore >= infScore && obsScore >= gynScore && obsScore > 0) return "obstetrics";
  if (FERTILITY_CUES.some(w => lower.includes(w)) && infScore > 0) return "infertility";
  if (gynScore >= infScore && gynScore > 0) return "gynecology";
  if (infScore > 0) return "infertility";

  return "obstetrics"; // Default O&G specialty
}

function cleanPicoToken(s: string): string {
  return s
    .replace(/\s*\([PICO]\)\s*/gi, " ")
    .replace(/^(?:in|for|among)?\s*(?:women|patients|individuals|pregnant individuals|persons)\s+(?:with|undergoing|diagnosed with)?\s+/i, "")
    .replace(/^.*?\b(?:does|is|do|what is the effect of)\s+/i, "")
    .replace(/^.*?\b(?:compared with|versus|vs\.?)\s+/i, "")
    .replace(/^.*?\b(?:improve|reduce|increase|prevent|lower|decrease|affect|impact|lead to|change)\s+/i, "")
    .replace(/^(?:in|for|among)\s+/i, "")
    .replace(/^[,;:]\s*/, "")
    .replace(/\?+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractPicoFromQuestion(
  questionText: string,
  fallbackTopic?: string,
  fallbackSpecialty?: SpecialtyKey | null
): ExtractedPico {
  const q = (questionText || "").trim();
  const topic = (fallbackTopic || "").trim();
  const specialty = detectSpecialty(`${q} ${topic}`, fallbackSpecialty);

  let condition = "";
  let intervention = "";
  let comparator = "";
  let outcome = "";

  // Strategy 1: Check for explicit (P), (I), (C), (O) markers
  // e.g. "In women with preterm birth risk (P), does vaginal progesterone (I) compared with cervical cerclage (C) improve primary patient-centered clinical outcomes (O)?"
  const explicitPMatch = q.match(/([^(]+?)\s*\(P\)/i);
  const explicitIMatch = q.match(/([^(]+?)\s*\(I\)/i);
  const explicitCMatch = q.match(/([^(]+?)\s*\(C\)/i);
  const explicitOMatch = q.match(/([^(]+?)\s*\(O\)/i);

  if (explicitPMatch && explicitPMatch[1]) {
    condition = cleanPicoToken(explicitPMatch[1]);
  }
  if (explicitIMatch && explicitIMatch[1]) {
    intervention = cleanPicoToken(explicitIMatch[1]);
  }
  if (explicitCMatch && explicitCMatch[1]) {
    comparator = cleanPicoToken(explicitCMatch[1]);
  }
  if (explicitOMatch && explicitOMatch[1]) {
    outcome = cleanPicoToken(explicitOMatch[1]);
  }

  // Strategy 2: Standard PICO questions:
  // "In [population/condition], does [intervention] compared with [comparator] [verb] [outcome]?"
  if (!condition || !intervention) {
    const stdMatch = q.match(
      /^(?:In|For|Among)\s+([^,]+?),\s*(?:does|is|do|what is the effect of)?\s+(.+?)\s+(?:compared with|versus|vs\.?)\s+(.+?)\s+(?:improve|reduce|increase|prevent|lower|decrease|affect|impact|lead to)\s+(.+?)\??$/i
    );
    if (stdMatch) {
      if (!condition) condition = cleanPicoToken(stdMatch[1]);
      if (!intervention) intervention = cleanPicoToken(stdMatch[2]);
      if (!comparator) comparator = cleanPicoToken(stdMatch[3]);
      if (!outcome) outcome = cleanPicoToken(stdMatch[4]);
    }
  }

  // Strategy 3: "In [population/condition], does [intervention] [verb] [outcome] compared with [comparator]?"
  if (!condition || !intervention) {
    const altMatch = q.match(
      /^(?:In|For|Among)\s+([^,]+?),\s*(?:does|is|do)?\s+(.+?)\s+(?:improve|reduce|increase|prevent|lower|decrease|affect)\s+(.+?)\s+(?:compared with|versus|vs\.?)\s+(.+?)\??$/i
    );
    if (altMatch) {
      if (!condition) condition = cleanPicoToken(altMatch[1]);
      if (!intervention) intervention = cleanPicoToken(altMatch[2]);
      if (!outcome) outcome = cleanPicoToken(altMatch[3]);
      if (!comparator) comparator = cleanPicoToken(altMatch[4]);
    }
  }

  // Strategy 4: "Does [intervention] compared with [comparator] [verb] [outcome] in [population]?"
  if (!condition || !intervention) {
    const doesMatch = q.match(
      /^Does\s+(.+?)\s+(?:compared with|versus|vs\.?)\s+(.+?)\s+(?:improve|reduce|increase|prevent|lower|decrease|affect)\s+(.+?)\s+(?:in|for|among)\s+(.+?)\??$/i
    );
    if (doesMatch) {
      if (!intervention) intervention = cleanPicoToken(doesMatch[1]);
      if (!comparator) comparator = cleanPicoToken(doesMatch[2]);
      if (!outcome) outcome = cleanPicoToken(doesMatch[3]);
      if (!condition) condition = cleanPicoToken(doesMatch[4]);
    }
  }

  // Strategy 5: Subgroup / undergoing format
  // "In high-risk subgroups of women with [condition] (P), does early intervention with [intervention]..."
  if (!condition) {
    const popMatch = q.match(/(?:In|For|Among)\s+(?:subgroups of\s+)?(?:women|patients|individuals|pregnant individuals)\s+(?:with|undergoing)?\s+([^,]+?)(?:,|\s+\(P\))/i);
    if (popMatch && popMatch[1]) {
      condition = cleanPicoToken(popMatch[1]);
    }
  }

  // Fallback 1: Condition from KB match or fallbackTopic
  if (!condition || condition.length < 3) {
    const searchTarget = `${q} ${topic}`.toLowerCase();
    for (const spec of Object.values(KB)) {
      for (const c of spec.conditions) {
        if (searchTarget.includes(c.toLowerCase())) {
          condition = c;
          break;
        }
      }
      if (condition) break;
    }
  }
  if (!condition || condition.length < 3) {
    if (topic) {
      condition = topic.split(",")[0].trim();
    } else {
      condition = "high-risk clinical population";
    }
  }

  // Fallback 2: Intervention from KB match or question keywords
  if (!intervention || intervention.length < 3) {
    const searchTarget = `${q} ${topic}`.toLowerCase();
    for (const spec of Object.values(KB)) {
      for (const i of spec.interventions) {
        if (searchTarget.includes(i.toLowerCase())) {
          intervention = i;
          break;
        }
      }
      if (intervention) break;
    }
  }
  if (!intervention || intervention.length < 3) {
    if (topic && topic.includes(",")) {
      const parts = topic.split(",").map(p => p.trim());
      intervention = parts[1] || parts[0] || "evaluated clinical intervention";
    } else {
      intervention = "evaluated clinical intervention";
    }
  }

  // Fallback 3: Comparator
  if (!comparator || comparator.length < 2) {
    comparator = "standard care / placebo";
  }

  // Fallback 4: Outcome
  if (!outcome || outcome.length < 2) {
    const specKB = KB[specialty];
    outcome = specKB.outcomesRanked[0] || "primary clinical outcome";
  }

  // Guarantee condition does not contain comma-separated lists or mixed interventions
  if (condition.includes(",") || condition.split(/\s+/).length > 5) {
    const scenario = parseClinicalScenario(`${condition} ${topic}`);
    condition = scenario.population;
    if (!intervention || intervention === "evaluated clinical intervention") {
      intervention = scenario.intervention;
    }
    if (!comparator || comparator === "standard care / placebo") {
      comparator = scenario.comparator;
    }
  }

  // Clean formatted question
  const cleanQ = q.replace(/\s*\([PICO]\)/gi, "").trim();

  return {
    condition: condition.trim(),
    intervention: intervention.trim(),
    comparator: comparator.trim(),
    outcome: outcome.trim(),
    specialty,
    cleanQuestion: cleanQ || `In women with ${condition}, does ${intervention} compared with ${comparator} improve ${outcome}?`
  };
}
