/**
 * PubMed query construction for clinical evidence-gap searches.
 *
 * Two things matter here and neither is cosmetic:
 *
 * 1. Escaping. Clinician free text is interpolated straight into an E-utilities query, so a stray
 *    parenthesis, quote, or boolean operator in a PICO value produces a malformed query and an
 *    opaque "search failed". Operators are stripped and phrases are quoted before use.
 *
 * 2. MeSH recall. Title/abstract-only `[tiab]` matching misses the controlled vocabulary that
 *    obstetric and reproductive-medicine literature is actually indexed with, so mapped concepts
 *    are unioned with their MeSH descriptors. A missing mapping costs recall silently: the
 *    query simply returns fewer papers, which reads downstream as "no evidence exists".
 *
 * Descriptors below are exact MeSH headings, quoted at the point of use. Anything not certain to
 * be a real heading is deliberately absent - a wrong heading silently drops studies, whereas a
 * missing one only leaves the `[tiab]` arm to catch them.
 */

export interface ClinicalSearchInput {
  population?: string | null;
  outcome?: string | null;
  intervention?: string | null;
  comparator?: string | null;
}

const PHRASE_MAX_CHARS = 120;

export const MESH_DESCRIPTORS: Readonly<Record<string, readonly string[]>> = {
  // Preterm birth and cervical insufficiency
  "short cervix": ["Cervix Uteri", "Uterine Cervical Length"],
  "insufficient cervix": ["Cervix Uteri", "Uterine Cervical Length"],
  "cervical insufficiency": ["Cervix Uteri", "Uterine Cervical Length"],
  "cervical length": ["Uterine Cervical Length", "Ultrasonography, Prenatal"],
  "cervical cerclage": ["Cervical Cerclage", "Sutures"],
  cerclage: ["Cervical Cerclage", "Sutures"],
  "preterm birth": ["Premature Birth", "Obstetric Labor, Premature"],
  "preterm labor": ["Obstetric Labor, Premature", "Premature Birth"],
  "preterm delivery": ["Premature Birth", "Obstetric Labor, Premature"],
  "premature birth": ["Premature Birth", "Obstetric Labor, Premature"],

  // Progestogen therapy
  progesterone: ["Progesterone", "Progestins"],
  "vaginal progesterone": ["Progesterone", "Administration, Intravaginal"],
  "progesterone supplementation": ["Progesterone", "Progestins"],

  // Hypertensive and placental disorders
  preeclampsia: ["Pre-Eclampsia"],
  eclampsia: ["Eclampsia", "Pre-Eclampsia"],
  "gestational hypertension": ["Hypertension, Pregnancy-Induced", "Pre-Eclampsia"],
  "placenta accreta": ["Placenta Accreta"],
  "placenta previa": ["Placenta Previa"],
  "placental abruption": ["Abruptio Placentae"],
  "uterine rupture": ["Uterine Rupture"],

  // Fetal growth and well-being
  "fetal growth restriction": ["Fetal Growth Retardation"],
  iugr: ["Fetal Growth Retardation"],
  sga: ["Fetal Growth Retardation", "Infant, Small for Gestational Age"],
  "small for gestational age": ["Infant, Small for Gestational Age", "Fetal Growth Retardation"],
  "macrosomia": ["Macrosomia"],
  "stillbirth": ["Stillbirth", "Fetal Death"],
  "fetal demise": ["Fetal Death"],

  // Metabolic and multisystem
  "gestational diabetes": ["Diabetes, Gestational"],
  "gestational diabetes mellitus": ["Diabetes, Gestational"],
  obesity: ["Obesity"],
  "maternal obesity": ["Obesity", "Pregnancy, Complications, Cardiovascular"],

  // Multiple pregnancy
  "twin pregnancy": ["Pregnancy, Twin", "Pregnancy, Multiple"],
  "twin gestation": ["Pregnancy, Twin", "Pregnancy, Multiple"],
  "twin birth": ["Pregnancy, Twin", "Pregnancy, Multiple"],
  "singleton pregnancy": ["Pregnancy, Singleton", "Pregnancy, Single"],

  // Loss and infertility
  "recurrent pregnancy loss": ["Abortion, Habitual", "Pregnancy Loss"],
  "recurrent miscarriage": ["Abortion, Habitual", "Abortion, Spontaneous"],
  "pregnancy loss": ["Pregnancy Loss", "Abortion, Spontaneous"],
  miscarriage: ["Abortion, Spontaneous"],
  "ectopic pregnancy": ["Pregnancy, Ectopic"],
  "infertility": ["Infertility"],
  "female infertility": ["Infertility, Female"],
  "male infertility": ["Infertility, Male"],
  "unexplained infertility": ["Infertility, Female", "Infertility"],
  "diminished ovarian reserve": ["Ovarian Reserve", "Primary Ovarian Insufficiency"],
  "recurrent implantation failure": ["Embryo Implantation", "Infertility, Female"],
  "thin endometrium": ["Endometrium", "Endometrial Thickness"],

  // Assisted reproduction
  "in vitro fertilization": ["Fertilization in Vitro"],
  ivf: ["Fertilization in Vitro"],
  icsi: ["Sperm Injections, Intracytoplasmic"],
  "intracytoplasmic sperm injection": ["Sperm Injections, Intracytoplasmic"],
  iui: ["Insemination, Artificial"],
  "intrauterine insemination": ["Insemination, Artificial"],
  "assisted reproductive technology": ["Reproductive Technology, Assisted"],
  "embryo transfer": ["Embryo Transfer"],
  "ovarian hyperstimulation syndrome": ["Ovarian Hyperstimulation Syndrome"],
  "ovarian stimulation": ["Ovulation Induction"],
  "ovarian reserve": ["Ovarian Reserve"],
  "endometrial receptivity": ["Endometrium", "Embryo Implantation"],

  // Benign gynecologic disease
  endometriosis: ["Endometriosis"],
  adenomyosis: ["Adenomyosis"],
  "uterine fibroids": ["Leiomyoma, Uterine"],
  "uterine leiomyoma": ["Leiomyoma, Uterine"],
  fibroids: ["Leiomyoma, Uterine"],
  "pelvic inflammatory disease": ["Pelvic Inflammatory Disease"],
  "pelvic pain": ["Pelvic Pain"],
  pcos: ["Polycystic Ovary Syndrome"],
  "polycystic ovary syndrome": ["Polycystic Ovary Syndrome"],
  "insulin resistance": ["Insulin Resistance"],
  "endometrial hyperplasia": ["Endometrial Hyperplasia"],
  amenorrhea: ["Amenorrhea"],
  "irregular menstruation": ["Menstrual Irregularities"],
  dysmenorrhea: ["Dysmenorrhea"],
  menopause: ["Menopause"],

  // Malignancy
  "endometrial cancer": ["Endometrial Neoplasms"],
  "cervical cancer": ["Uterine Cervical Neoplasms"],
  "ovarian cancer": ["Ovarian Neoplasms"],
  "breast cancer": ["Breast Neoplasms"],

  // Screening and prenatal care
  "cervical cancer screening": ["Uterine Cervical Neoplasms", "Mass Screening"],
  "cervical screening": ["Mass Screening", "Uterine Cervical Neoplasms"],
  "cervical length screening": ["Uterine Cervical Length", "Mass Screening"],
  "first trimester screening": ["Mass Screening", "Pregnancy, Early"],
  "prenatal screening": ["Mass Screening", "Prenatal Diagnosis"],
  "genetic screening": ["Genetic Testing", "Mass Screening"],
  "noninvasive prenatal testing": ["Genetic Testing", "Prenatal Diagnosis"],
  "amniocentesis": ["Amniocentesis"],
  chorionicity: ["Placenta", "Amniotic Membranes"],
  "cesarean delivery": ["Cesarean Section", "Delivery, Obstetric"],
  "vaginal delivery": ["Vaginal Birth", "Delivery, Obstetric"],

  // Methodology and reporting, for evidence-gap mapping
  "systematic review": ["Systematic Review"],
  "meta-analysis": ["Meta-Analysis"],
  "randomized controlled trial": ["Randomized Controlled Trials as Topic"],
  "randomised controlled trial": ["Randomized Controlled Trials as Topic"],
  rct: ["Randomized Controlled Trials as Topic"],
  cohort: ["Cohort Studies"],
  "clinical trial": ["Clinical Trials as Topic"],
  "live birth rate": ["Live Birth"],
  "cumulative live birth": ["Live Birth", "Reproductive Technology, Assisted"],
  "clinical pregnancy rate": ["Pregnancy Rate", "Pregnancy, Ectopic"],
  "ongoing pregnancy rate": ["Pregnancy Outcome", "Pregnancy Maintenance"],
  "implantation rate": ["Embryo Implantation", "Pregnancy Rate"],
  "miscarriage rate": ["Abortion, Spontaneous", "Pregnancy Loss"],
  "adverse events": ["Drug-Related Side Effects and Adverse Reactions"],
  "maternal morbidity": ["Morbidity", "Pregnancy, Complications"],
  "neonatal outcomes": ["Infant, Newborn"],
  "perinatal mortality": ["Perinatal Mortality", "Stillbirth"],
  "patient satisfaction": ["Patient Satisfaction"],
  "quality of life": ["Quality of Life"]
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strips E-utilities syntax from clinician free text.
 *
 * Quotes, brackets, and parentheticals are removed rather than escaped: an unbalanced operator
 * cannot be escaped into a safe query, and the text is only ever used as a phrase. Boolean words
 * are dropped for the same reason - `AND` inside a quoted phrase is literal in PubMed, but a
 * stray one outside a phrase silently rewrites the boolean structure of the query.
 */
export function sanitizePhrase(value: string | null | undefined): string {
  if (!value) return "";
  return String(value)
    .replace(/["()[\]]/g, " ")
    .replace(/\b(AND|OR|NOT)\b/gi, " ")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PHRASE_MAX_CHARS)
    .trim();
}

function quotePhrase(phrase: string): string {
  // Always quoted: PubMed treats an unquoted multi-word value as a field search against every
  // term, which silently widens the query and drops the phrase constraint the caller asked for.
  return `"${phrase}"`;
}

/** Whole-word longest match wins, so "cervical cerclage" beats "cerclage". */
export function resolveMeshDescriptors(phrase: string): string[] {
  const key = phrase.toLowerCase().trim();
  if (!key) return [];

  const direct = MESH_DESCRIPTORS[key];
  if (direct) return [...direct];

  let bestAlias: string | null = null;
  for (const alias of Object.keys(MESH_DESCRIPTORS)) {
    if (bestAlias !== null && alias.length <= bestAlias.length) continue;
    if (new RegExp(`(?:^|\\s)${escapeRegExp(alias)}(?:\\s|$)`).test(key)) {
      bestAlias = alias;
    }
  }
  return bestAlias ? [...MESH_DESCRIPTORS[bestAlias]] : [];
}

/**
 * Builds one concept arm: free text in `[tiab]` unioned with any mapped MeSH descriptors.
 *
 * Descriptors are only added when the phrase actually maps, so an unmapped term degrades to
 * plain `[tiab]` instead of to an empty or malformed clause.
 */
export function buildConceptClause(value: string | null | undefined): string {
  const phrase = sanitizePhrase(value);
  if (!phrase) return "";

  const tiab = `${quotePhrase(phrase)}[tiab]`;
  const mesh = resolveMeshDescriptors(phrase).map(d => `${quotePhrase(d)}[MeSH Terms]`);
  return mesh.length ? `(${tiab} OR ${mesh.join(" OR ")})` : tiab;
}

/** Intervention arm: intervention and comparator are alternatives, matching the original intent. */
export function buildInterventionClause(
  intervention: string | null | undefined,
  comparator: string | null | undefined
): string {
  const arms = [buildConceptClause(intervention), buildConceptClause(comparator)].filter(Boolean);
  if (!arms.length) return "";
  return arms.length === 1 ? arms[0]! : `(${arms.join(" OR ")})`;
}

/** Untagged phrase, used as a recall backstop when every tagged candidate returns nothing. */
function buildBroadClause(value: string | null | undefined): string {
  const phrase = sanitizePhrase(value);
  return phrase ? `(${quotePhrase(phrase)})` : "";
}

const MAX_CANDIDATES = 8;

/**
 * Ordered recall ladder, strictest first. The route stops at the first candidate that returns
 * any hit, so ordering is the entire search strategy: narrowing first keeps precision, and the
 * broad untagged arms at the end are what stop a slightly over-specified PICO from reporting a
 * false zero.
 */
export function buildCandidates(input: ClinicalSearchInput): string[] {
  const population = buildConceptClause(input.population);
  const outcome = buildConceptClause(input.outcome);
  const intervention = buildInterventionClause(input.intervention, input.comparator);

  const broadPopulation = buildBroadClause(input.population);
  const broadOutcome = buildBroadClause(input.outcome);
  const broadIntervention = [buildBroadClause(input.intervention), buildBroadClause(input.comparator)]
    .filter(Boolean)
    .join(" OR ");

  const ordered = [
    [population, intervention, outcome].filter(Boolean).join(" AND "),
    [population, intervention].filter(Boolean).join(" AND "),
    [intervention, outcome].filter(Boolean).join(" AND "),
    [population, outcome].filter(Boolean).join(" AND "),
    intervention,
    population,
    outcome,
    [broadPopulation, broadIntervention && `(${broadIntervention})`, broadOutcome]
      .filter(Boolean)
      .join(" AND ")
  ];

  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const candidate of ordered) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  return candidates;
}

/**
 * Stable cache key for a request, independent of which candidate ladder rung eventually matched.
 *
 * Built from the sanitized input only: the NCBI API key must never reach a cache key, because
 * keys outlive requests and would otherwise be readable from any cache introspection.
 */
export function buildCacheKey(input: ClinicalSearchInput): string {
  return [
    sanitizePhrase(input.population),
    sanitizePhrase(input.outcome),
    sanitizePhrase(input.intervention),
    sanitizePhrase(input.comparator)
  ].join("\u0000");
}