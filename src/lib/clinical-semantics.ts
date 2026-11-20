import { KB, type SpecialtyKey } from "./kb.ts";
import { OUTCOME_ONTOLOGY } from "./outcome-ontology.ts";
import { deriveOutcomes, type DerivedOutcome } from "./outcome-derivation.ts";

export interface PicoSlots {
  population: string[];        // 0..n recognized population/condition phrases
  interventions: string[];     // 0..n canonical interventions
  comparators: string[];       // 0..n canonical comparators (explicit or implied)
  outcomes: string[];          // 0..n canonical outcomes stated by the clinician
  unresolved: string[];        // phrases that could not be classified — never silently dropped, never silently slotted
  cues: { comparative: string[]; directionVerbs: string[]; population?: string[] };  // evidence for the assignment decisions
}

export interface ParsedClinicalScenario {
  specialty: SpecialtyKey;
  population: string;
  intervention: string;
  comparator: string;
  outcomes: string[];
  suggestedQuestions: Array<{ question: string; rationale: string }>;
  unrecognizedTerms?: string[];
  comparisonOptions?: Array<{ label: string; intervention: string; comparator: string }>;
  clarificationRequired?: boolean;
  clarificationPrompt?: string;
  advisories?: string[];
  picoSlots?: PicoSlots;
  derivedOutcomes?: DerivedOutcome[];
}

export type OutcomeDirection = "adverse" | "desirable" | "neutral";

export interface OutcomeMetadata {
  label: string;
  direction: OutcomeDirection;
}

// Comprehensive clinical taxonomy for Obstetrics, Gynecology, and Infertility
interface MedicalTermEntry {
  canonical: string;
  category: "condition" | "intervention" | "comparator" | "outcome";
  specialty: SpecialtyKey;
  direction?: OutcomeDirection;
  synonyms: string[];
}

const MEDICAL_TAXONOMY: MedicalTermEntry[] = [
  // --- OBSTETRICS: Conditions ---
  {
    canonical: "short cervix",
    category: "condition",
    specialty: "obstetrics",
    synonyms: ["short cervix", "cervical length", "short cervical length", "cervical shortening", "transvaginal cervical length", "cervical length < 25 mm", "cervical length < 25mm"]
  },
  {
    canonical: "preterm birth risk",
    category: "condition",
    specialty: "obstetrics",
    synonyms: ["preterm labor", "preterm labour", "preterm delivery risk", "spontaneous preterm birth", "prior preterm birth", "preterm birth risk", "history of preterm birth"]
  },
  {
    canonical: "preeclampsia",
    category: "condition",
    specialty: "obstetrics",
    synonyms: ["pre-eclampsia", "eclampsia", "hypertensive disorder of pregnancy", "gestational hypertension", "preeclampsia", "preterm preeclampsia"]
  },
  {
    canonical: "gestational diabetes mellitus",
    category: "condition",
    specialty: "obstetrics",
    synonyms: ["gestational diabetes", "gdm", "hyperglycemia in pregnancy", "hyperglycaemia in pregnancy", "gestational diabetes mellitus"]
  },
  {
    canonical: "cervical insufficiency",
    category: "condition",
    specialty: "obstetrics",
    synonyms: ["cervical incompetence", "incompetent cervix", "cervical insufficiency", "cervical weakness"]
  },
  {
    canonical: "fetal growth restriction",
    category: "condition",
    specialty: "obstetrics",
    synonyms: ["intrauterine growth restriction", "fgr", "iugr", "small for gestational age", "sga", "fetal growth restriction", "growth restricted fetus"]
  },
  {
    canonical: "placenta previa",
    category: "condition",
    specialty: "obstetrics",
    synonyms: ["low-lying placenta", "placental previa", "placenta previa"]
  },
  {
    canonical: "placenta accreta spectrum",
    category: "condition",
    specialty: "obstetrics",
    synonyms: ["accreta", "increta", "percreta", "pas", "placenta accreta spectrum", "abnormally invasive placenta"]
  },
  {
    canonical: "preterm premature rupture of membranes",
    category: "condition",
    specialty: "obstetrics",
    synonyms: ["pprom", "premature rupture of membranes", "preterm premature rupture of membranes", "prom"]
  },
  {
    canonical: "twin pregnancy",
    category: "condition",
    specialty: "obstetrics",
    synonyms: ["multiple gestation", "twin gestation", "dichorionic twins", "monochorionic twins", "twin pregnancy", "multiple pregnancy"]
  },
  {
    canonical: "postpartum hemorrhage",
    category: "condition",
    specialty: "obstetrics",
    synonyms: ["post-partum hemorrhage", "pph", "obstetric hemorrhage", "postpartum hemorrhage", "uterine atony"]
  },

  // --- OBSTETRICS: Interventions / Comparators ---
  {
    canonical: "vaginal progesterone",
    category: "intervention",
    specialty: "obstetrics",
    synonyms: ["vaginal progesterone", "progesterone", "micronized progesterone", "vaginal progesterone suppositories", "prometrium", "vaginal progesterone gel", "natural progesterone"]
  },
  {
    canonical: "cervical cerclage",
    category: "intervention",
    specialty: "obstetrics",
    synonyms: ["cervical cerclage", "cerclage", "mcdonald cerclage", "shirodkar cerclage", "transabdominal cerclage", "emergency cerclage", "history-indicated cerclage"]
  },
  {
    canonical: "cervical pessary",
    category: "intervention",
    specialty: "obstetrics",
    synonyms: ["cervical pessary", "pessary", "arabin pessary", "arabine pessary"]
  },
  {
    canonical: "low-dose aspirin",
    category: "intervention",
    specialty: "obstetrics",
    synonyms: ["low-dose aspirin", "aspirin", "acetylsalicylic acid", "asa", "low dose aspirin", "baby aspirin"]
  },
  {
    canonical: "antenatal corticosteroids",
    category: "intervention",
    specialty: "obstetrics",
    synonyms: ["antenatal corticosteroids", "corticosteroids", "betamethasone", "dexamethasone", "antenatal steroids", "steroid course"]
  },
  {
    canonical: "magnesium sulfate",
    category: "intervention",
    specialty: "obstetrics",
    synonyms: ["magnesium sulfate", "magnesium sulphate", "mgso4", "neuroprotective magnesium", "intravenous magnesium"]
  },
  {
    canonical: "calcium supplementation",
    category: "intervention",
    specialty: "obstetrics",
    synonyms: ["calcium supplementation", "calcium", "dietary calcium", "calcium carbonate"]
  },
  {
    canonical: "low molecular weight heparin",
    category: "intervention",
    specialty: "obstetrics",
    synonyms: ["low molecular weight heparin", "lmwh", "enoxaparin", "dalteparin", "heparin"]
  },
  {
    canonical: "metformin",
    category: "intervention",
    specialty: "obstetrics",
    synonyms: ["metformin", "glucophage"]
  },
  {
    canonical: "insulin therapy",
    category: "intervention",
    specialty: "obstetrics",
    synonyms: ["insulin", "insulin therapy", "basal insulin", "prandial insulin"]
  },

  // --- GYNECOLOGY: Conditions ---
  {
    canonical: "endometriosis",
    category: "condition",
    specialty: "gynecology",
    synonyms: ["endometriosis", "endometrioma", "ovarian endometrioma", "deep infiltrating endometriosis", "peritoneal endometriosis", "die"]
  },
  {
    canonical: "uterine fibroids",
    category: "condition",
    specialty: "gynecology",
    synonyms: ["uterine fibroids", "fibroids", "leiomyoma", "uterine leiomyoma", "myoma", "myomas"]
  },
  {
    canonical: "heavy menstrual bleeding",
    category: "condition",
    specialty: "gynecology",
    synonyms: ["heavy menstrual bleeding", "menorrhagia", "abnormal uterine bleeding", "aub", "hmb", "excessive bleeding"]
  },
  {
    canonical: "adenomyosis",
    category: "condition",
    specialty: "gynecology",
    synonyms: ["adenomyosis", "diffuse adenomyosis", "focal adenomyosis", "adenomyoma"]
  },
  {
    canonical: "chronic pelvic pain",
    category: "condition",
    specialty: "gynecology",
    synonyms: ["chronic pelvic pain", "pelvic pain", "dysmenorrhea", "painful periods", "dyspareunia"]
  },
  {
    canonical: "endometrial hyperplasia",
    category: "condition",
    specialty: "gynecology",
    synonyms: ["endometrial hyperplasia", "endometrial intraepithelial neoplasia", "ein", "atypical hyperplasia"]
  },
  {
    canonical: "pelvic organ prolapse",
    category: "condition",
    specialty: "gynecology",
    synonyms: ["pelvic organ prolapse", "prolapse", "cystocele", "rectocele", "uterine prolapse", "vaginal vault prolapse"]
  },

  // --- GYNECOLOGY: Interventions / Comparators ---
  {
    canonical: "laparoscopic surgery",
    category: "intervention",
    specialty: "gynecology",
    synonyms: ["laparoscopic surgery", "laparoscopy", "laparoscopic excision", "laparoscopic cystectomy", "laparoscopic ablation", "minimally invasive surgery"]
  },
  {
    canonical: "dienogest",
    category: "intervention",
    specialty: "gynecology",
    synonyms: ["dienogest", "visanne", "progestin therapy", "dienogest therapy"]
  },
  {
    canonical: "myomectomy",
    category: "intervention",
    specialty: "gynecology",
    synonyms: ["myomectomy", "laparoscopic myomectomy", "hysteroscopic myomectomy", "abdominal myomectomy"]
  },
  {
    canonical: "uterine artery embolization",
    category: "intervention",
    specialty: "gynecology",
    synonyms: ["uterine artery embolization", "uae", "ufe", "uterine fibroid embolization"]
  },
  {
    canonical: "levonorgestrel-releasing intrauterine system",
    category: "intervention",
    specialty: "gynecology",
    synonyms: ["levonorgestrel-releasing intrauterine system", "lng-ius", "mirena", "levonorgestrel ius", "progestin iud", "hormonal iud"]
  },
  {
    canonical: "tranexamic acid",
    category: "intervention",
    specialty: "gynecology",
    synonyms: ["tranexamic acid", "txa", "cyklokapron", "antifibrinolytic therapy"]
  },
  {
    canonical: "GnRH agonists",
    category: "intervention",
    specialty: "gynecology",
    synonyms: ["gnrh agonists", "leuprolide", "gnrh agonist", "goserelin", "zoladex", "lupron"]
  },
  {
    canonical: "GnRH antagonists",
    category: "intervention",
    specialty: "gynecology",
    synonyms: ["gnrh antagonists", "relugolix", "elagolix", "linzagolix", "gnrh antagonist"]
  },
  {
    canonical: "combined oral contraceptives",
    category: "intervention",
    specialty: "gynecology",
    synonyms: ["combined oral contraceptives", "coc", "birth control pill", "oral contraceptive pill", "ocp"]
  },

  // --- INFERTILITY: Conditions ---
  {
    canonical: "polycystic ovary syndrome",
    category: "condition",
    specialty: "infertility",
    synonyms: ["polycystic ovary syndrome", "pcos", "polycystic ovaries", "anovulatory infertility", "anovulation"]
  },
  {
    canonical: "unexplained infertility",
    category: "condition",
    specialty: "infertility",
    synonyms: ["unexplained infertility", "unexplained subfertility", "idiopathic infertility"]
  },
  {
    canonical: "recurrent implantation failure",
    category: "condition",
    specialty: "infertility",
    synonyms: ["recurrent implantation failure", "rif", "implantation failure", "recurrent failure"]
  },
  {
    canonical: "diminished ovarian reserve",
    category: "condition",
    specialty: "infertility",
    synonyms: ["diminished ovarian reserve", "dor", "low amh", "elevated fsh", "low antral follicle count", "decreased ovarian reserve"]
  },
  {
    canonical: "poor ovarian response",
    category: "condition",
    specialty: "infertility",
    synonyms: [
      "poor ovarian response", "poor responders", "poor responder",
      "poor ovarian responders", "low ovarian response", "por",
      "bologna criteria", "poseidon criteria", "poor ovarian reserve",
      "expected poor responders"
    ]
  },
  {
    canonical: "thin endometrium",
    category: "condition",
    specialty: "infertility",
    synonyms: ["thin endometrium", "refractory thin lining", "unresponsive endometrium", "thin endometrial lining"]
  },
  {
    canonical: "male factor infertility",
    category: "condition",
    specialty: "infertility",
    synonyms: ["male factor infertility", "oligozoospermia", "asthenozoospermia", "teratozoospermia", "azoospermia", "male subfertility"]
  },
  {
    canonical: "recurrent pregnancy loss",
    category: "condition",
    specialty: "infertility",
    synonyms: ["recurrent pregnancy loss", "rpl", "recurrent miscarriage", "habitual abortion"]
  },

  // --- INFERTILITY: Interventions / Comparators ---
  {
    canonical: "growth hormone",
    category: "intervention",
    specialty: "infertility",
    synonyms: [
      "growth hormone", "gh", "somatotropin", "growth hormone adjuvant",
      "gh co-treatment", "growth hormone supplementation", "growth hormone co-treatment",
      "adjuvant growth hormone"
    ]
  },
  {
    canonical: "coenzyme Q10",
    category: "intervention",
    specialty: "infertility",
    synonyms: [
      "coenzyme q10", "co enzyme q10", "co-enzyme q10", "coq10",
      "ubiquinol", "ubiquinone", "coenzyme q10 supplementation", "co enzyme q 10",
      "co enzyem q 10", "co enzyem q10"
    ]
  },
  {
    canonical: "dehydroepiandrosterone",
    category: "intervention",
    specialty: "infertility",
    synonyms: ["dehydroepiandrosterone", "dhea", "dhea supplementation", "dhea adjuvant"]
  },
  {
    canonical: "melatonin",
    category: "intervention",
    specialty: "infertility",
    synonyms: ["melatonin", "melatonin supplementation", "melatonin adjuvant"]
  },
  {
    canonical: "myo-inositol",
    category: "intervention",
    specialty: "infertility",
    synonyms: ["myo-inositol", "inositol", "myoinositol", "d-chiro-inositol"]
  },
  {
    canonical: "letrozole",
    category: "intervention",
    specialty: "infertility",
    synonyms: ["letrozole", "femara", "aromatase inhibitor", "letrozole therapy"]
  },
  {
    canonical: "clomiphene citrate",
    category: "intervention",
    specialty: "infertility",
    synonyms: ["clomiphene citrate", "clomid", "clomifene", "clomiphene"]
  },
  {
    canonical: "in vitro fertilization",
    category: "intervention",
    specialty: "infertility",
    synonyms: ["in vitro fertilization", "ivf", "art", "assisted reproductive technology"]
  },
  {
    canonical: "intrauterine insemination",
    category: "intervention",
    specialty: "infertility",
    synonyms: ["intrauterine insemination", "iui", "artificial insemination"]
  },
  {
    canonical: "intracytoplasmic sperm injection",
    category: "intervention",
    specialty: "infertility",
    synonyms: ["intracytoplasmic sperm injection", "icsi"]
  },

  // --- OUTCOMES ---
  {
    canonical: "spontaneous preterm birth before 34 weeks",
    category: "outcome",
    specialty: "obstetrics",
    direction: "adverse",
    synonyms: ["spontaneous preterm birth before 34 weeks", "preterm birth before 34 weeks", "preterm birth < 34 weeks", "preterm delivery", "early preterm birth", "delivery before 34 weeks", "preterm birth"]
  },
  {
    canonical: "gestational age at delivery",
    category: "outcome",
    specialty: "obstetrics",
    direction: "desirable",
    synonyms: ["gestational age at delivery", "gestational age", "gestation length", "prolongation of pregnancy"]
  },
  {
    canonical: "composite neonatal morbidity and mortality",
    category: "outcome",
    specialty: "obstetrics",
    direction: "adverse",
    synonyms: ["composite neonatal morbidity and mortality", "neonatal morbidity", "neonatal outcomes", "perinatal mortality", "nicu admission", "respiratory distress syndrome"]
  },
  {
    canonical: "cervical length maintenance",
    category: "outcome",
    specialty: "obstetrics",
    direction: "desirable",
    synonyms: ["cervical length maintenance", "cervical length", "prevention of cervical shortening", "cervical length stability"]
  },
  {
    canonical: "preterm preeclampsia rate",
    category: "outcome",
    specialty: "obstetrics",
    direction: "adverse",
    synonyms: ["preterm preeclampsia rate", "preterm preeclampsia", "early-onset preeclampsia", "preeclampsia incidence"]
  },
  {
    canonical: "pelvic pain reduction",
    category: "outcome",
    specialty: "gynecology",
    direction: "desirable",
    synonyms: ["pelvic pain reduction", "pelvic pain", "pain", "pain relief", "dysmenorrhea relief", "reduction in pelvic pain", "vas pain score", "pain reduction", "symptom relief"]
  },
  {
    canonical: "preservation of ovarian reserve",
    category: "outcome",
    specialty: "gynecology",
    direction: "desirable",
    synonyms: ["preservation of ovarian reserve", "ovarian reserve", "amh levels", "anti-mullerian hormone", "antral follicle count", "amh"]
  },
  {
    canonical: "menstrual blood loss reduction",
    category: "outcome",
    specialty: "gynecology",
    direction: "desirable",
    synonyms: ["menstrual blood loss reduction", "menstrual bleeding", "bleeding", "blood loss", "reduction in bleeding", "bleeding cessation", "hemoglobin level", "pictus score"]
  },
  {
    canonical: "health-related quality of life",
    category: "outcome",
    specialty: "gynecology",
    direction: "desirable",
    synonyms: [
      "health-related quality of life", "quality of life", "qol", "patient satisfaction",
      "patient-reported quality of life", "patient-reported quality of life and treatment satisfaction",
      "treatment satisfaction", "ephq-30"
    ]
  },
  {
    canonical: "disease recurrence rate",
    category: "outcome",
    specialty: "gynecology",
    direction: "adverse",
    synonyms: ["disease recurrence rate", "recurrence", "recurrent endometrioma", "repeat surgery", "reoperation rate"]
  },
  {
    canonical: "cumulative live birth rate",
    category: "outcome",
    specialty: "infertility",
    direction: "desirable",
    synonyms: ["cumulative live birth rate", "clbr", "cumulative live birth"]
  },
  {
    canonical: "live birth rate",
    category: "outcome",
    specialty: "infertility",
    direction: "desirable",
    synonyms: ["live birth rate", "live birth", "lbr", "live birth rate per cycle"]
  },
  {
    canonical: "ongoing pregnancy rate",
    category: "outcome",
    specialty: "infertility",
    direction: "desirable",
    synonyms: ["ongoing pregnancy rate", "ongoing pregnancy", "opr"]
  },
  {
    canonical: "ovulation rate",
    category: "outcome",
    specialty: "infertility",
    direction: "desirable",
    synonyms: ["ovulation rate", "ovulation", "ovulatory cycles", "mono-ovulation rate"]
  },
  {
    canonical: "clinical pregnancy rate",
    category: "outcome",
    specialty: "infertility",
    direction: "desirable",
    synonyms: ["clinical pregnancy rate", "pregnancy rate", "implantation rate"]
  },
  {
    canonical: "miscarriage rate",
    category: "outcome",
    specialty: "infertility",
    direction: "adverse",
    synonyms: ["miscarriage rate", "miscarriage", "early pregnancy loss", "spontaneous abortion"]
  },
  {
    canonical: "oocyte yield",
    category: "outcome",
    specialty: "infertility",
    direction: "desirable",
    synonyms: ["oocyte yield", "number of oocytes retrieved", "retrieved oocytes", "mature oocytes", "mII oocytes", "metaphase II oocytes", "oocytes"]
  },
  {
    canonical: "fertilization rate",
    category: "outcome",
    specialty: "infertility",
    direction: "desirable",
    synonyms: ["fertilization rate", "fertilisation rate", "2pn rate", "normal fertilization rate"]
  },
  {
    canonical: "cycle cancellation rate",
    category: "outcome",
    specialty: "infertility",
    direction: "adverse",
    synonyms: ["cycle cancellation rate", "cycle cancellation", "cancellation rate"]
  },
  {
    canonical: "ovarian hyperstimulation syndrome",
    category: "outcome",
    specialty: "infertility",
    direction: "adverse",
    synonyms: ["ovarian hyperstimulation syndrome", "ohss", "severe ohss", "moderate to severe ohss"]
  }
];

function cleanTokenString(s: string): string {
  return s.trim().replace(/^[\s,;:-]+|[\s,;:-]+$/g, "").replace(/\s+/g, " ");
}

const PRESERVED_ACRONYMS = new Set([
  "IVF", "ICSI", "IUI", "OHSS", "PCOS", "AMH", "GNRH", "GnRH", "COQ10", "CoQ10",
  "LBR", "CLBR", "CPR", "NICU", "PGT-A", "PGTA", "GDM", "PTB", "PPROM", "PAS",
  "FGR", "SGA", "LGA", "HMB", "LNG-IUS", "UAE", "DHEA", "G-CSF", "DNA", "RNA"
]);

/**
 * Normalization aliases for common clinical misspellings and abbreviation forms.
 */
export const CLINICAL_ALIASES: Record<string, string> = {
  "co enzyem q 10": "coenzyme Q10",
  "co enzyem q10": "coenzyme Q10",
  "co enzyme q 10": "coenzyme Q10",
  "co enzyme q10": "coenzyme Q10",
  "co-enzyme q 10": "coenzyme Q10",
  "co-enzyme q10": "coenzyme Q10",
  "coq 10": "coenzyme Q10",
  "coq10": "coenzyme Q10",
  "ubiquinol": "coenzyme Q10",
  "ubiquinone": "coenzyme Q10",
  "growth hormon": "growth hormone",
  "growth-hormone": "growth hormone",
  "somatotropine": "growth hormone",
  "clomiphene": "clomiphene citrate",
  "letrozol": "letrozole",
  "progesteron": "progesterone",
  "por": "poor ovarian response",
  "dor": "diminished ovarian reserve",
  "pcos": "polycystic ovary syndrome",
  "gdm": "gestational diabetes mellitus",
  "pph": "postpartum hemorrhage"
};

/**
 * Computes Levenshtein distance between two normalized strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

/**
 * Check whether an intervention is an adjuvant / add-on pharmacotherapy.
 */
export function isAdjuvantIntervention(name: string): boolean {
  return /growth hormone|somatotropin|coenzyme|coq10|dhea|prp|platelet-rich|antioxidant|inositol|myo-inositol|melatonin|supplement|adjuvant|vitamin\s*[de]/i.test(name);
}

/**
 * Resolves a candidate outcome string against MEDICAL_TAXONOMY, OUTCOME_ONTOLOGY, and KB.
 * Rejects terms that represent interventions or conditions.
 */
export function resolveKnownOutcome(outcomeStr: string): {
  valid: boolean;
  canonical: string;
  direction: OutcomeDirection;
  category?: string;
} | null {
  if (!outcomeStr || typeof outcomeStr !== "string") return null;
  const raw = outcomeStr.trim();
  const lower = raw.toLowerCase().replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();
  if (lower.length < 2) return null;

  // 1. Reject if the term is known to be an INTERVENTION or CONDITION
  const normalizedAlias = CLINICAL_ALIASES[lower] || lower;
  const isIntervention = MEDICAL_TAXONOMY.some(
    m => m.category === "intervention" && (
      m.canonical.toLowerCase() === lower ||
      m.canonical.toLowerCase() === normalizedAlias.toLowerCase() ||
      m.synonyms.some(s => s.toLowerCase() === lower || s.toLowerCase() === normalizedAlias.toLowerCase())
    )
  );
  if (isIntervention) return null;

  const isCondition = MEDICAL_TAXONOMY.some(
    m => m.category === "condition" && (
      m.canonical.toLowerCase() === lower ||
      m.canonical.toLowerCase() === normalizedAlias.toLowerCase() ||
      m.synonyms.some(s => s.toLowerCase() === lower || s.toLowerCase() === normalizedAlias.toLowerCase())
    )
  );
  if (isCondition) return null;

  if (/^(growth hormone|somatotropin|coenzyme|coq10|dhea|melatonin|letrozole|clomiphene|aspirin|heparin|metformin|insulin|progesterone|cerclage|pessary|dienogest|myomectomy)\b/i.test(lower)) {
    return null;
  }

  // 2. Exact or synonym match in MEDICAL_TAXONOMY category "outcome"
  const taxMatch = MEDICAL_TAXONOMY.find(
    m => m.category === "outcome" && (
      m.canonical.toLowerCase() === lower ||
      m.synonyms.some(s => s.toLowerCase() === lower || s.toLowerCase() === lower + "s" || lower === s.toLowerCase() + "s")
    )
  );
  if (taxMatch) {
    return {
      valid: true,
      canonical: taxMatch.canonical,
      direction: taxMatch.direction || getOutcomeDirection(taxMatch.canonical),
      category: "clinical"
    };
  }

  // 3. Match in OUTCOME_ONTOLOGY
  const ontMatch = OUTCOME_ONTOLOGY.find(o => {
    const l = o.label.toLowerCase();
    const sl = o.shortLabel.toLowerCase();
    return l === lower || sl === lower || o.keywords.some(k => k.toLowerCase() === lower);
  });
  if (ontMatch) {
    return {
      valid: true,
      canonical: ontMatch.label,
      direction: getOutcomeDirection(ontMatch.label),
      category: ontMatch.category
    };
  }

  // 4. Match in KB outcomesRanked
  for (const spec of Object.values(KB)) {
    const kbMatch = spec.outcomesRanked.find(o => o.toLowerCase() === lower || lower.includes(o.toLowerCase()));
    if (kbMatch) {
      return {
        valid: true,
        canonical: kbMatch,
        direction: getOutcomeDirection(kbMatch),
        category: "clinical"
      };
    }
  }

  // 5. Generic clinical outcome keywords
  if (
    /^(live birth|clinical pregnancy|ongoing pregnancy|miscarriage|preterm birth|fetal growth|preeclampsia|pain relief|blood loss|implantation rate|fertilization rate|ovarian reserve|oocyte yield|blastocyst)/i.test(lower)
  ) {
    return {
      valid: true,
      canonical: raw,
      direction: getOutcomeDirection(raw),
      category: "clinical"
    };
  }

  // 6. Fuzzy match on taxonomy outcome synonyms (Levenshtein <= 2 for length >= 6)
  if (lower.length >= 6) {
    for (const entry of MEDICAL_TAXONOMY) {
      if (entry.category !== "outcome") continue;
      for (const syn of entry.synonyms) {
        if (Math.abs(syn.length - lower.length) <= 2) {
          const dist = levenshteinDistance(lower, syn.toLowerCase());
          if (dist <= 2) {
            return {
              valid: true,
              canonical: entry.canonical,
              direction: entry.direction || getOutcomeDirection(entry.canonical),
              category: "clinical"
            };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Deduplicate outcomes using Jaccard token overlap (threshold > 0.7), retaining the more specific outcome.
 * Preserves the first `preserveFirstN` outcomes (user-matched) so default ontology items do not displace them.
 */
export function dedupeOutcomes(outcomes: string[], preserveFirstN = 0): string[] {
  const result: string[] = [];
  for (let idx = 0; idx < outcomes.length; idx++) {
    const outcome = outcomes[idx];
    const trimmed = outcome.trim();
    if (!trimmed) continue;
    const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
    let isDupe = false;
    for (let i = 0; i < result.length; i++) {
      const existing = result[i];
      const existingTokens = existing.toLowerCase().split(/\s+/).filter(Boolean);
      const intersection = tokens.filter(t => existingTokens.includes(t));
      const union = new Set([...tokens, ...existingTokens]);
      const jaccard = union.size > 0 ? intersection.length / union.size : 0;
      if (jaccard > 0.7) {
        isDupe = true;
        // If existing is user-matched (i < preserveFirstN), do not overwrite with default
        if (i < preserveFirstN) {
          break;
        }
        // If current is user-matched (idx < preserveFirstN), it takes precedence over default
        if (idx < preserveFirstN) {
          result[i] = trimmed;
          break;
        }
        // Otherwise, keep the more specific one
        if (tokens.length > existingTokens.length || (tokens.length === existingTokens.length && trimmed.length > existing.length)) {
          result[i] = trimmed;
        }
        break;
      }
    }
    if (!isDupe) {
      result.push(trimmed);
    }
  }
  return result;
}

/**
 * Build dynamic, calibrated rationales based on resolved outcome direction and category.
 */
export function buildDynamicRationale(
  intervention: string,
  comparator: string,
  outcome: string,
  verbType: "primary" | "secondary" | "subgroup" | "qol"
): string {
  const resolved = resolveKnownOutcome(outcome);
  const dir = resolved?.direction || getOutcomeDirection(outcome);
  const cat = resolved?.category;

  if (verbType === "qol" || cat === "quality-of-life" || /quality of life|satisfaction|qol/i.test(outcome)) {
    return `Evaluates patient-centered outcomes, treatment burden, and ${outcome}.`;
  }
  if (dir === "adverse" || cat === "safety" || /complication|adverse|risk|loss|death|bleeding|pain|ohss|nicu/i.test(outcome)) {
    return `Evaluates whether ${intervention} compared with ${comparator} reduces the risk of ${outcome}.`;
  }
  if (verbType === "primary" || cat === "patient-important") {
    return `Evaluates the primary therapeutic efficacy of ${intervention} versus ${comparator} on ${outcome}.`;
  }
  return `Assesses secondary clinical outcomes and comparative effectiveness of ${intervention} versus ${comparator} on ${outcome}.`;
}

/**
 * Matches a candidate token or multi-word phrase against MEDICAL_TAXONOMY and CLINICAL_ALIASES.
 */
function matchTaxonomyTerm(candidate: string): {
  entry: MedicalTermEntry;
  matchedSynonym: string;
} | null {
  const normalized = candidate.trim().toLowerCase().replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length < 2) return null;

  // 1. Alias lookup
  const aliasTarget = CLINICAL_ALIASES[normalized];
  if (aliasTarget) {
    const entry = MEDICAL_TAXONOMY.find(m => m.canonical.toLowerCase() === aliasTarget.toLowerCase());
    if (entry) return { entry, matchedSynonym: candidate };
  }

  // 2. Exact match against canonical or synonyms
  for (const entry of MEDICAL_TAXONOMY) {
    if (entry.canonical.toLowerCase() === normalized) {
      return { entry, matchedSynonym: candidate };
    }
    for (const syn of entry.synonyms) {
      const s = syn.toLowerCase();
      if (s === normalized || s + "s" === normalized || s === normalized + "s") {
        return { entry, matchedSynonym: candidate };
      }
    }
  }

  // 3. Fuzzy match (length >= 6, Levenshtein <= 2)
  if (normalized.length >= 6) {
    for (const entry of MEDICAL_TAXONOMY) {
      for (const syn of entry.synonyms) {
        if (Math.abs(syn.length - normalized.length) <= 2) {
          if (levenshteinDistance(normalized, syn.toLowerCase()) <= 2) {
            return { entry, matchedSynonym: candidate };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Lowercase the first letter of inserted phrases while preserving medical acronyms.
 */
export function toInlineCase(str: string): string {
  if (!str) return "";
  const trimmed = str.trim();
  if (!trimmed) return "";

  const match = trimmed.match(/^([A-Za-z0-9\-]+)([\s\S]*)$/);
  if (!match) return trimmed;
  const firstWord = match[1];
  const rest = match[2];

  if (
    PRESERVED_ACRONYMS.has(firstWord) ||
    /^[A-Z0-9]{2,}$/.test(firstWord) ||
    /^GnRH/i.test(firstWord) ||
    /^CoQ10/i.test(firstWord)
  ) {
    return trimmed;
  }

  return firstWord.charAt(0).toLowerCase() + firstWord.slice(1) + rest;
}

/**
 * Determine whether an outcome represents an adverse event (to reduce),
 * a time-to-event outcome (to shorten), or a desirable outcome (to improve/increase/preserve).
 */
export function getOutcomeDirection(outcomeText: string): OutcomeDirection {
  const lower = outcomeText.toLowerCase();
  if (/^time to\b/i.test(lower) || /\btime to (pregnancy|conception|delivery)\b/i.test(lower)) {
    return "time" as OutcomeDirection;
  }
  const found = MEDICAL_TAXONOMY.find(
    m => m.category === "outcome" && (m.canonical.toLowerCase() === lower || m.synonyms.some(s => s.toLowerCase() === lower))
  );
  if (found?.direction) return found.direction;

  if (
    /mortality|morbidity|loss|miscarriage|preterm birth|complication|recurrence|adverse|admission|failure|death|bleeding|pain|cesarean|nicu|ohss|hyperstimulation|cancellation/i.test(lower) &&
    !/relief|reduction|cessation|preservation|maintenance|quality/i.test(lower)
  ) {
    return "adverse";
  }
  return "desirable";
}

/**
 * Formulate a clinically grammatical verb phrase for an outcome.
 * Validates the outcome argument and returns null if the string cannot be validated as an outcome.
 */
export function formulateOutcomeVerbPhrase(verbType: "primary" | "secondary" | "subgroup", outcome: string): string | null {
  if (!outcome || typeof outcome !== "string") return null;
  const resolved = resolveKnownOutcome(outcome);
  if (!resolved || !resolved.valid) return null;

  const dir = resolved.direction;
  const cleanOutcome = outcome.trim();
  const inlineOutcome = toInlineCase(cleanOutcome);

  // Time-to-event outcomes
  if (/^time to /i.test(cleanOutcome) || (dir as string) === "time") {
    return verbType === "primary" ? `shorten the ${inlineOutcome}` : `shorten ${inlineOutcome}`;
  }

  // If the outcome already contains active action nouns
  if (/^reduction in /i.test(cleanOutcome) || / reduction$/i.test(cleanOutcome)) {
    return verbType === "primary" ? `achieve greater ${inlineOutcome}` : `lead to significant ${inlineOutcome}`;
  }
  if (/^preservation of /i.test(cleanOutcome) || / preservation$/i.test(cleanOutcome)) {
    return verbType === "primary" ? `enhance ${inlineOutcome}` : `support optimal ${inlineOutcome}`;
  }
  if (/^prevention of /i.test(cleanOutcome) || / prevention$/i.test(cleanOutcome)) {
    return verbType === "primary" ? `improve ${inlineOutcome}` : `support ${inlineOutcome}`;
  }

  if (/rate$/i.test(cleanOutcome)) {
    const base = cleanOutcome.replace(/\s+rate$/i, "");
    const inlineBase = toInlineCase(base);
    if (dir === "adverse") {
      switch (verbType) {
        case "primary":
          return `reduce the rate of ${inlineBase}`;
        case "secondary":
          return `decrease the incidence of ${inlineBase}`;
        case "subgroup":
          return `lower the rate of ${inlineBase}`;
      }
    } else {
      switch (verbType) {
        case "primary":
          return `improve the ${inlineOutcome}`;
        case "secondary":
          return `increase the ${inlineOutcome}`;
        case "subgroup":
          return `optimize the ${inlineOutcome}`;
      }
    }
  }

  if (dir === "adverse") {
    switch (verbType) {
      case "primary":
        return `reduce the risk of ${inlineOutcome}`;
      case "secondary":
        return `decrease the incidence of ${inlineOutcome}`;
      case "subgroup":
        return `lower the occurrence of ${inlineOutcome}`;
    }
  } else {
    switch (verbType) {
      case "primary":
        return `improve ${inlineOutcome}`;
      case "secondary":
        return `increase ${inlineOutcome}`;
      case "subgroup":
        return `optimize ${inlineOutcome}`;
    }
  }
}

/**
 * Formulate clinical population noun phrase (e.g. "women with endometriosis", "pregnant women with short cervix")
 */
function formulatePopulationPhrase(population: string, specialty: SpecialtyKey): string {
  const p = population.trim();
  const lower = p.toLowerCase();

  if (/^(women|patients|individuals|pregnant individuals|pregnant women|couples)/i.test(lower)) {
    return p;
  }
  if (/undergoing\s+(ivf|icsi|art|assisted reproductive|iui)/i.test(lower)) {
    if (/^poor\s+(ovarian\s+)?responders?/i.test(p)) {
      return p;
    }
    return `women with ${p}`;
  }
  if (/^poor\s+(ovarian\s+)?responders?$/i.test(lower)) {
    return `poor responders undergoing IVF`;
  }
  if (specialty === "obstetrics") {
    if (/pregnancy|twin|gestation|gravida|labor|labour/i.test(lower)) {
      return `pregnant women with ${p}`;
    }
    return `pregnant women diagnosed with ${p}`;
  }
  if (specialty === "infertility") {
    if (/infertil|response|reserve|failure|loss|pcos|azoospermia|oligozoospermia/i.test(lower)) {
      return `women with ${p}`;
    }
    return `women presenting with ${p}`;
  }
  return `women with ${p}`;
}

/**
 * Parses clinical input into distinct, non-overlapping PICO roles:
 * - Population / Clinical Problem (P)
 * - Intervention (I)
 * - Comparator (C)
 * - Candidate Outcomes (O)
 */
const COMPARATIVE_PATTERN = /\b(versus|vs\.?|compared with|compared to|against|instead of)\b/i;

const STOPWORDS = new Set([
  "in", "for", "among", "with", "does", "is", "do", "what", "are", "the", "a", "an", "of", "and", "or", "to", "on",
  "effect", "effects", "impact", "between", "associated", "when", "as", "by", "from", "at", "women", "patients",
  "pregnant", "individuals", "undergoing", "diagnosed", "aged", "rate", "rates", "setting", "trial", "trials"
]);

/**
 * Extracts distinct PICO slots from clinical input:
 * - Population / Clinical Problem (P)
 * - Interventions (I)
 * - Comparators (C)
 * - Outcomes (O)
 * - Unresolved terms
 */
export function extractPicoSlots(rawInput: string): PicoSlots {
  const cleanInput = (rawInput || "").trim();
  if (!cleanInput) {
    return {
      population: [],
      interventions: [],
      comparators: [],
      outcomes: [],
      unresolved: [],
      cues: { comparative: [], directionVerbs: [] }
    };
  }

  const comparativeCues: string[] = [];
  const directionVerbs: string[] = [];
  const populationCues: string[] = [];

  const compMatches = cleanInput.match(/\b(versus|vs\.?|compared with|compared to|against|instead of)\b/gi);
  if (compMatches) {
    for (const m of compMatches) {
      const lower = m.toLowerCase();
      if (!comparativeCues.includes(lower)) comparativeCues.push(lower);
    }
  }

  const verbMatches = cleanInput.match(/\b(improve|improves|improving|increase|increases|increasing|reduce|reduces|reducing|lower|lowers|lowering|raise|raises|raising|enhance|enhances|enhancing|shorten|shortens|shortening|prevent|prevents|preventing)\b/gi);
  if (verbMatches) {
    for (const m of verbMatches) {
      const lower = m.toLowerCase();
      if (!directionVerbs.includes(lower)) directionVerbs.push(lower);
    }
  }

  const popMatches = cleanInput.match(/\b(pregnant\s+(?:women|individuals|patients)(?:\s+(?:with|diagnosed\s+with))?|(?:women|patients|individuals)\s+(?:with|diagnosed\s+with)|aged\s+\d+|undergoing\s+(?:ivf|icsi|art))\b/gi);
  if (popMatches) {
    for (const m of popMatches) {
      const lower = m.toLowerCase().trim();
      if (!populationCues.includes(lower)) populationCues.push(lower);
    }
  }

  const population: string[] = [];
  const interventions: string[] = [];
  const comparators: string[] = [];
  const outcomes: string[] = [];
  const unresolved: string[] = [];

  const addUnique = (arr: string[], item: string) => {
    if (item && !arr.includes(item)) arr.push(item);
  };

  const compIndex = cleanInput.search(COMPARATIVE_PATTERN);

  interface MatchedSpan {
    entry: MedicalTermEntry;
    matchedSynonym: string;
    charIndex: number;
    rawText: string;
  }
  const matchedSpans: MatchedSpan[] = [];
  const consumedIntervals: Array<{ start: number; end: number }> = [];

  const isConsumed = (start: number, end: number) => {
    return consumedIntervals.some(inv => (start >= inv.start && start < inv.end) || (end > inv.start && end <= inv.end));
  };

  const hasSeparators = /[,;\n\r|]/.test(cleanInput);

  if (hasSeparators) {
    const rawChunks = cleanInput.split(/[,;\n\r|]+/).map(t => t.trim()).filter(Boolean);
    let offset = 0;
    for (const chunk of rawChunks) {
      const chunkPos = cleanInput.indexOf(chunk, offset);
      if (chunkPos !== -1) offset = chunkPos + chunk.length;

      // 1. Whole chunk match
      const wholeMatch = matchTaxonomyTerm(chunk);
      if (wholeMatch) {
        matchedSpans.push({
          entry: wholeMatch.entry,
          matchedSynonym: wholeMatch.matchedSynonym,
          charIndex: chunkPos !== -1 ? chunkPos : 0,
          rawText: chunk
        });
        consumedIntervals.push({ start: chunkPos, end: chunkPos + chunk.length });
        continue;
      }

      // 2. Longest-phrase-first within chunk
      const words = chunk.split(/\s+/).filter(Boolean);
      let i = 0;
      let matchedAnyInChunk = false;
      while (i < words.length) {
        let matched = false;
        const maxLen = Math.min(5, words.length - i);
        for (let len = maxLen; len >= 1; len--) {
          const phrase = words.slice(i, i + len).join(" ");
          const m = matchTaxonomyTerm(phrase);
          if (m) {
            const phrasePos = chunkPos !== -1 ? cleanInput.indexOf(phrase, chunkPos) : 0;
            matchedSpans.push({
              entry: m.entry,
              matchedSynonym: m.matchedSynonym,
              charIndex: phrasePos !== -1 ? phrasePos : 0,
              rawText: phrase
            });
            consumedIntervals.push({ start: phrasePos, end: phrasePos + phrase.length });
            i += len;
            matched = true;
            matchedAnyInChunk = true;
            break;
          }
        }
        if (!matched) {
          i++;
        }
      }
      if (!matchedAnyInChunk) {
        const cleanChunk = cleanTokenString(chunk);
        if (cleanChunk.length > 1 && !STOPWORDS.has(cleanChunk.toLowerCase())) {
          unresolved.push(chunk);
        }
      }
    }
  } else {
    // Prose input without separators
    const words = cleanInput.split(/\s+/).filter(Boolean);
    let searchStart = 0;
    let i = 0;
    while (i < words.length) {
      let matched = false;
      const maxLen = Math.min(5, words.length - i);
      for (let len = maxLen; len >= 1; len--) {
        const phrase = words.slice(i, i + len).join(" ");
        const m = matchTaxonomyTerm(phrase);
        if (m) {
          const phrasePos = cleanInput.indexOf(phrase, searchStart);
          matchedSpans.push({
            entry: m.entry,
            matchedSynonym: m.matchedSynonym,
            charIndex: phrasePos !== -1 ? phrasePos : searchStart,
            rawText: phrase
          });
          consumedIntervals.push({ start: phrasePos !== -1 ? phrasePos : searchStart, end: (phrasePos !== -1 ? phrasePos : searchStart) + phrase.length });
          searchStart = (phrasePos !== -1 ? phrasePos : searchStart) + phrase.length;
          i += len;
          matched = true;
          break;
        }
      }
      if (!matched) {
        const w = cleanTokenString(words[i]);
        const wPos = cleanInput.indexOf(words[i], searchStart);
        if (!isConsumed(wPos, wPos + words[i].length)) {
          if (w.length > 1 && !STOPWORDS.has(w.toLowerCase()) && !/^(versus|vs|compared|against|improve|increase|reduce|shorten|lower|raise|enhance|prevent)\b/i.test(w)) {
            unresolved.push(words[i]);
          }
        }
        searchStart = wPos !== -1 ? wPos + words[i].length : searchStart + words[i].length;
        i++;
      }
    }
  }

  // Sort matched spans by appearance order
  matchedSpans.sort((a, b) => a.charIndex - b.charIndex);

  // Assign matched spans to slots
  for (const span of matchedSpans) {
    const entry = span.entry;
    const isAfterComparative = compIndex !== -1 && span.charIndex > compIndex;

    if (entry.category === "condition") {
      addUnique(population, entry.canonical);
    } else if (entry.category === "intervention") {
      if (isAfterComparative) {
        addUnique(comparators, entry.canonical);
      } else {
        addUnique(interventions, entry.canonical);
      }
    } else if (entry.category === "comparator") {
      addUnique(comparators, entry.canonical);
    } else if (entry.category === "outcome") {
      // Hard invariant: a canonical intervention or comparator can never be emitted as an outcome
      const isAlreadyIvOrComp = interventions.includes(entry.canonical) || comparators.includes(entry.canonical);
      if (!isAlreadyIvOrComp) {
        addUnique(outcomes, entry.canonical);
      }
    }
  }

  // ART procedure logic (IVF / ICSI as population setting)
  const hasArtProcedure = interventions.some(iv => /in vitro fertilization|intracytoplasmic sperm injection|ivf|icsi/i.test(iv))
    || cleanInput.match(/\b(ivf|icsi|art)\b/i);
  const otherInterventions = interventions.filter(iv => !/in vitro fertilization|intracytoplasmic sperm injection|ivf|icsi/i.test(iv));

  if (hasArtProcedure && otherInterventions.length >= 1) {
    if (population.length > 0) {
      if (!/ivf|icsi|in vitro|art/i.test(population[0])) {
        population[0] = `${population[0]} undergoing IVF`;
      }
    } else {
      population.push("women undergoing IVF");
    }
    interventions.length = 0;
    interventions.push(...otherInterventions);
  } else if (hasArtProcedure && population.length === 0 && interventions.length === 0) {
    population.push("women undergoing IVF");
  }

  // Specialty determination from matched spans
  const specialtyScores: Record<SpecialtyKey, number> = { obstetrics: 0, gynecology: 0, infertility: 0 };
  for (const span of matchedSpans) {
    specialtyScores[span.entry.specialty] += 2;
  }
  let specialty: SpecialtyKey = "obstetrics";
  if (specialtyScores.infertility > specialtyScores.obstetrics && specialtyScores.infertility >= specialtyScores.gynecology) {
    specialty = "infertility";
  } else if (specialtyScores.gynecology > specialtyScores.obstetrics && specialtyScores.gynecology > specialtyScores.infertility) {
    specialty = "gynecology";
  } else if (specialtyScores.obstetrics > 0) {
    specialty = "obstetrics";
  } else if (specialtyScores.infertility > 0) {
    specialty = "infertility";
  }

  // Comparators completion: if none explicit, provide implied comparators
  if (comparators.length === 0) {
    if (interventions.length === 1) {
      const isAddon = isAdjuvantIntervention(interventions[0]);
      if (specialty === "infertility" && isAddon) {
        comparators.push(`no ${interventions[0]} (standard protocol)`);
      } else if (specialty === "obstetrics") {
        comparators.push("standard care or expectant management");
      } else {
        comparators.push("standard care");
      }
    } else if (interventions.length >= 2) {
      for (const iv of interventions) {
        comparators.push(`no ${iv} (standard protocol)`);
      }
    }
  }

  // Enforce cross-slot conflict rule strictly across all outcomes
  for (let idx = outcomes.length - 1; idx >= 0; idx--) {
    const outCanonical = outcomes[idx].toLowerCase();
    const isConflict = interventions.some(iv => iv.toLowerCase() === outCanonical) ||
                       comparators.some(c => c.toLowerCase() === outCanonical);
    if (isConflict) {
      outcomes.splice(idx, 1);
    }
  }

  return {
    population,
    interventions,
    comparators,
    outcomes,
    unresolved,
    cues: {
      comparative: comparativeCues,
      directionVerbs,
      population: populationCues
    }
  };
}

/**
 * Parses clinical input into distinct, non-overlapping PICO roles:
 * - Population / Clinical Problem (P)
 * - Intervention (I)
 * - Comparator (C)
 * - Candidate Outcomes (O)
 */
export function parseClinicalScenario(rawInput: string): ParsedClinicalScenario {
  const slots = extractPicoSlots(rawInput);

  // Specialty scoring from recognized slots and taxonomy
  const specialtyScores: Record<SpecialtyKey, number> = { obstetrics: 0, gynecology: 0, infertility: 0 };
  for (const p of slots.population) {
    const entry = MEDICAL_TAXONOMY.find(m => m.canonical.toLowerCase() === p.toLowerCase());
    if (entry) {
      specialtyScores[entry.specialty] += 4;
    } else if (/preterm|cervix|preeclamp|gestat|pregnancy|loss/i.test(p)) {
      specialtyScores.obstetrics += 3;
    } else if (/ivf|icsi|infertil|pcos|responder|ovarian|dor/i.test(p)) {
      specialtyScores.infertility += 3;
    } else {
      specialtyScores.gynecology += 2;
    }
  }
  for (const iv of slots.interventions) {
    const entry = MEDICAL_TAXONOMY.find(m => m.canonical.toLowerCase() === iv.toLowerCase());
    if (entry) {
      specialtyScores[entry.specialty] += 3;
    } else if (/growth hormone|coenzyme|coq10|dhea|prp|letrozole|clomiphene/i.test(iv)) {
      specialtyScores.infertility += 2;
    } else if (/cerclage|pessary|aspirin|heparin/i.test(iv)) {
      specialtyScores.obstetrics += 2;
    } else if (/dienogest|myomectomy|embolization/i.test(iv)) {
      specialtyScores.gynecology += 2;
    }
  }
  let specialty: SpecialtyKey = "obstetrics";
  if (specialtyScores.infertility > specialtyScores.obstetrics && specialtyScores.infertility >= specialtyScores.gynecology) {
    specialty = "infertility";
  } else if (specialtyScores.gynecology > specialtyScores.obstetrics && specialtyScores.gynecology > specialtyScores.infertility) {
    specialty = "gynecology";
  } else if (specialtyScores.obstetrics > 0) {
    specialty = "obstetrics";
  } else if (specialtyScores.infertility > 0) {
    specialty = "infertility";
  }

  // Derive outcomes from slots
  const derivation = deriveOutcomes(slots, specialty);
  const outcomes = derivation.outcomes.map(d => d.outcome);

  // Determine Population: only substitute default when no condition stated
  const population = slots.population[0] || (specialty === "obstetrics" ? "short cervix" : specialty === "infertility" ? "poor ovarian response" : "endometriosis");

  let intervention = slots.interventions[0] || (KB[specialty].interventions[0] || "first-line therapy");
  let comparator = slots.comparators[0] || (specialty === "obstetrics" ? "standard care or expectant management" : "standard protocol");
  let comparisonOptions: Array<{ label: string; intervention: string; comparator: string }> | undefined;
  let clarificationRequired = slots.unresolved.length > 0;
  let clarificationPrompt = "";

  if (slots.interventions.length >= 2) {
    const iv1 = slots.interventions[0];
    const iv2 = slots.interventions[1];
    const iv1IsAddon = isAdjuvantIntervention(iv1);
    const iv2IsAddon = isAdjuvantIntervention(iv2);

    if (iv1IsAddon || iv2IsAddon) {
      intervention = iv1;
      comparator = `no ${iv1} (standard protocol)`;
      clarificationRequired = true;
      clarificationPrompt = `Multiple interventions identified (${slots.interventions.join(", ")}). Please select the desired comparison.`;
      comparisonOptions = [
        { label: `${iv1} vs standard protocol`, intervention: iv1, comparator: `no ${iv1} (standard protocol)` },
        { label: `${iv2} vs standard protocol`, intervention: iv2, comparator: `no ${iv2} (standard protocol)` },
        { label: `${iv1} combined with ${iv2} vs standard protocol`, intervention: `${iv1} combined with ${iv2}`, comparator: "standard protocol" },
        { label: `${iv1} vs ${iv2} (head-to-head)`, intervention: iv1, comparator: iv2 }
      ];
    } else {
      intervention = iv1;
      comparator = iv2;
    }
  } else if (slots.interventions.length === 1) {
    intervention = slots.interventions[0];
    comparator = slots.comparators[0] || (specialty === "obstetrics" ? "standard care or expectant management" : "standard care");
  }

  const primaryOutcome = outcomes[0] || "live birth rate";
  const secondaryOutcome1 = outcomes[1] || outcomes[0] || "secondary clinical complications";
  const secondaryOutcome2 = outcomes[2] || outcomes[0] || "treatment-related complications";
  const qolOutcome = outcomes.find(o => /quality of life|satisfaction|qol/i.test(o)) || "health-related quality of life";

  const popPhrase = formulatePopulationPhrase(population, specialty);
  const q1Action = formulateOutcomeVerbPhrase("primary", primaryOutcome) || `improve ${toInlineCase(primaryOutcome)}`;
  const q2Action = formulateOutcomeVerbPhrase("secondary", secondaryOutcome1) || `increase ${toInlineCase(secondaryOutcome1)}`;
  const q3Action = formulateOutcomeVerbPhrase("subgroup", secondaryOutcome2) || `optimize ${toInlineCase(secondaryOutcome2)}`;
  const q4Action = formulateOutcomeVerbPhrase("secondary", qolOutcome) || `improve ${toInlineCase(qolOutcome)}`;

  const suggestedQuestions: Array<{ question: string; rationale: string }> = [];

  if (slots.interventions.length >= 2 && (isAdjuvantIntervention(slots.interventions[0]) || isAdjuvantIntervention(slots.interventions[1]))) {
    const iv1 = slots.interventions[0];
    const iv2 = slots.interventions[1];
    suggestedQuestions.push(
      {
        question: `In ${popPhrase} (P), does ${iv1} (I) compared with no ${iv1} (standard protocol) (C) ${q1Action} (O)?`,
        rationale: derivation.outcomes[0]?.rationale || buildDynamicRationale(iv1, `no ${iv1} (standard protocol)`, primaryOutcome, "primary")
      },
      {
        question: `In ${popPhrase} (P), does ${iv2} (I) compared with no ${iv2} (standard protocol) (C) ${q2Action} (O)?`,
        rationale: derivation.outcomes[1]?.rationale || buildDynamicRationale(iv2, `no ${iv2} (standard protocol)`, secondaryOutcome1, "secondary")
      },
      {
        question: `In ${popPhrase} (P), does ${iv1} combined with ${iv2} (I) compared with standard protocol (C) ${q3Action} (O)?`,
        rationale: derivation.outcomes[2]?.rationale || buildDynamicRationale(`${iv1} combined with ${iv2}`, "standard protocol", secondaryOutcome2, "subgroup")
      },
      {
        question: `In ${popPhrase} (P), does ${iv1} (I) compared with ${iv2} (C) ${q4Action} (O)?`,
        rationale: derivation.outcomes[3]?.rationale || buildDynamicRationale(iv1, iv2, qolOutcome, "qol")
      }
    );
  } else {
    suggestedQuestions.push(
      {
        question: `In ${popPhrase} (P), does ${intervention} (I) compared with ${comparator} (C) ${q1Action} (O)?`,
        rationale: derivation.outcomes[0]?.rationale || buildDynamicRationale(intervention, comparator, primaryOutcome, "primary")
      },
      {
        question: `In ${popPhrase} (P), does ${intervention} (I) compared with ${comparator} (C) ${q2Action} (O)?`,
        rationale: derivation.outcomes[1]?.rationale || buildDynamicRationale(intervention, comparator, secondaryOutcome1, "secondary")
      },
      {
        question: `In ${popPhrase} (P), does ${intervention} (I) compared with ${comparator} (C) ${q3Action} (O)?`,
        rationale: derivation.outcomes[2]?.rationale || buildDynamicRationale(intervention, comparator, secondaryOutcome2, "subgroup")
      },
      {
        question: `In ${popPhrase} (P), does ${intervention} (I) compared with ${comparator} (C) ${q4Action} (O)?`,
        rationale: derivation.outcomes[3]?.rationale || buildDynamicRationale(intervention, comparator, qolOutcome, "qol")
      }
    );
  }

  const advisories: string[] = [];
  if (slots.unresolved.length > 0) {
    advisories.push(`Unrecognized terms: ${slots.unresolved.join(", ")}`);
    if (!clarificationPrompt) {
      clarificationPrompt = `Unrecognized clinical terms: ${slots.unresolved.join(", ")}. Please clarify the intended population, intervention, or outcome.`;
    }
  }

  return {
    specialty,
    population,
    intervention,
    comparator,
    outcomes,
    suggestedQuestions,
    picoSlots: slots,
    derivedOutcomes: derivation.outcomes,
    ...(slots.unresolved.length > 0 ? { unrecognizedTerms: slots.unresolved } : {}),
    ...(comparisonOptions ? { comparisonOptions } : {}),
    ...(clarificationRequired ? { clarificationRequired, clarificationPrompt } : {}),
    ...(advisories.length > 0 ? { advisories } : {})
  };
}
