/**
 * Deterministic PICO role classification and assignment for intake keywords.
 * Maps 3-5 clinical words or short phrases to Population, Intervention, Comparator, or Outcome.
 */

export type PicoRole = "population" | "intervention" | "comparator" | "outcome";

export interface PicoWord {
  word: string;
  role: PicoRole;
}

export type RoleConfidence = "high" | "medium" | "low";

interface MatchResult {
  role: PicoRole;
  confidence: RoleConfidence;
  weight: number;
}

const CONFIDENCE_WEIGHT: Record<RoleConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1
};

// Priority order on ties: population > intervention > comparator > outcome
const ROLE_TIE_PRIORITY: Record<PicoRole, number> = {
  population: 4,
  intervention: 3,
  comparator: 2,
  outcome: 1
};

// High-confidence exact phrases or strong keyword patterns
const OUTCOME_HIGH_RE = /\b(clinical pregnancy rate|live birth rate|cumulative live birth|miscarriage rate|preterm birth|preterm delivery|ovulation rate|implantation rate|oocyte yield|mature oocytes|cycle cancellation rate|adverse events?|health[- ]related quality of life|patient satisfaction|pain relief|blood loss reduction|neonatal morbidity|maternal mortality)\b/i;
const OUTCOME_MEDIUM_RE = /\b(rate|rates|risk|risks|birth|births|birthweight|mortality|morbidity|survival|pain|bleeding|efficacy|safety|adverse|outcome|outcomes|success|score|scores|yield|yields|incidence|recurrence|remission|duration|qol|relief|loss)\b/i;

const COMPARATOR_HIGH_RE = /\b(placebo|sham|no treatment|no intervention|usual care|standard care|standard protocol|expectant management|active surveillance|versus|vs\.?|compared with|compared to|comparison)\b/i;
const COMPARATOR_MEDIUM_RE = /\b(control|controls|control group|reference|comparator|standard|baseline)\b/i;

const INTERVENTION_HIGH_RE = /\b(in vitro fertilization|ivf|icsi|intracytoplasmic sperm injection|growth hormone|coenzyme q10|co enzyme q10|coq10|ubiquinol|letrozole|clomiphene|clomifene|metformin|aspirin|progesterone|dhea|dienogest|tamoxifen|gonadotropin|menopur|follitropin|magnesium sulfate|misoprostol|oxytocin|heparin|enoxaparin|cervical cerclage|cerclage|laparoscopy|laparoscopic|hysterectomy|embryo transfer|intrauterine insemination|iui|ablation|embolization)\b/i;
const INTERVENTION_MEDIUM_RE = /\b(therapy|therapies|agent|agents|surgery|surgeries|surgical|dose|dosing|mg|mcg|supplementation|administration|induction|insemination|injection|tablet|capsule|infusion|treatment|medication|drug|procedure)\b/i;

const POPULATION_HIGH_RE = /\b(poor responders?|poor ovarian response|diminished ovarian reserve|dor|thin endometrium|short cervix|cervical insufficiency|polycystic ovary syndrome|pcos|endometriosis|adenomyosis|preeclampsia|pre-eclampsia|uterine fibroids?|myoma|myomas|recurrent pregnancy loss|rpl|recurrent implantation failure|rif|unexplained infertility|male factor infertility|azoospermia|oligozoospermia|fetal growth restriction|fgr|iugr|gestational diabetes|gdm|placenta accreta spectrum|placenta previa|pprom|chorioamnionitis)\b/i;
const POPULATION_MEDIUM_RE = /\b(women|woman|patients?|participants?|subjects?|individuals?|responders?|pregnant|pregnancy|pregnancies|gravida|parity|menopause|menopaus|postmenopausal|nulliparous|multiparous|infants?|neonates?|fetal|fetus|maternal|syndrome|disorder|condition|disease|insufficiency|failure|cervix|ovary|ovarian|uterus|uterine|endometrium|endometrial|fallopian|tubal|cervical)\b/i;

/**
 * Classifies a single clinical word or short phrase into a PICO role with confidence.
 * Ties are resolved with priority: population > intervention > comparator > outcome.
 */
export function classifyWordRole(word: string): { role: PicoRole; confidence: RoleConfidence } {
  const clean = (word || "").trim();
  if (!clean) {
    return { role: "population", confidence: "low" };
  }

  const matches: MatchResult[] = [];

  // Check Outcome signals
  if (OUTCOME_HIGH_RE.test(clean)) {
    matches.push({ role: "outcome", confidence: "high", weight: CONFIDENCE_WEIGHT.high });
  } else if (OUTCOME_MEDIUM_RE.test(clean)) {
    matches.push({ role: "outcome", confidence: "medium", weight: CONFIDENCE_WEIGHT.medium });
  }

  // Check Comparator signals
  if (COMPARATOR_HIGH_RE.test(clean)) {
    matches.push({ role: "comparator", confidence: "high", weight: CONFIDENCE_WEIGHT.high });
  } else if (COMPARATOR_MEDIUM_RE.test(clean)) {
    matches.push({ role: "comparator", confidence: "medium", weight: CONFIDENCE_WEIGHT.medium });
  }

  // Check Intervention signals
  if (INTERVENTION_HIGH_RE.test(clean)) {
    matches.push({ role: "intervention", confidence: "high", weight: CONFIDENCE_WEIGHT.high });
  } else if (INTERVENTION_MEDIUM_RE.test(clean)) {
    matches.push({ role: "intervention", confidence: "medium", weight: CONFIDENCE_WEIGHT.medium });
  }

  // Check Population signals
  if (POPULATION_HIGH_RE.test(clean)) {
    matches.push({ role: "population", confidence: "high", weight: CONFIDENCE_WEIGHT.high });
  } else if (POPULATION_MEDIUM_RE.test(clean)) {
    matches.push({ role: "population", confidence: "medium", weight: CONFIDENCE_WEIGHT.medium });
  }

  // If no specific match, default bare clinical word to population with medium confidence if disease/anatomy-like, otherwise low
  if (matches.length === 0) {
    const isAnatomyOrDisease = /(itis|oma|osis|pathy|ia|ic|syndrome|cervix|ovari|uter|fetal)/i.test(clean);
    return {
      role: "population",
      confidence: isAnatomyOrDisease ? "medium" : "low"
    };
  }

  // Sort matches by confidence weight descending, then by tie-priority descending
  matches.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return ROLE_TIE_PRIORITY[b.role] - ROLE_TIE_PRIORITY[a.role];
  });

  const best = matches[0];
  return { role: best.role, confidence: best.confidence };
}

/**
 * Assigns PICO roles to an array of clinical words.
 * Enforces role diversity: if >= 4 words and every word received the identical role,
 * reclassifies the last word as outcome (low confidence) so downstream stages receive a plausible target outcome.
 */
export function assignPicoRoles(words: string[]): PicoWord[] {
  const result: PicoWord[] = words.map(w => {
    const { role } = classifyWordRole(w);
    return { word: w, role };
  });

  if (result.length >= 4) {
    const firstRole = result[0].role;
    const allSame = result.every(item => item.role === firstRole);
    if (allSame) {
      result[result.length - 1] = {
        word: result[result.length - 1].word,
        role: "outcome"
      };
    }
  }

  return result;
}
