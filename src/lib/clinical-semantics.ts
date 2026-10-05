import { KB, type SpecialtyKey } from "./kb.ts";

export interface ParsedClinicalScenario {
  specialty: SpecialtyKey;
  population: string;
  intervention: string;
  comparator: string;
  outcomes: string[];
  suggestedQuestions: Array<{ question: string; rationale: string }>;
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
    synonyms: ["diminished ovarian reserve", "dor", "low amh", "poor ovarian response", "elevated fsh", "low antral follicle count"]
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
    synonyms: ["health-related quality of life", "quality of life", "qol", "patient satisfaction", "ephq-30"]
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
    synonyms: ["cumulative live birth rate", "live birth rate", "live birth", "ongoing pregnancy rate"]
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
  }
];

function cleanTokenString(s: string): string {
  return s.trim().replace(/^[\s,;:-]+|[\s,;:-]+$/g, "").replace(/\s+/g, " ");
}

/**
 * Determine whether an outcome represents an adverse event (to reduce/prevent)
 * or a desirable outcome (to improve/increase/preserve).
 */
export function getOutcomeDirection(outcomeText: string): OutcomeDirection {
  const lower = outcomeText.toLowerCase();
  const found = MEDICAL_TAXONOMY.find(
    m => m.category === "outcome" && (m.canonical.toLowerCase() === lower || m.synonyms.some(s => s.toLowerCase() === lower))
  );
  if (found?.direction) return found.direction;

  if (
    /mortality|morbidity|loss|miscarriage|preterm birth|complication|recurrence|adverse|admission|failure|death|bleeding|pain|cesarean|nicu/i.test(lower) &&
    !/relief|reduction|cessation|preservation|maintenance|quality/i.test(lower)
  ) {
    return "adverse";
  }
  return "desirable";
}

/**
 * Formulate a clinically grammatical verb phrase for an outcome.
 */
function formulateOutcomeVerbPhrase(verbType: "primary" | "secondary" | "subgroup", outcome: string): string {
  const dir = getOutcomeDirection(outcome);
  const cleanOutcome = outcome.trim();

  // If the outcome already contains active action nouns
  if (/^reduction in /i.test(cleanOutcome) || / reduction$/i.test(cleanOutcome)) {
    return verbType === "primary" ? `achieve greater ${cleanOutcome}` : `lead to significant ${cleanOutcome}`;
  }
  if (/^preservation of /i.test(cleanOutcome) || / preservation$/i.test(cleanOutcome)) {
    return verbType === "primary" ? `enhance ${cleanOutcome}` : `ensure optimal ${cleanOutcome}`;
  }
  if (/^prevention of /i.test(cleanOutcome) || / prevention$/i.test(cleanOutcome)) {
    return verbType === "primary" ? `improve ${cleanOutcome}` : `support ${cleanOutcome}`;
  }

  if (/rate$/i.test(cleanOutcome)) {
    const base = cleanOutcome.replace(/\s+rate$/i, "");
    if (dir === "adverse") {
      switch (verbType) {
        case "primary":
          return `reduce the rate of ${base}`;
        case "secondary":
          return `decrease the incidence of ${base}`;
        case "subgroup":
          return `prevent ${base}`;
      }
    } else {
      switch (verbType) {
        case "primary":
          return `improve the ${cleanOutcome}`;
        case "secondary":
          return `increase the ${cleanOutcome}`;
        case "subgroup":
          return `optimize the ${cleanOutcome}`;
      }
    }
  }

  if (dir === "adverse") {
    switch (verbType) {
      case "primary":
        return `reduce the risk of ${cleanOutcome}`;
      case "secondary":
        return `decrease the incidence of ${cleanOutcome}`;
      case "subgroup":
        return `prevent ${cleanOutcome}`;
    }
  } else {
    switch (verbType) {
      case "primary":
        return `improve ${cleanOutcome}`;
      case "secondary":
        return `increase ${cleanOutcome}`;
      case "subgroup":
        return `optimize ${cleanOutcome}`;
    }
  }
}

/**
 * Formulate clinical population noun phrase (e.g. "women with endometriosis", "pregnant women with short cervix")
 */
function formulatePopulationPhrase(population: string, specialty: SpecialtyKey): string {
  const p = population.trim();
  const lower = p.toLowerCase();

  if (/^(women|patients|individuals|pregnant individuals|pregnant women)/i.test(lower)) {
    return p;
  }
  if (specialty === "obstetrics") {
    if (/pregnancy|twin|gestation|gravida|labor|labour/i.test(lower)) {
      return `pregnant women with ${p}`;
    }
    return `pregnant women diagnosed with ${p}`;
  }
  if (specialty === "infertility") {
    return `women presenting with ${p}`;
  }
  return `women with ${p}`;
}

/**
 * Parses 4–6 clinical tag words into distinct, non-overlapping PICO roles:
 * - Population / Clinical Problem (P)
 * - Intervention (I)
 * - Comparator (C)
 * - Candidate Outcomes (O)
 */
export function parseClinicalScenario(rawInput: string): ParsedClinicalScenario {
  const cleanInput = (rawInput || "").trim();
  // Split input by commas, semicolons, dashes, or newlines
  const rawTokens = cleanInput
    .split(/[,;\n\r]+/)
    .map(cleanTokenString)
    .filter(t => t.length > 1);

  const matchedConditions: string[] = [];
  const matchedInterventions: string[] = [];
  const matchedOutcomes: string[] = [];
  const specialtyScores: Record<SpecialtyKey, number> = { obstetrics: 0, gynecology: 0, infertility: 0 };

  const unclassified: string[] = [];

  for (const token of rawTokens) {
    const lower = token.toLowerCase();
    let found = false;

    // Sort taxonomy so that if condition is already identified, outcome and intervention take precedence
    const sortedTaxonomy = [...MEDICAL_TAXONOMY].sort((a, b) => {
      if (matchedConditions.length > 0) {
        if (a.category === "condition" && b.category !== "condition") return 1;
        if (b.category === "condition" && a.category !== "condition") return -1;
      }
      return 0;
    });

    for (const entry of sortedTaxonomy) {
      const isMatch = entry.synonyms.some(syn => {
        const s = syn.toLowerCase();
        // Exact match or full token match
        return lower === s || lower === s + "s" || (lower.length >= 4 && s === lower);
      });

      if (isMatch) {
        specialtyScores[entry.specialty] += 2;
        if (entry.category === "condition" && !matchedConditions.includes(entry.canonical)) {
          matchedConditions.push(entry.canonical);
          found = true;
          break;
        } else if (entry.category === "intervention" && !matchedInterventions.includes(entry.canonical)) {
          matchedInterventions.push(entry.canonical);
          found = true;
          break;
        } else if (entry.category === "outcome" && !matchedOutcomes.includes(entry.canonical)) {
          matchedOutcomes.push(entry.canonical);
          found = true;
          break;
        }
      }
    }

    if (!found) {
      // Secondary check: substring match on longer tokens
      for (const entry of sortedTaxonomy) {
        if (found) break;
        const isSubstring = entry.synonyms.some(syn => {
          const s = syn.toLowerCase();
          return (lower.length > 5 && s.includes(lower)) || (s.length > 5 && lower.includes(s));
        });
        if (isSubstring) {
          specialtyScores[entry.specialty] += 1;
          if (entry.category === "condition" && !matchedConditions.includes(entry.canonical)) {
            matchedConditions.push(entry.canonical);
            found = true;
          } else if (entry.category === "intervention" && !matchedInterventions.includes(entry.canonical)) {
            matchedInterventions.push(entry.canonical);
            found = true;
          } else if (entry.category === "outcome" && !matchedOutcomes.includes(entry.canonical)) {
            matchedOutcomes.push(entry.canonical);
            found = true;
          }
        }
      }
    }

    if (!found) {
      unclassified.push(token);
    }
  }

  // Heuristic classification for any remaining tokens
  for (const token of unclassified) {
    const lower = token.toLowerCase();
    // Interventions check first so procedures/drugs never contaminate Condition
    if (/ectomy|scopy|surgery|treatment|therapy|drug|aspirin|progesterone|letrozole|clomiphene|cerclage|pessary|insulin|metformin|heparin|dienogest|embolization|ablation|insemination|transfer/i.test(lower)) {
      if (!matchedInterventions.includes(token)) matchedInterventions.push(token);
    } else if (/rate|relief|pain|birth|loss|bleeding|weight|score|morbidity|mortality|survival|gestational age|reserve|pregnancy|outcome/i.test(lower)) {
      if (!matchedOutcomes.includes(token)) matchedOutcomes.push(token);
    } else if (/itis|osis|emia|oma|syndrome|disease|preterm|preeclamp|diabetes|cervix|uterus|ovary|ovarian|fibroid|polyps|prolapse|failure|incompetence|restriction/i.test(lower)) {
      if (!matchedConditions.includes(token)) matchedConditions.push(token);
      if (/preterm|cervix|preeclamp|gestation/i.test(lower)) specialtyScores.obstetrics += 1;
      else if (/ivf|icsi|infertil|pcos/i.test(lower)) specialtyScores.infertility += 1;
      else specialtyScores.gynecology += 1;
    } else if (matchedConditions.length === 0) {
      matchedConditions.push(token);
    } else if (matchedInterventions.length === 0) {
      matchedInterventions.push(token);
    } else {
      matchedOutcomes.push(token);
    }
  }

  // Determine specialty
  let specialty: SpecialtyKey = "obstetrics";
  if (specialtyScores.infertility > specialtyScores.obstetrics && specialtyScores.infertility >= specialtyScores.gynecology) {
    specialty = "infertility";
  } else if (specialtyScores.gynecology > specialtyScores.obstetrics && specialtyScores.gynecology > specialtyScores.infertility) {
    specialty = "gynecology";
  } else if (specialtyScores.obstetrics > 0) {
    specialty = "obstetrics";
  }

  // Determine clean, non-overlapping P, I, C
  const population = matchedConditions[0] || (specialty === "obstetrics" ? "short cervix" : specialty === "infertility" ? "polycystic ovary syndrome" : "endometriosis");
  
  let intervention = "";
  let comparator = "";

  if (matchedInterventions.length >= 2) {
    intervention = matchedInterventions[0];
    comparator = matchedInterventions[1];
  } else if (matchedInterventions.length === 1) {
    intervention = matchedInterventions[0];
    comparator = specialty === "obstetrics" ? "standard care or expectant management" : "placebo or standard care";
  } else {
    const specDefault = KB[specialty];
    intervention = specDefault.interventions[0] || "first-line therapy";
    comparator = specDefault.interventions[1] || "standard care";
  }

  // Candidate outcomes
  const defaultOutcomes = KB[specialty].outcomesRanked;
  const outcomes = matchedOutcomes.length > 0
    ? [...matchedOutcomes, ...defaultOutcomes.filter(d => !matchedOutcomes.includes(d))].slice(0, 6)
    : defaultOutcomes.slice(0, 6);

  const primaryOutcome = outcomes[0] || "primary clinical outcome";
  const secondaryOutcome1 = outcomes[1] || outcomes[0] || "secondary clinical complications";
  const secondaryOutcome2 = outcomes[2] || outcomes[0] || "treatment-related complications";

  const popPhrase = formulatePopulationPhrase(population, specialty);
  const q1Action = formulateOutcomeVerbPhrase("primary", primaryOutcome);
  const q2Action = formulateOutcomeVerbPhrase("secondary", secondaryOutcome1);
  const q3Action = formulateOutcomeVerbPhrase("subgroup", secondaryOutcome2);

  // Build 4 strictly calibrated, logically separated PICO questions
  const suggestedQuestions: Array<{ question: string; rationale: string }> = [
    {
      question: `In ${popPhrase} (P), does ${intervention} (I) compared with ${comparator} (C) ${q1Action} (O)?`,
      rationale: `Evaluates the primary therapeutic efficacy of ${intervention} versus ${comparator} on the key clinical endpoint.`
    },
    {
      question: `In high-risk subgroups of ${popPhrase} (P), does early intervention with ${intervention} (I) compared with ${comparator} (C) ${q2Action} (O)?`,
      rationale: `Addresses risk-stratified timing and therapeutic threshold to prevent acute or progressive complications.`
    },
    {
      question: `In patients undergoing treatment for ${population} (P), does ${intervention} (I) compared with ${comparator} (C) ${q3Action} (O)?`,
      rationale: `Focuses on balancing procedural safety, organ preservation, and long-term functional recovery.`
    },
    {
      question: `In ${popPhrase} (P), does protocolized management with ${intervention} (I) compared with ${comparator} (C) improve patient-reported quality of life and treatment satisfaction (O)?`,
      rationale: `Measures patient-centered outcomes, symptom relief sustainability, and overall care satisfaction.`
    }
  ];

  return {
    specialty,
    population,
    intervention,
    comparator,
    outcomes,
    suggestedQuestions
  };
}
