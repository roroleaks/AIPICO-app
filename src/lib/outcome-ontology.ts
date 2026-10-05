/**
 * Structured clinical outcome ontology.
 *
 * This is the single source of truth for which outcomes the clarification flow may offer. It
 * replaces free-text outcome strings, which had three failure modes the UI could not recover
 * from: near-duplicate wording presented as distinct choices, no way to tell a patient-important
 * outcome from a process surrogate, and a specialty-wide generic list that ignored the PICO.
 *
 * Design notes:
 *
 * - `family` is the clinical question an outcome answers ("did the baby get sick?"), not its
 *   measurement. Two outcomes in the same family are usually redundant for a clinician choosing
 *   what to look for, so the selector shows one per family by default. Measurement differences
 *   (a <34-week threshold, NICU admission versus a morbidity composite) live in the same family
 *   deliberately, and are only separated when the question is explicitly about thresholds.
 * - `rationale` states *relevance*, never *effect*. It must never imply that an intervention
 *   works. The PICO-specific sentence shown to the user is composed from this text by
 *   `buildRationale` in ./outcome-selection.ts, which appends the actual population and
 *   intervention names.
 * - `applicableQuestionTypes` lets an outcome stay out of the list for question types where it is
 *   meaningless (an accuracy outcome is not offered for a therapy question).
 */

import type { SpecialtyKey } from "./kb.ts";

export type OutcomeCategory =
  | "patient-important"
  | "clinical"
  | "maternal"
  | "neonatal"
  | "safety"
  | "process"
  | "fertility"
  | "quality-of-life"
  | "recurrence";

export interface OutcomeCandidate {
  id: string;
  label: string;
  shortLabel: string;
  category: OutcomeCategory;
  /** The clinical question this outcome answers; used to keep the offered list diverse. */
  family: string;
  /** Lower sorts earlier when scores tie. 1 is the most decisive outcome in its family. */
  priority: number;
  applicableSpecialties: SpecialtyKey[];
  applicableConditions: string[];
  applicableInterventions: string[];
  applicableQuestionTypes: string[];
  keywords: string[];
  rationale: string;
  measurable: boolean;
  preferredForPrimaryOutcome: boolean;
}

/**
 * Fails fast at module load on a malformed entry.
 *
 * A partially filled outcome is worse than a missing one: it ranks as if it were valid and is
 * then shown to a clinician. Validation here means a bad edit fails the test run, not production.
 */
function defineOutcome(entry: OutcomeCandidate): OutcomeCandidate {
  const problems: string[] = [];
  if (!entry.id) problems.push("id");
  if (!entry.label?.trim()) problems.push("label");
  if (!entry.shortLabel?.trim()) problems.push("shortLabel");
  if (!entry.family?.trim()) problems.push("family");
  if (!Number.isFinite(entry.priority)) problems.push("priority");
  if (!entry.rationale?.trim()) problems.push("rationale");
  if (!Array.isArray(entry.applicableSpecialties)) problems.push("applicableSpecialties");
  if (!Array.isArray(entry.applicableConditions)) problems.push("applicableConditions");
  if (!Array.isArray(entry.applicableInterventions)) problems.push("applicableInterventions");
  if (!Array.isArray(entry.applicableQuestionTypes)) problems.push("applicableQuestionTypes");
  if (!Array.isArray(entry.keywords)) problems.push("keywords");
  if (problems.length) {
    throw new Error(`Malformed outcome ontology entry (${problems.join(", ")}): ${JSON.stringify(entry.id)}`);
  }
  return entry;
}

const THERAPY = "Therapy / Prevention";
const DIAGNOSIS = "Diagnosis";
const PROGNOSIS = "Prognosis";
const ETIOLOGY = "Etiology / Risk factors";
const SCREENING = "Screening";
const HARM = "Harm";

export const OUTCOME_ONTOLOGY: OutcomeCandidate[] = [
  // ---------------------------------------------------------------- preterm birth
  defineOutcome({
    id: "preterm-birth-37",
    label: "Spontaneous preterm birth before 37 completed weeks",
    shortLabel: "Preterm birth <37w",
    category: "patient-important",
    family: "preterm-birth",
    priority: 1,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: [
      "short cervix", "preterm birth risk", "preterm labour", "preterm labor", "preterm delivery",
      "cervical insufficiency", "pprom", "multiple gestation", "twin pregnancy", "placenta previa"
    ],
    applicableInterventions: [
      "cervical cerclage", "vaginal progesterone", "progesterone", "cervical pessary",
      "low-dose aspirin", "antenatal corticosteroids", "tocolysis"
    ],
    applicableQuestionTypes: [THERAPY, HARM, PROGNOSIS],
    keywords: ["preterm", "premature", "37 weeks", "cerclage", "pessary", "cervix", "progesterone", "ptb"],
    rationale: "It is the clinical event this question centres on, so it measures the outcome the clinician is actually asking about.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "preterm-birth-34",
    label: "Spontaneous preterm birth before 34 completed weeks",
    shortLabel: "Preterm birth <34w",
    category: "patient-important",
    family: "preterm-birth",
    priority: 2,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: ["short cervix", "preterm birth risk", "preterm labour", "pprom", "twin pregnancy", "multiple gestation"],
    applicableInterventions: ["cervical cerclage", "vaginal progesterone", "cervical pessary", "progesterone"],
    applicableQuestionTypes: [THERAPY, PROGNOSIS],
    keywords: ["preterm", "severe preterm", "34 weeks", "very preterm", "threshold"],
    rationale: "It captures the severe end of the same clinical event, which is the part of it most likely to change neonatal management.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "gestational-age-at-delivery",
    label: "Gestational age at delivery",
    shortLabel: "Gestational age",
    category: "process",
    family: "gestational-age",
    priority: 1,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: ["short cervix", "preterm birth risk", "preterm labour", "pprom", "placenta previa", "twin pregnancy", "multiple gestation"],
    applicableInterventions: ["cervical cerclage", "vaginal progesterone", "progesterone", "cervical pessary", "antenatal corticosteroids"],
    applicableQuestionTypes: [THERAPY, PROGNOSIS, HARM],
    keywords: ["gestational age", "prolong", "delivery", "weeks", "latency"],
    rationale: "It is the continuous measure behind the threshold outcome and shows how far the pregnancy actually progressed.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "cervical-length-change",
    label: "Cervical length measured by transvaginal ultrasound",
    shortLabel: "Cervical length",
    category: "process",
    family: "cervical-length",
    priority: 1,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: ["short cervix", "cervical insufficiency", "preterm birth risk"],
    applicableInterventions: ["vaginal progesterone", "progesterone", "cervical cerclage", "cervical pessary"],
    applicableQuestionTypes: [THERAPY, DIAGNOSIS, PROGNOSIS],
    keywords: ["cervical length", "transvaginal", "ultrasound", "short cervix", "cervix"],
    rationale: "It is the intermediate measurement used to select and monitor this group, so it shows whether the intervention changed the measurement itself.",
    measurable: true,
    preferredForPrimaryOutcome: false
  }),

  // ---------------------------------------------------------------- fetal growth and wellbeing
  defineOutcome({
    id: "fetal-growth-restriction",
    label: "Fetal growth restriction",
    shortLabel: "Fetal growth restriction",
    category: "clinical",
    family: "fetal-growth",
    priority: 1,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: ["fetal growth restriction", "small for gestational age", "low birthweight", "preeclampsia", "gestational diabetes"],
    applicableInterventions: ["low-dose aspirin", "insulin", "metformin", "antenatal corticosteroids"],
    applicableQuestionTypes: [THERAPY, PROGNOSIS, SCREENING],
    keywords: ["growth restriction", "fgr", "small for gestational", "birthweight", "iugr", "asymmetrical"],
    rationale: "It is the condition-level outcome this question asks about, and it is measured rather than inferred.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "birthweight-percentile",
    label: "Birthweight or small-for-gestational-age status",
    shortLabel: "Birthweight / SGA",
    category: "clinical",
    family: "fetal-growth",
    priority: 2,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: ["fetal growth restriction", "small for gestational age", "gestational diabetes", "preeclampsia"],
    applicableInterventions: ["insulin", "metformin", "low-dose aspirin"],
    applicableQuestionTypes: [THERAPY, PROGNOSIS],
    keywords: ["birthweight", "small for gestational", "sga", "percentile", "macrosomia"],
    rationale: "It is the objective growth measure that accompanies the growth outcome in this population.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "large-for-gestational-age",
    label: "Large-for-gestational-age birth (macrosomia)",
    shortLabel: "Macrosomia / LGA",
    category: "clinical",
    family: "fetal-growth",
    priority: 2,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: ["gestational diabetes", "diabetes in pregnancy", "obesity"],
    applicableInterventions: ["insulin", "metformin", "dietary intervention"],
    applicableQuestionTypes: [THERAPY, PROGNOSIS],
    keywords: ["macrosomia", "large for gestational", "lga", "birth trauma", "shoulder dystocia"],
    rationale: "Fetal overgrowth is the specific fetal outcome this treatment question is directed at.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "stillbirth",
    label: "Stillbirth or intrauterine fetal death",
    shortLabel: "Stillbirth",
    category: "neonatal",
    family: "perinatal-death",
    priority: 1,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: ["fetal growth restriction", "preeclampsia", "preterm birth risk", "multiple gestation", "twin pregnancy", "recurrent miscarriage"],
    applicableInterventions: ["low-dose aspirin", "cervical cerclage", "insulin", "magnesium sulfate"],
    applicableQuestionTypes: [THERAPY, HARM, PROGNOSIS],
    keywords: ["stillbirth", "fetal death", "iu fd", "perinatal death", "mortality"],
    rationale: "It is the most severe outcome in this clinical area and belongs in any question that changes the risk of pregnancy loss.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "perinatal-mortality",
    label: "Perinatal mortality",
    shortLabel: "Perinatal mortality",
    category: "neonatal",
    family: "perinatal-death",
    priority: 1,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: ["preterm birth risk", "multiple gestation", "twin pregnancy", "fetal growth restriction", "preeclampsia", "placenta accreta spectrum"],
    applicableInterventions: ["cervical cerclage", "antenatal corticosteroids", "magnesium sulfate", "external cephalic version"],
    applicableQuestionTypes: [THERAPY, HARM, PROGNOSIS],
    keywords: ["perinatal mortality", "perinatal death", "stillbirth", "neonatal death"],
    rationale: "It combines fetal and neonatal death into the single measure that matters most to families in this setting.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "neonatal-morbidity-composite",
    label: "Neonatal morbidity composite (respiratory support, sepsis, necrotising enterocolitis)",
    shortLabel: "Neonatal morbidity",
    category: "neonatal",
    family: "neonatal-morbidity",
    priority: 1,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: ["preterm birth risk", "fetal growth restriction", "preeclampsia", "multiple gestation", "twin pregnancy", "gestational diabetes", "pprom"],
    applicableInterventions: ["antenatal corticosteroids", "cervical cerclage", "magnesium sulfate", "insulin"],
    applicableQuestionTypes: [THERAPY, HARM, PROGNOSIS],
    keywords: ["neonatal morbidity", "respiratory distress", "necrotising enterocolitis", "necrotizing enterocolitis", "sepsis", "composite"],
    rationale: "It captures the illness burden a pregnancy intervention is intended to affect, rather than the delivery timing alone.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "nicu-admission",
    label: "Neonatal intensive care admission",
    shortLabel: "NICU admission",
    category: "neonatal",
    family: "neonatal-morbidity",
    priority: 2,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: ["preterm birth risk", "fetal growth restriction", "multiple gestation", "twin pregnancy"],
    applicableInterventions: ["antenatal corticosteroids", "cervical cerclage"],
    applicableQuestionTypes: [THERAPY, HARM],
    keywords: ["nicu", "neonatal unit", "intensive care", "admission", "level of care"],
    rationale: "It is the resource-use measure that accompanies the same neonatal question this intervention addresses.",
    measurable: true,
    preferredForPrimaryOutcome: false
  }),
  defineOutcome({
    id: "neurodevelopmental-outcome",
    label: "Adverse neurodevelopmental outcome at follow-up",
    shortLabel: "Neurodevelopment",
    category: "neonatal",
    family: "long-term-child",
    priority: 1,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: ["preterm birth risk", "fetal growth restriction", "multiple gestation", "twin pregnancy", "preeclampsia"],
    applicableInterventions: ["antenatal corticosteroids", "magnesium sulfate", "cervical cerclage"],
    applicableQuestionTypes: [THERAPY, PROGNOSIS],
    keywords: ["neurodevelopment", "neurodevelopmental", "cerebral palsy", "long term", "follow up", "developmental"],
    rationale: "It is the long-horizon outcome that makes the neonatal question clinically consequential.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "birth-trauma",
    label: "Birth trauma or injury to the neonate",
    shortLabel: "Birth trauma",
    category: "safety",
    family: "birth-trauma",
    priority: 1,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: ["breech presentation", "macrosomia", "gestational diabetes"],
    applicableInterventions: ["external cephalic version", "insulin", "metformin"],
    applicableQuestionTypes: [THERAPY, HARM],
    keywords: ["birth trauma", "shoulder dystocia", "brachial plexus", "injury", "breech"],
    rationale: "It is the direct harm to the neonate that delivery management in this question is judged against.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),

  // ---------------------------------------------------------------- hypertensive and placental
  defineOutcome({
    id: "preeclampsia-incidence",
    label: "Incidence of pre-eclampsia",
    shortLabel: "Pre-eclampsia incidence",
    category: "patient-important",
    family: "preeclampsia",
    priority: 1,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: ["preeclampsia", "pregnancy-induced hypertension", "hypertensive disorder", "chronic hypertension", "eclampsia", "gestational hypertension"],
    applicableInterventions: ["low-dose aspirin", "calcium supplementation", "magnesium sulfate", "antihypertensive therapy"],
    applicableQuestionTypes: [THERAPY, PROGNOSIS, HARM],
    keywords: ["preeclampsia", "pre eclampsia", "hypertension", "hypertensive", "aspirin", "proteinuria"],
    rationale: "It is the named clinical event of this question and the one whose incidence an intervention is prescribed to change.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "severe-preeclampsia-features",
    label: "Severe features or progression of pre-eclampsia",
    shortLabel: "Severe pre-eclampsia",
    category: "maternal",
    family: "preeclampsia",
    priority: 2,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: ["preeclampsia", "eclampsia", "gestational hypertension", "chronic hypertension"],
    applicableInterventions: ["low-dose aspirin", "magnesium sulfate", "antihypertensive therapy"],
    applicableQuestionTypes: [THERAPY, PROGNOSIS, HARM],
    keywords: ["severe preeclampsia", "progression", "severe features", "eclampsia", "worsening"],
    rationale: "It distinguishes a severe course from uncomplicated disease, which changes both monitoring and intervention.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "maternal-hemorrhage",
    label: "Major obstetric haemorrhage or postpartum blood transfusion",
    shortLabel: "Obstetric haemorrhage",
    category: "safety",
    family: "maternal-bleeding",
    priority: 1,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: ["placenta accreta spectrum", "placenta previa", "uterine rupture", "preeclampsia", "multiple gestation", "twin pregnancy"],
    applicableInterventions: ["uterine artery embolization", "external cephalic version", "cervical cerclage"],
    applicableQuestionTypes: [THERAPY, HARM, DIAGNOSIS],
    keywords: ["haemorrhage", "hemorrhage", "blood loss", "transfusion", "hysterectomy", "bleeding"],
    rationale: "It is the acute maternal hazard that dominates the management question being asked.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "placenta-adherence-diagnosis",
    label: "Accreta spectrum detected before delivery",
    shortLabel: "Accreta detected antenatally",
    category: "clinical",
    family: "diagnosis-accuracy",
    priority: 1,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: ["placenta accreta spectrum", "placenta previa", "prior caesarean section"],
    applicableInterventions: ["ultrasound", "mri", "cesarean hysterectomy"],
    applicableQuestionTypes: [DIAGNOSIS, SCREENING],
    keywords: ["accreta", "percreta", "increta", "pra detection", "planned delivery", "preoperative"],
    rationale: "For a diagnostic or screening question this is the endpoint that matters: whether the condition was identified before delivery.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),

  // ---------------------------------------------------------------- metabolic
  defineOutcome({
    id: "neonatal-hypoglycemia",
    label: "Neonatal hypoglycaemia",
    shortLabel: "Neonatal hypoglycaemia",
    category: "neonatal",
    family: "neonatal-metabolic",
    priority: 1,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: ["gestational diabetes", "diabetes in pregnancy", "large for gestational age", "macrosomia"],
    applicableInterventions: ["insulin", "metformin", "dietary intervention"],
    applicableQuestionTypes: [THERAPY, HARM, PROGNOSIS],
    keywords: ["hypoglycaemia", "hypoglycemia", "low blood glucose", "neonatal glucose"],
    rationale: "It is the immediate neonatal consequence most directly linked to the maternal metabolic question.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "maternal-glycemic-control",
    label: "Maternal glycaemic control (fasting and postprandial glucose, HbA1c)",
    shortLabel: "Glycaemic control",
    category: "clinical",
    family: "maternal-metabolic",
    priority: 1,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: ["gestational diabetes", "diabetes in pregnancy", "preeclampsia", "obesity"],
    applicableInterventions: ["insulin", "metformin", "dietary intervention"],
    applicableQuestionTypes: [THERAPY, PROGNOSIS],
    keywords: ["glycaemic control", "glycemic control", "hba1c", "fasting glucose", "postprandial", "insulin"],
    rationale: "It is the direct physiological measure of whether the treatment achieved its stated target.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "need-for-insulin-therapy",
    label: "Need for insulin or additional pharmacological therapy",
    shortLabel: "Need for insulin",
    category: "process",
    family: "treatment-burden",
    priority: 1,
    applicableSpecialties: ["obstetrics", "gynecology"],
    applicableConditions: ["gestational diabetes", "diabetes in pregnancy", "pcos"],
    applicableInterventions: ["metformin", "dietary intervention", "letrozole"],
    applicableQuestionTypes: [THERAPY],
    keywords: ["insulin", "need for insulin", "escalation", "additional therapy", "titration"],
    rationale: "It shows the treatment escalation the question's intervention avoided or delayed.",
    measurable: true,
    preferredForPrimaryOutcome: false
  }),

  // ---------------------------------------------------------------- fertility and assisted reproduction
  defineOutcome({
    id: "live-birth",
    label: "Live birth",
    shortLabel: "Live birth",
    category: "fertility",
    family: "live-birth",
    priority: 1,
    applicableSpecialties: ["infertility"],
    applicableConditions: [
      "pcos", "endometriosis", "adenomyosis", "recurrent implantation failure", "unexplained infertility",
      "male factor infertility", "azoospermia", "diminished ovarian reserve", "thin endometrium",
      "hydrosalpinx", "uterine septum", "fibroids", "anovulation"
    ],
    applicableInterventions: [
      "ivf", "icsi", "iui", "letrozole", "clomiphene citrate", "progesterone", "laparoscopic surgery",
      "hysteroscopic surgery", "metformin", "myo-inositol", "coenzyme Q10"
    ],
    applicableQuestionTypes: [THERAPY, HARM, PROGNOSIS],
    keywords: ["live birth", "lbr", "birth", "infant", "delivery"],
    rationale: "It is the endpoint patients in this area actually seek, and the one most trials are designed to report.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "cumulative-live-birth",
    label: "Cumulative live birth across all treatment cycles",
    shortLabel: "Cumulative live birth",
    category: "fertility",
    family: "live-birth",
    priority: 2,
    applicableSpecialties: ["infertility"],
    applicableConditions: ["diminished ovarian reserve", "recurrent implantation failure", "unexplained infertility", "pcos", "recurrent miscarriage"],
    applicableInterventions: ["ivf", "icsi", "letrozole", "clomiphene citrate"],
    applicableQuestionTypes: [THERAPY, PROGNOSIS],
    keywords: ["cumulative", "across cycles", "per started cycle", "total", "efficacy"],
    rationale: "It reflects the honest overall result of treatment rather than the outcome of one favourable cycle.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "clinical-pregnancy",
    label: "Clinical pregnancy rate",
    shortLabel: "Clinical pregnancy",
    category: "process",
    family: "pregnancy-establishment",
    priority: 1,
    applicableSpecialties: ["infertility"],
    applicableConditions: ["pcos", "unexplained infertility", "recurrent implantation failure", "male factor infertility", "endometriosis", "diminished ovarian reserve", "anovulation"],
    applicableInterventions: ["ivf", "icsi", "iui", "letrozole", "clomiphene citrate", "metformin"],
    applicableQuestionTypes: [THERAPY, PROGNOSIS],
    keywords: ["clinical pregnancy", "cpr", "pregnancy rate", "sac", "gestational sac"],
    rationale: "It is the established intermediate endpoint for this question, though it is a surrogate for a birth.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "ongoing-pregnancy",
    label: "Ongoing pregnancy rate beyond the first trimester",
    shortLabel: "Ongoing pregnancy",
    category: "clinical",
    family: "pregnancy-establishment",
    priority: 2,
    applicableSpecialties: ["infertility"],
    applicableConditions: ["recurrent implantation failure", "recurrent miscarriage", "diminished ovarian reserve", "unexplained infertility", "pcos"],
    applicableInterventions: ["ivf", "icsi", "iui", "progesterone"],
    applicableQuestionTypes: [THERAPY, PROGNOSIS],
    keywords: ["ongoing pregnancy", "ongoing", "12 weeks", "viability", "sustained"],
    rationale: "It distinguishes a pregnancy that persisted from one that ended early, which matters when early loss is the clinical concern.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "implantation-rate",
    label: "Implantation rate",
    shortLabel: "Implantation rate",
    category: "process",
    family: "embryo-implantation",
    priority: 1,
    applicableSpecialties: ["infertility"],
    applicableConditions: ["recurrent implantation failure", "thin endometrium", "recurrent miscarriage", "diminished ovarian reserve", "unexplained infertility"],
    applicableInterventions: ["ivf", "icsi", "embryo transfer", "progesterone", "myo-inositol", "endometrial scratch"],
    applicableQuestionTypes: [THERAPY, DIAGNOSIS, PROGNOSIS],
    keywords: ["implantation", "implant", "rif", "attachment", "endometrial receptivity"],
    rationale: "It is the specific step this question is about when the clinical problem is repeated failure to implant.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "miscarriage-rate",
    label: "Miscarriage rate",
    shortLabel: "Miscarriage rate",
    category: "safety",
    family: "pregnancy-loss",
    priority: 1,
    applicableSpecialties: ["infertility", "obstetrics"],
    applicableConditions: ["recurrent miscarriage", "recurrent pregnancy loss", "recurrent implantation failure", "pcos", "diminished ovarian reserve", "unexplained infertility", "preeclampsia"],
    applicableInterventions: ["ivf", "icsi", "iui", "progesterone", "letrozole", "low-dose aspirin"],
    applicableQuestionTypes: [THERAPY, HARM, PROGNOSIS],
    keywords: ["miscarriage", "pregnancy loss", "abortion", "rpl", "loss"],
    rationale: "It is the harm patients are most concerned about when treatment involves establishing a pregnancy.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "ovulation-rate",
    label: "Ovulation rate",
    shortLabel: "Ovulation rate",
    category: "process",
    family: "ovulation",
    priority: 1,
    applicableSpecialties: ["infertility", "gynecology"],
    applicableConditions: ["pcos", "polycystic ovary syndrome", "anovulation", "amenorrhea"],
    applicableInterventions: ["letrozole", "clomiphene citrate", "metformin", "gonadotropins", "myo-inositol"],
    applicableQuestionTypes: [THERAPY, DIAGNOSIS, PROGNOSIS],
    keywords: ["ovulation", "ovulate", "anovulation", "follicle", "cycle"],
    rationale: "It is the physiological step this induction question is designed to restore.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "menstrual-cycle-regularity",
    label: "Regular menstrual cycles",
    shortLabel: "Cycle regularity",
    category: "clinical",
    family: "cycle-pattern",
    priority: 1,
    applicableSpecialties: ["gynecology", "infertility"],
    applicableConditions: ["pcos", "polycystic ovary syndrome", "anovulation", "amenorrhea", "dysmenorrhea"],
    applicableInterventions: ["letrozole", "clomiphene citrate", "combined oral contraceptive", "levonorgestrel ius", "metformin"],
    applicableQuestionTypes: [THERAPY, PROGNOSIS],
    keywords: ["cycle regularity", "regular cycles", "menses", "menstruation", "amenorrhea", "oligomenorrhea"],
    rationale: "For a gynaecological question it is the clinical change the intervention is meant to produce.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "multiple-pregnancy-rate",
    label: "Multiple pregnancy rate",
    shortLabel: "Multiple pregnancy",
    category: "safety",
    family: "multiple-pregnancy",
    priority: 1,
    applicableSpecialties: ["infertility", "obstetrics"],
    applicableConditions: ["pcos", "anovulation", "multiple gestation", "twin pregnancy"],
    applicableInterventions: ["letrozole", "clomiphene citrate", "gonadotropins", "ivf", "icsi", "embryo transfer"],
    applicableQuestionTypes: [THERAPY, HARM],
    keywords: ["multiple pregnancy", "twins", "twin", "triplet", "high order"],
    rationale: "It is the recognised trade-off of ovulation induction and embryo transfer in this group.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "ovarian-hyperstimulation",
    label: "Ovarian hyperstimulation syndrome (OHSS)",
    shortLabel: "OHSS",
    category: "safety",
    family: "treatment-related-harm",
    priority: 1,
    applicableSpecialties: ["infertility"],
    applicableConditions: ["pcos", "polycystic ovary syndrome", "high responder", "anovulation"],
    applicableInterventions: ["gonadotropins", "letrozole", "ivf", "icsi", "clomiphene citrate"],
    applicableQuestionTypes: [THERAPY, HARM],
    keywords: ["ohss", "hyperstimulation", "ascites", "ovary enlarged", "hospitalisation"],
    rationale: "It is the specific complication this class of treatment is known for and is asked about explicitly.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "oocyte-yield",
    label: "Number of mature oocytes retrieved",
    shortLabel: "Oocyte yield",
    category: "process",
    family: "laboratory-yield",
    priority: 1,
    applicableSpecialties: ["infertility"],
    applicableConditions: ["diminished ovarian reserve", "pcos", "unexplained infertility", "male factor infertility"],
    applicableInterventions: ["gonadotropins", "ivf", "icsi", "letrozole", "coenzyme Q10", "dhea"],
    applicableQuestionTypes: [THERAPY, PROGNOSIS],
    keywords: ["oocyte", "egg", "yield", "retrieved", "mature", "follicle count", "amh"],
    rationale: "It is the measurable response that indicates whether stimulation worked, which matters most when reserve is limited.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "sperm-retrieval-success",
    label: "Sperm retrieval success",
    shortLabel: "Sperm retrieval",
    category: "process",
    family: "laboratory-yield",
    priority: 2,
    applicableSpecialties: ["infertility"],
    applicableConditions: ["male factor infertility", "azoospermia", "sperm", "semen"],
    applicableInterventions: ["icsi", "testicular sperm extraction", "ivf"],
    applicableQuestionTypes: [THERAPY, DIAGNOSIS],
    keywords: ["sperm retrieval", "tese", "micro tese", "azoospermia", "sperm"],
    rationale: "It is the intermediate step in male-factor infertility, distinct from whether a birth follows.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "time-to-pregnancy",
    label: "Time to pregnancy",
    shortLabel: "Time to pregnancy",
    category: "patient-important",
    family: "treatment-burden",
    priority: 1,
    applicableSpecialties: ["infertility"],
    applicableConditions: ["unexplained infertility", "pcos", "endometriosis", "male factor infertility"],
    applicableInterventions: ["letrozole", "clomiphene citrate", "iui", "ivf", "laparoscopic surgery"],
    applicableQuestionTypes: [THERAPY, HARM],
    keywords: ["time to pregnancy", "time to conception", "waiting", "duration", "months"],
    rationale: "It captures how long the question's treatment makes patients wait, which is a major part of the burden of infertility care.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "ectopic-pregnancy-rate",
    label: "Ectopic pregnancy rate",
    shortLabel: "Ectopic pregnancy",
    category: "safety",
    family: "pregnancy-loss",
    priority: 2,
    applicableSpecialties: ["infertility", "obstetrics"],
    applicableConditions: ["hydrosalpinx", "unexplained infertility", "tubal surgery", "endometriosis"],
    applicableInterventions: ["ivf", "icsi", "iui", "salpingectomy", "hysteroscopic surgery"],
    applicableQuestionTypes: [THERAPY, HARM],
    keywords: ["ectopic", "tubal pregnancy", "extrauterine"],
    rationale: "It is a recognised harmful consequence of tubal disease and of assisted conception in this group.",
    measurable: true,
    preferredForPrimaryOutcome: false
  }),
  defineOutcome({
    id: "spontaneous-conception-rate",
    label: "Spontaneous conception rate",
    shortLabel: "Spontaneous conception",
    category: "fertility",
    family: "live-birth",
    priority: 3,
    applicableSpecialties: ["infertility", "gynecology"],
    applicableConditions: ["endometriosis", "adenomyosis", "fibroids", "hydrosalpinx", "unexplained infertility", "pcos"],
    applicableInterventions: ["laparoscopic surgery", "hysteroscopic surgery", "myomectomy", "salpingectomy"],
    applicableQuestionTypes: [THERAPY, PROGNOSIS],
    keywords: ["spontaneous conception", "natural conception", "pregnant without", "unassisted"],
    rationale: "It is the outcome that distinguishes fertility-preserving surgery from treatments that only support assisted conception.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),

  // ---------------------------------------------------------------- gynaecology: symptoms and surgery
  defineOutcome({
    id: "pain-reduction",
    label: "Patient-reported pain reduction",
    shortLabel: "Pain reduction",
    category: "patient-important",
    family: "pain",
    priority: 1,
    applicableSpecialties: ["gynecology"],
    applicableConditions: ["endometriosis", "adenomyosis", "chronic pelvic pain", "dysmenorrhea", "dyspareunia", "fibroids"],
    applicableInterventions: ["laparoscopy", "hysterectomy", "gnrh agonist", "gnrh antagonist", "levonorgestrel ius", "endometrial ablation", "myomectomy"],
    applicableQuestionTypes: [THERAPY, HARM, PROGNOSIS],
    keywords: ["pain", "dysmenorrhea", "dyspareunia", "pelvic pain", "visual analogue", "vas", "nrs"],
    rationale: "Symptoms are why this question is being asked, so the symptom itself is the outcome that matters most.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "quality-of-life",
    label: "Health-related quality of life",
    shortLabel: "Quality of life",
    category: "quality-of-life",
    family: "wellbeing",
    priority: 1,
    applicableSpecialties: ["gynecology", "obstetrics", "infertility"],
    applicableConditions: [
      "endometriosis", "adenomyosis", "chronic pelvic pain", "fibroids", "heavy menstrual bleeding",
      "pelvic organ prolapse", "pcos", "dyspareunia", "infertility", "recurrent pregnancy loss"
    ],
    applicableInterventions: [
      "laparoscopy", "hysterectomy", "levonorgestrel ius", "gnrh agonist", "myomectomy", "ivf", "letrozole"
    ],
    applicableQuestionTypes: [THERAPY, PROGNOSIS, HARM],
    keywords: ["quality of life", "qol", "hrqol", "wellbeing", "well being", "sf 36", "eq 5d"],
    rationale: "It measures the overall effect of the condition and its treatment on the patient's daily life, beyond any single symptom.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "pain-recurrence",
    label: "Pain recurrence or symptom recurrence",
    shortLabel: "Pain recurrence",
    category: "recurrence",
    family: "recurrence",
    priority: 1,
    applicableSpecialties: ["gynecology"],
    applicableConditions: ["endometriosis", "adenomyosis", "chronic pelvic pain", "pelvic organ prolapse", "dysmenorrhea", "ovarian cyst", "fibroids"],
    applicableInterventions: ["laparoscopy", "hysterectomy", "gnrh agonist", "endometrial ablation", "myomectomy", "cystectomy"],
    applicableQuestionTypes: [THERAPY, PROGNOSIS, HARM],
    keywords: ["recurrence", "relapse", "returned", "symptom free", "durability", "long term"],
    rationale: "It shows how durable the response was, which a question about a definitive or long-acting treatment has to address.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "reoperation-rate",
    label: "Reoperation or repeat surgical intervention",
    shortLabel: "Reoperation rate",
    category: "safety",
    family: "reoperation",
    priority: 1,
    applicableSpecialties: ["gynecology", "obstetrics"],
    applicableConditions: ["fibroids", "endometriosis", "adenomyosis", "pelvic organ prolapse", "ovarian cyst", "endometrial hyperplasia", "heavy menstrual bleeding"],
    applicableInterventions: ["myomectomy", "hysterectomy", "laparoscopy", "hysteroscopy", "uterine artery embolization", "endometrial ablation"],
    applicableQuestionTypes: [THERAPY, HARM],
    keywords: ["reoperation", "repeat surgery", "further surgery", "reoperation rate", "conversion"],
    rationale: "It is the outcome that distinguishes a durable result from one that only deferred the problem.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "surgical-complications",
    label: "Intraoperative and postoperative complications",
    shortLabel: "Surgical complications",
    category: "safety",
    family: "procedure-harm",
    priority: 1,
    applicableSpecialties: ["gynecology", "obstetrics"],
    applicableConditions: ["endometriosis", "fibroids", "adenomyosis", "pelvic organ prolapse", "ovarian cyst", "endometrial hyperplasia", "hydrosalpinx", "uterine septum"],
    applicableInterventions: ["laparoscopy", "hysteroscopy", "myomectomy", "hysterectomy", "uterine artery embolization", "salpingectomy"],
    applicableQuestionTypes: [THERAPY, HARM],
    keywords: ["complication", "intraoperative", "postoperative", "injury", "infection", "conversion to open"],
    rationale: "Any intervention that operates carries a defined complication rate, and that trade-off belongs in the question.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "menstrual-blood-loss",
    label: "Menstrual blood loss reduction",
    shortLabel: "Blood loss reduction",
    category: "clinical",
    family: "symptom-burden",
    priority: 1,
    applicableSpecialties: ["gynecology"],
    applicableConditions: ["heavy menstrual bleeding", "menorrhagia", "abnormal uterine bleeding", "fibroids", "adenomyosis"],
    applicableInterventions: ["levonorgestrel ius", "tranexamic acid", "hysterectomy", "endometrial ablation", "myomectomy"],
    applicableQuestionTypes: [THERAPY, HARM, PROGNOSIS],
    keywords: ["blood loss", "menorrhagia", "bleeding", "hmb", "pads", "sanitary"],
    rationale: "It is the objective measure behind the symptom that prompted the question.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "hemoglobin-change",
    label: "Change in haemoglobin",
    shortLabel: "Haemoglobin change",
    category: "clinical",
    family: "hematologic-recovery",
    priority: 1,
    applicableSpecialties: ["gynecology", "obstetrics"],
    applicableConditions: ["heavy menstrual bleeding", "menorrhagia", "abnormal uterine bleeding", "fibroids", "uterine rupture", "placenta accreta spectrum"],
    applicableInterventions: ["levonorgestrel ius", "tranexamic acid", "hysterectomy", "iron"],
    applicableQuestionTypes: [THERAPY, HARM, PROGNOSIS],
    keywords: ["hemoglobin", "haemoglobin", "hb", "anaemia", "anemia", "ferritin", "iron"],
    rationale: "It is the laboratory measure that indicates whether reduced blood loss translated into physiological recovery.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "endometrial-histology-regression",
    label: "Regression of endometrial hyperplasia to normal histology",
    shortLabel: "Histological regression",
    category: "clinical",
    family: "histological-regression",
    priority: 1,
    applicableSpecialties: ["gynecology"],
    applicableConditions: ["endometrial hyperplasia", "endometrial precancer", "obesity", "anovulation"],
    applicableInterventions: ["progestogen", "levonorgestrel ius", "combined oral contraceptive", "metformin", "hysterectomy"],
    applicableQuestionTypes: [THERAPY, PROGNOSIS],
    keywords: ["histology", "hyperplasia", "regression", "biopsy", "endometrial"],
    rationale: "It is the lesion-level endpoint for this question, and the one that speaks to progression risk.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "progression-to-endometrial-cancer",
    label: "Progression to endometrial carcinoma",
    shortLabel: "Progression to cancer",
    category: "safety",
    family: "malignancy-outcome",
    priority: 1,
    applicableSpecialties: ["gynecology"],
    applicableConditions: ["endometrial hyperplasia", "endometrial precancer", "obesity", "anovulation", "pcos"],
    applicableInterventions: ["progestogen", "levonorgestrel ius", "combined oral contraceptive", "hysterectomy"],
    applicableQuestionTypes: [THERAPY, PROGNOSIS],
    keywords: ["cancer", "carcinoma", "malignancy", "progression", "neoplasia"],
    rationale: "It is the harm the treatment in this question is intended to prevent, and so defines its safety.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "malignancy-detection",
    label: "Malignancy detected in a managed adnexal or ovarian lesion",
    shortLabel: "Malignancy detected",
    category: "safety",
    family: "malignancy-outcome",
    priority: 1,
    applicableSpecialties: ["gynecology"],
    applicableConditions: ["ovarian cyst", "adnexal mass", "endometrial hyperplasia"],
    applicableInterventions: ["laparoscopy", "cystectomy", "oophorectomy", "hysterectomy"],
    applicableQuestionTypes: [THERAPY, DIAGNOSIS, PROGNOSIS, HARM],
    keywords: ["malignancy", "cancer", "missed malignancy", "tumor", "neoplasm"],
    rationale: "For a question about managing a lesion, the risk of missing a malignancy is the harm being weighed.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "patient-satisfaction",
    label: "Patient satisfaction with the procedure",
    shortLabel: "Patient satisfaction",
    category: "quality-of-life",
    family: "wellbeing",
    priority: 2,
    applicableSpecialties: ["gynecology", "infertility", "obstetrics"],
    applicableConditions: ["pelvic organ prolapse", "fibroids", "endometriosis", "infertility", "pcos"],
    applicableInterventions: ["hysterectomy", "myomectomy", "levonorgestrel ius", "ivf", "laparoscopy"],
    applicableQuestionTypes: [THERAPY, HARM, PROGNOSIS],
    keywords: ["satisfaction", "acceptable", "regret", "experience", "preference"],
    rationale: "It captures whether the outcome matched what the patient wanted, which the clinical endpoints alone do not.",
    measurable: true,
    preferredForPrimaryOutcome: false
  }),
  defineOutcome({
    id: "mode-of-delivery",
    label: "Mode of delivery (caesarean rate)",
    shortLabel: "Mode of delivery",
    category: "clinical",
    family: "labor-course",
    priority: 1,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: ["breech presentation", "malpresentation", "macrosomia", "placenta previa", "multiple gestation", "twin pregnancy"],
    applicableInterventions: ["external cephalic version", "insulin", "metformin"],
    applicableQuestionTypes: [THERAPY, HARM, PROGNOSIS],
    keywords: ["mode of delivery", "caesarean", "cesarean", "section", "vaginal delivery"],
    rationale: "It is the delivery outcome the intervention in this question is intended to influence.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "successful-vaginal-delivery",
    label: "Successful vaginal delivery",
    shortLabel: "Vaginal delivery",
    category: "patient-important",
    family: "labor-course",
    priority: 1,
    applicableSpecialties: ["obstetrics"],
    applicableConditions: ["breech presentation", "malpresentation"],
    applicableInterventions: ["external cephalic version", "moulding", "amniotomy"],
    applicableQuestionTypes: [THERAPY, HARM],
    keywords: ["vaginal delivery", "breech", "version", "presentation", "delivery"],
    rationale: "It is the outcome the clinician is trying to achieve when this question is about fetal presentation.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),

  // ---------------------------------------------------------------- diagnostics, screening, risk
  defineOutcome({
    id: "sensitivity",
    label: "Sensitivity",
    shortLabel: "Sensitivity",
    category: "clinical",
    family: "diagnosis-accuracy",
    priority: 1,
    applicableSpecialties: ["obstetrics", "gynecology", "infertility"],
    applicableConditions: ["endometriosis", "adenomyosis", "placenta accreta spectrum", "ovarian cyst", "fetal growth restriction", "preeclampsia", "recurrent miscarriage"],
    applicableInterventions: ["ultrasound", "mri", "screening test", "biomarker", "ntp test"],
    applicableQuestionTypes: [DIAGNOSIS, SCREENING],
    keywords: ["sensitivity", "true positive", "detect", "detection rate"],
    rationale: "For a question about a test, sensitivity is the property that decides whether it is useful.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "specificity",
    label: "Specificity",
    shortLabel: "Specificity",
    category: "clinical",
    family: "diagnosis-accuracy",
    priority: 2,
    applicableSpecialties: ["obstetrics", "gynecology", "infertility"],
    applicableConditions: ["endometriosis", "adenomyosis", "placenta accreta spectrum", "ovarian cyst", "cervical cancer screening", "preterm birth risk"],
    applicableInterventions: ["ultrasound", "mri", "screening test", "biomarker", "cervical length measurement"],
    applicableQuestionTypes: [DIAGNOSIS, SCREENING],
    keywords: ["specificity", "true negative", "false positive", "false positive rate"],
    rationale: "It determines how often the test sends a healthy person for unnecessary follow-up.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "false-positive-rate",
    label: "False-positive rate of screening",
    shortLabel: "False-positive rate",
    category: "process",
    family: "diagnosis-accuracy",
    priority: 3,
    applicableSpecialties: ["obstetrics", "gynecology"],
    applicableConditions: ["cervical cancer screening", "preterm birth risk", "preterm labour", "down syndrome screening"],
    applicableInterventions: ["screening test", "cervical length measurement", "combined test", "cell free dna"],
    applicableQuestionTypes: [SCREENING, DIAGNOSIS],
    keywords: ["false positive", "unnecessary", "overdiagnosis", "cascade testing"],
    rationale: "It is the downstream cost of screening, and the reason screening thresholds are debated.",
    measurable: true,
    preferredForPrimaryOutcome: false
  }),
  defineOutcome({
    id: "missed-diagnosis-rate",
    label: "Rate of missed or late diagnosis",
    shortLabel: "Missed diagnosis",
    category: "safety",
    family: "diagnosis-accuracy",
    priority: 2,
    applicableSpecialties: ["obstetrics", "gynecology", "infertility"],
    applicableConditions: ["endometriosis", "adenomyosis", "placenta accreta spectrum", "ovarian cyst", "endometrial hyperplasia"],
    applicableInterventions: ["ultrasound", "mri", "screening test", "hysteroscopy"],
    applicableQuestionTypes: [DIAGNOSIS, SCREENING],
    keywords: ["missed", "delay", "late diagnosis", "underdiagnosed", "diagnostic delay"],
    rationale: "It is the harm that a diagnostic or screening question is trying to reduce.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "incidence-of-event",
    label: "Incidence of the event in the defined population",
    shortLabel: "Incidence of the event",
    category: "clinical",
    family: "incidence",
    priority: 1,
    // Empty means "applies to any specialty". These fallbacks are what remain when no
    // OB/GYN context was recognised at all, so scoping them would leave nothing to offer.
    applicableSpecialties: [],
    applicableConditions: ["unknown", "unspecified"],
    applicableInterventions: [],
    applicableQuestionTypes: [ETIOLOGY, PROGNOSIS, SCREENING],
    keywords: ["incidence", "rate", "occurrence", "risk", "frequency"],
    rationale: "It is the direct measure of how often the clinical event of interest occurs.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "relative-risk-of-event",
    label: "Relative risk or odds ratio for the event",
    shortLabel: "Relative risk",
    category: "clinical",
    family: "incidence",
    priority: 2,
    applicableSpecialties: [],
    applicableConditions: ["unknown", "unspecified"],
    applicableInterventions: [],
    applicableQuestionTypes: [ETIOLOGY],
    keywords: ["relative risk", "odds ratio", "hazard ratio", "association", "attributable risk"],
    rationale: "It quantifies the strength of the association this question asks about, which incidence alone cannot show.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),

  // ---------------------------------------------------------------- treatment burden and generic-but-grounded
  defineOutcome({
    id: "adverse-effects-of-intervention",
    label: "Adverse effects attributable to the intervention",
    shortLabel: "Adverse effects",
    category: "safety",
    family: "treatment-related-harm",
    priority: 2,
    // Empty means "applies to any specialty". Harm from an intervention is not an
    // obstetric concept, so scoping it would hide it from non-OB/GYN questions.
    applicableSpecialties: [],
    applicableConditions: [
      "unknown", "unspecified", "short cervix", "preeclampsia", "gestational diabetes", "endometriosis",
      "fibroids", "pcos", "recurrent pregnancy loss", "preterm birth risk", "heavy menstrual bleeding"
    ],
    applicableInterventions: [],
    applicableQuestionTypes: [THERAPY, HARM],
    keywords: ["adverse", "side effect", "harm", "toxicity", "complication of"],
    rationale: "It is the harm side of any intervention question, and a question that cannot answer it is incomplete.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "treatment-discontinuation",
    label: "Treatment discontinuation or switching",
    shortLabel: "Discontinuation rate",
    category: "process",
    family: "treatment-burden",
    priority: 3,
    applicableSpecialties: [],
    applicableConditions: ["unknown", "unspecified", "endometriosis", "fibroids", "pcos", "heavy menstrual bleeding"],
    applicableInterventions: [],
    applicableQuestionTypes: [THERAPY, HARM],
    keywords: ["discontinuation", "adherence", "switch", "drop out", "tolerability"],
    rationale: "It shows how tolerable the intervention was in practice, which effectiveness measures alone do not.",
    measurable: true,
    preferredForPrimaryOutcome: false
  }),
  defineOutcome({
    id: "symptom-resolution",
    label: "Resolution of the presenting symptom",
    shortLabel: "Symptom resolution",
    category: "patient-important",
    family: "symptom-burden",
    priority: 2,
    applicableSpecialties: [],
    applicableConditions: ["unknown", "unspecified", "heavy menstrual bleeding", "pelvic pain", "endometriosis", "nausea", "vomiting of pregnancy"],
    applicableInterventions: [],
    applicableQuestionTypes: [THERAPY, HARM, PROGNOSIS],
    keywords: ["symptom", "resolution", "relief", "improvement", "resolved"],
    rationale: "It is the patient-visible change the question is about when no more specific endpoint has been defined.",
    measurable: true,
    preferredForPrimaryOutcome: true
  }),
  defineOutcome({
    id: "clinical-event-rate",
    label: "Rate of the clinical event being targeted",
    shortLabel: "Clinical event rate",
    category: "patient-important",
    family: "target-event",
    priority: 3,
    applicableSpecialties: [],
    applicableConditions: ["unknown", "unspecified"],
    applicableInterventions: [],
    applicableQuestionTypes: [THERAPY, PROGNOSIS, HARM],
    keywords: ["event", "clinical outcome", "endpoint", "occurrence"],
    rationale: "It is the generic but correctly scoped fallback: the event this question is actually about.",
    measurable: true,
    preferredForPrimaryOutcome: true
  })
];