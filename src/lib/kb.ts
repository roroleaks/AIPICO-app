export type SpecialtyKey = "infertility" | "gynecology" | "obstetrics";

export interface OutcomeRule {
  keywords: string[];
  primary: string;
  alternatives: string[];
  rationale: string;
}

export interface SpecialtyKB {
  label: string;
  conditions: string[];
  interventions: string[];
  outcomesRanked: string[];
  terminology: string[];
  outcomeRules: OutcomeRule[];
}

export const KB: Record<SpecialtyKey, SpecialtyKB> = {
  infertility: {
    label: "Infertility / Reproductive Medicine",
    conditions: [
      "PCOS", "endometriosis", "recurrent implantation failure", "male factor infertility",
      "azoospermia", "thin endometrium", "hydrosalpinx", "uterine septum",
      "unexplained infertility", "diminished ovarian reserve", "adenomyosis", "fibroids"
    ],
    interventions: [
      "letrozole", "clomiphene citrate", "aspirin", "low molecular weight heparin",
      "IVF", "ICSI", "IUI", "laparoscopic surgery", "hysteroscopic surgery",
      "progesterone", "metformin", "G-CSF", "prednisolone", "PGT-A", "embryo glue",
      "coenzyme Q10", "myo-inositol", "vitamin D", "melatonin", "omega-3",
      "vitamin E", "selenium", "acupuncture"
    ],
    outcomesRanked: [
      "cumulative live birth rate", "live birth rate", "ongoing pregnancy rate",
      "clinical pregnancy rate", "implantation rate", "miscarriage rate", "OHSS incidence"
    ],
    terminology: ["IVF", "ICSI", "ART", "OHSS", "RIF", "LBR", "CPR"],
    outcomeRules: [
      {
        keywords: ["recurrent implantation failure", "implantation failure"],
        primary: "cumulative live birth rate",
        alternatives: ["live birth rate", "ongoing pregnancy rate", "implantation rate", "miscarriage rate"],
        rationale: "Implantation-failure care is judged by cumulative success across transfer cycles — the most patient-relevant endpoint."
      },
      {
        keywords: ["endometriosis", "adenomyosis"],
        primary: "live birth rate",
        alternatives: ["clinical pregnancy rate", "pain relief", "recurrence rate", "miscarriage rate"],
        rationale: "In reproductive-medicine patients the goal is a live birth; pain relief and recurrence are secondary outcomes."
      },
      {
        keywords: ["pcos", "polycystic", "anovul", "anovulation"],
        primary: "live birth rate",
        alternatives: ["clinical pregnancy rate", "regular menstrual cycles", "ovulation rate", "miscarriage rate"],
        rationale: "Ovulation induction is aimed at a healthy birth; regular menses and ovulation are intermediate endpoints."
      },
      {
        keywords: ["azoospermia", "male factor", "sperm", "semen"],
        primary: "live birth rate",
        alternatives: ["sperm retrieval success", "clinical pregnancy rate", "implantation rate"],
        rationale: "For male-factor infertility the decisive outcome remains the live birth achieved, not just sperm recovery."
      },
      {
        keywords: ["thin endometrium", "thin lining"],
        primary: "live birth rate",
        alternatives: ["endometrial thickness change", "clinical pregnancy rate", "implantation rate"],
        rationale: "Endometrial thickness is a surrogate; live birth is the outcome that matters to the patient."
      },
      {
        keywords: ["hydrosalpinx", "uterine septum", "septate uterus"],
        primary: "live birth rate",
        alternatives: ["clinical pregnancy rate", "surgical complications", "ectopic pregnancy rate"],
        rationale: "Surgical correction of tubal or uterine pathology should be measured by the live birth it enables."
      },
      {
        keywords: ["diminished ovarian reserve", "poor ovarian response", "low amh", "elevated fsh"],
        primary: "cumulative live birth rate",
        alternatives: ["oocyte yield (mature oocytes)", "clinical pregnancy rate", "miscarriage rate"],
        rationale: "With reduced reserve, cumulative live birth across cycles reflects the honest prognosis."
      },
      {
        keywords: ["unexplained infertility", "unexplained subfertility"],
        primary: "live birth rate",
        alternatives: ["ongoing pregnancy rate", "clinical pregnancy rate", "time to conception"],
        rationale: "Live birth, ideally within a defined timeframe, is the appropriate endpoint for unexplained infertility."
      }
    ]
  },
  gynecology: {
    label: "Gynecology",
    conditions: [
      "fibroids", "endometriosis", "adenomyosis", "heavy menstrual bleeding",
      "endometrial hyperplasia", "ovarian cysts", "pelvic organ prolapse",
      "chronic pelvic pain", "PCOS", "dyspareunia", "dysmenorrhea"
    ],
    interventions: [
      "myomectomy", "hysterectomy", "uterine artery embolization", "laparoscopy",
      "hysteroscopy", "levonorgestrel IUS", "tranexamic acid", "GnRH agonist",
      "GnRH antagonist", "endometrial ablation"
    ],
    outcomesRanked: [
      "patient-reported symptom relief", "quality of life scores", "hemoglobin change",
      "reoperation rate", "major complications", "patient satisfaction"
    ],
    terminology: ["HMB", "UAE", "LNG-IUS"],
    outcomeRules: [
      {
        keywords: ["fibroid", "leiomyoma", "myoma", "myomectomy", "uterine artery embolization", "uae embolization"],
        primary: "patient-reported symptom relief",
        alternatives: ["health-related quality of life", "reoperation rate", "major complications", "hemoglobin change", "patient satisfaction"],
        rationale: "Uterine fibroids matter because of symptoms; symptom relief and quality of life are the primary patient-centered outcomes."
      },
      {
        keywords: ["heavy menstrual bleeding", "menorrhagia", "abnormal uterine bleeding", "hbm", "hysterectomy for bleeding"],
        primary: "menstrual blood loss reduction",
        alternatives: ["hemoglobin change", "health-related quality of life", "reoperation rate", "patient satisfaction"],
        rationale: "The goal of treatment for heavy menstrual bleeding is a measurable reduction in blood loss with a rise in hemoglobin."
      },
      {
        keywords: ["endometriosis", "adenomyosis", "chronic pelvic pain", "dysmenorrhea", "dyspareunia", "pelvic pain"],
        primary: "pain reduction (patient-reported)",
        alternatives: ["health-related quality of life", "reoperation rate", "need for repeat surgery", "spontaneous conception rate"],
        rationale: "These are symptomatic conditions — sustained pain relief and quality of life are the core outcomes."
      },
      {
        keywords: ["endometrial hyperplasia", "endometrial precancer"],
        primary: "regression to normal endometrial histology",
        alternatives: ["rate of progression to cancer", "bleeding control", "hysterectomy rate"],
        rationale: "For hyperplasia, histological regression is the outcome that predicts prevention of cancer."
      },
      {
        keywords: ["pcos", "polycystic ovary"],
        primary: "regular menstrual cycles",
        alternatives: ["health-related quality of life", "cardiometabolic markers", "patient satisfaction", "weight change"],
        rationale: "In gynecology practice PCOS is managed for cycle regularity and long-term metabolic health rather than a single fertility event."
      },
      {
        keywords: ["pelvic organ prolapse", "prolapse", "cystocele", "rectocele"],
        primary: "symptom relief (pelvic floor symptoms)",
        alternatives: ["patient satisfaction", "reoperation rate", "quality of life scores", "major complications"],
        rationale: "Prolapse surgery is judged by relieving bulge symptoms and preventing recurrence, not by anatomical position alone."
      },
      {
        keywords: ["ovarian cyst"],
        primary: "symptom resolution",
        alternatives: ["malignancy detection rate", "recurrence rate", "quality of life", "surgical complications"],
        rationale: "Ovarian cyst management balances symptom control against the risk of missed malignancy."
      }
    ]
  },
  obstetrics: {
    label: "Obstetrics",
    conditions: [
      "preterm birth risk", "short cervix", "preeclampsia", "gestational diabetes",
      "placenta accreta spectrum", "placenta previa", "fetal growth restriction",
      "PPROM", "recurrent miscarriage", "twin pregnancy", "breech presentation"
    ],
    interventions: [
      "cervical cerclage", "vaginal progesterone", "low-dose aspirin", "cervical pessary",
      "antenatal corticosteroids", "magnesium sulfate", "insulin", "metformin",
      "external cephalic version"
    ],
    outcomesRanked: [
      "perinatal mortality", "neonatal morbidity composite", "gestational age at delivery",
      "preterm birth < 37 weeks", "birthweight", "maternal morbidity", "NICU admission"
    ],
    terminology: ["PTB", "FGR", "PPROM", "GDM", "PAS"],
    outcomeRules: [
      {
        keywords: ["short cervix", "cerclage", "preterm birth", "preterm labour", "preterm labor", "preterm delivery", "pessary", "tocoly", "preterm labour risk"],
        primary: "preterm birth < 37 weeks",
        alternatives: ["gestational age at delivery", "neonatal morbidity composite", "perinatal mortality", "NICU admission"],
        rationale: "Interventions for preterm-birth risk are judged by their ability to prolong gestation and reduce preterm delivery."
      },
      {
        keywords: ["preeclampsia", "pre-eclampsia", "eclampsia", "hypertensive disorder", "pregnancy-induced hypertension"],
        primary: "incidence of preeclampsia",
        alternatives: ["maternal morbidity composite", "perinatal mortality", "preterm birth < 37 weeks", "neonatal morbidity composite"],
        rationale: "Therapeutic and preventive questions in hypertensive pregnancy are measured by preeclampsia incidence and maternal complications."
      },
      {
        keywords: ["gestational diabetes", "gdm", "hyperglycemia in pregnancy"],
        primary: "large-for-gestational-age (macrosomia) birth",
        alternatives: ["neonatal hypoglycemia", "perinatal mortality", "need for insulin therapy", "cesarean section rate", "gestational weight gain"],
        rationale: "GDM treatment targets fetal overgrowth and its immediate neonatal consequences."
      },
      {
        keywords: ["placenta accreta", "accreta spectrum", "pas", "percreta", "increta"],
        primary: "rate of major obstetric hemorrhage",
        alternatives: ["postpartum blood transfusion", "maternal morbidity", "ICU admission", "perinatal mortality"],
        rationale: "Placenta accreta spectrum questions center on limiting peripartum hemorrhage and maternal harm."
      },
      {
        keywords: ["placenta previa"],
        primary: "antepartum hemorrhage requiring delivery",
        alternatives: ["gestational age at delivery", "perinatal mortality", "postpartum blood transfusion", "maternal morbidity"],
        rationale: "Placenta previa is managed to avoid emergency bleeding; the timing of delivery and hemorrhage control are the key outcomes."
      },
      {
        keywords: ["fetal growth restriction", "intrauterine growth restriction", "small for gestational", "low birthweight", "fgr"],
        primary: "neonatal morbidity composite",
        alternatives: ["perinatal mortality", "gestational age at delivery", "adverse neurodevelopmental outcome", "NICU admission"],
        rationale: "Fetal-growth-restriction questions are judged by neonatal wellbeing, not by birth weight alone."
      },
      {
        keywords: ["recurrent miscarriage", "recurrent pregnancy loss", "recurrent first trimester loss", "rpl", "recurrent loss"],
        primary: "live birth rate (≥ 24 weeks)",
        alternatives: ["ongoing pregnancy rate", "miscarriage rate", "gestational age at delivery"],
        rationale: "For recurrent pregnancy loss the decisive outcome is an ongoing live birth beyond the viability threshold."
      },
      {
        keywords: ["twin", "multiple gestation", "twin-to-twin", "ttts", "dichorionic", "monochorionic"],
        primary: "perinatal mortality",
        alternatives: ["preterm birth < 37 weeks", "neonatal morbidity composite", "maternal morbidity"],
        rationale: "Multiple-pregnancy questions are dominated by perinatal loss and prematurity risk."
      },
      {
        keywords: ["breech", "malpresentation", "external cephalic version", "ecv", "version"],
        primary: "successful vaginal delivery rate",
        alternatives: ["mode of delivery (cesarean rate)", "perinatal mortality", "neonatal morbidity", "birth trauma"],
        rationale: "Breech and version questions are measured by achieving a safe vaginal delivery and avoiding birth injury."
      }
    ]
  }
};

export const SYNONYMS: Record<string, string> = {
  "coenzyme q10": "coenzyme Q10",
  "coq10": "coenzyme Q10",
  "ubiquinol": "coenzyme Q10",
  "ubidecarenone": "coenzyme Q10",
  "clomid": "clomiphene citrate",
  "serophene": "clomiphene citrate",
  "myoinositol": "myo-inositol",
  "inositol": "myo-inositol",
  "lmwh": "low molecular weight heparin",
  "clexane": "low molecular weight heparin",
  "enoxaparin": "low molecular weight heparin",
  "vitd": "vitamin D",
  "endometriosis excision": "endometriosis surgery",
  "laparoscopic excision": "endometriosis surgery"
};

export const QUESTION_TYPES = [
  { type: "Therapy / Prevention", framework: "PICO" },
  { type: "Diagnosis", framework: "Diagnostic accuracy (PIRD)" },
  { type: "Prognosis", framework: "PECO prognostic" },
  { type: "Etiology / Risk factors", framework: "PECO" },
  { type: "Screening", framework: "Population-Test-Comparator-Outcome" },
  { type: "Harm", framework: "PECO harm" }
];

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function rationalOutcomes(condition: string, specialty: SpecialtyKey | null): OutcomeRule {
  const text = normalizeText(condition);
  const candidates = specialty ? [KB[specialty]] : Object.values(KB);
  for (const spec of candidates) {
    for (const rule of spec.outcomeRules) {
      if (rule.keywords.some(k => text.includes(normalizeText(k)))) return rule;
    }
  }
  const spec = specialty ? KB[specialty] : null;
  const ranked = spec?.outcomesRanked ?? ["live birth rate", "quality of life", "symptom relief"];
  return {
    keywords: [],
    primary: ranked[0],
    alternatives: ranked.slice(0, 7),
    rationale: "Standard patient-centered outcomes for this clinical area."
  };
}

const FERT_TEXT_RE = /ivf|icsi|assisted reproduct|embryo|in vitro|oocyte|gonadotroph|gonadotrop|embryo transfer|live birth|pregnancy|fertility|infertility|implantation/i;
const SYMPTOM_TEXT_RE = /pain|dysmenorrh|bleeding|symptom|heaviness|menorrhagia|spotting/i;
const RECURRENCE_TEXT_RE = /recurr|relapse|reoperation/i;

const FERT_CANON = [
  "live birth rate",
  "cumulative live birth rate",
  "clinical pregnancy rate",
  "ongoing pregnancy rate",
  "miscarriage rate",
  "treatment duration or treatment burden",
  "implantation rate",
  "time to pregnancy"
];
const SYMPTOM_CANON = ["pain relief", "symptom improvement", "quality of life", "patient satisfaction"];
const RECURRENCE_CANON = ["recurrence rate", "reoperation rate"];

export function picoOutcomes(question: string, condition: string, specialty: SpecialtyKey | null): OutcomeRule {
  const text = normalizeText(`${question} ${condition}`);
  const hasFert = FERT_TEXT_RE.test(text);
  const hasSymptom = SYMPTOM_TEXT_RE.test(text);
  const hasRecur = RECURRENCE_TEXT_RE.test(text);

  const base = rationalOutcomes(condition, specialty);
  const baseList = [base.primary, ...base.alternatives.filter(o => o !== base.primary)];
  const inFert = (o: string) => /live birth|birth rate|pregnancy rate|implantation|miscarriage|pregnancy outcome|delivery rate|neonatal outcome/i.test(o);
  const inSymptom = (o: string) => /pain|symptom|blood loss|bleeding|dysmenorrh|hemoglobin|score/i.test(o);
  const inRecur = (o: string) => /recurr|relapse|reoperation/i.test(o);

  let pool: string[] = [];
  if (hasFert) {
    pool = [...FERT_CANON];
    for (const o of baseList) if (inFert(o) && !pool.includes(o)) pool.push(o);
    if (!hasSymptom && !hasRecur) pool.push("adverse event or discontinuation rate");
  } else if (hasSymptom || hasRecur) {
    if (hasSymptom) pool = [...pool, ...SYMPTOM_CANON];
    if (hasRecur) pool = [...pool, ...RECURRENCE_CANON];
    for (const o of baseList) if ((inSymptom(o) || inRecur(o)) && !pool.includes(o)) pool.push(o);
    pool.push("adverse event or discontinuation rate");
  } else {
    pool = baseList;
  }

  const seen = new Set<string>();
  const uniq = pool.filter(o => {
    const k = normalizeText(o);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const primary = uniq[0] || "clinical outcome";
  return {
    keywords: [],
    primary,
    alternatives: uniq.slice(1, 6),
    rationale: "Patient-centered outcomes aligned to the selected PICO question."
  };
}

export interface Analysis {
  specialty: SpecialtyKey | null;
  specialtyLabel: string;
  condition: string;
  intervention: string;
  comparator: string;
  questionType: string;
  framework: string;
  missing: string[];
  interpretation: string;
  source: "ai" | "rules";
}

export interface Clarification {
  done: boolean;
  field: string | null;
  questionText: string;
  options: string[];
  allowFreeText: boolean;
  source: "ai" | "rules";
  rationale?: string;
}

export interface Formulation {
  framework: string;
  elements: { label: string; value: string }[];
  finalQuestion: string;
  variants?: { question: string; rationale: string }[];
  scores: { name: string; value: number }[];
  advisories: string[];
  searchTerms: { population: string; intervention: string; outcome: string };
  source: "ai" | "rules";
}
