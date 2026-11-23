/**
 * Concept Map and Query Construction for AIPICO v5.
 *
 * Implements concept blocks, MeSH descriptors, synonym expansions,
 * and high-level evidence design filters (D-05).
 */

import { MESH_DESCRIPTORS, HUMAN_SUBJECT_FILTER, sanitizePhrase } from "./pubmed-query.ts";

export interface ConceptEntry {
  canonical: string;
  aliases: string[];
  block: string;
  isAiMl?: boolean;
}

export const CONCEPT_MAP: ConceptEntry[] = [
  {
    canonical: "artificial intelligence",
    aliases: [
      "artificial intelligence",
      "ai",
      "machine learning",
      "deep learning",
      "neural network",
      "neural networks",
      "deep neural network",
      "deep neural networks",
      "computer vision",
      "idascore",
      "kidscore"
    ],
    block: '"artificial intelligence"[MeSH] OR "machine learning"[MeSH] OR "deep learning" OR "neural network" OR "iDAScore" OR "KIDScore"',
    isAiMl: true
  },
  {
    canonical: "embryo selection",
    aliases: [
      "embryo selection",
      "embryo assessment",
      "embryo ranking",
      "embryo grading",
      "blastocyst",
      "blastocyst selection",
      "blastocyst evaluation",
      "time-lapse",
      "time-lapse imaging",
      "time lapse"
    ],
    block: '"embryo selection" OR blastocyst OR "embryo assessment" OR "embryo ranking" OR "time-lapse"'
  },
  {
    canonical: "ivf",
    aliases: [
      "ivf",
      "in vitro fertilization",
      "in-vitro fertilization",
      "fertilization in vitro",
      "icsi",
      "intracytoplasmic sperm injection",
      "assisted reproduction",
      "assisted reproductive technology",
      "art"
    ],
    block: '"fertilization in vitro"[MeSH] OR IVF OR ICSI OR "assisted reproduction"'
  },
  {
    canonical: "morphology",
    aliases: [
      "morphology",
      "conventional morphology",
      "standard morphology",
      "gardner grading",
      "gardner criteria",
      "morphological assessment",
      "morphological grading"
    ],
    block: 'morphology OR "Gardner grading" OR "morphological assessment"'
  },
  {
    canonical: "live birth",
    aliases: [
      "live birth",
      "live birth rate",
      "lbr",
      "cumulative live birth",
      "cumulative live birth rate",
      "clbr"
    ],
    block: '"live birth"[MeSH] OR "live birth rate" OR "cumulative live birth"'
  },
  {
    canonical: "clinical pregnancy",
    aliases: [
      "clinical pregnancy",
      "clinical pregnancy rate",
      "cpr",
      "ongoing pregnancy",
      "ongoing pregnancy rate"
    ],
    block: '"pregnancy rate"[MeSH] OR "clinical pregnancy rate" OR "ongoing pregnancy rate"'
  },
  {
    canonical: "poor ovarian response",
    aliases: [
      "poor ovarian response",
      "poor responders",
      "poor responder",
      "por",
      "diminished ovarian reserve",
      "dor"
    ],
    block: '"ovarian reserve"[MeSH] OR "poor ovarian response" OR "poor responders" OR "diminished ovarian reserve"'
  },
  {
    canonical: "short cervix",
    aliases: [
      "short cervix",
      "cervical insufficiency",
      "cervical length",
      "short cervical length"
    ],
    block: '"cervix uteri"[MeSH] OR "uterine cervical length"[MeSH] OR "short cervix" OR "cervical insufficiency"'
  },
  {
    canonical: "cervical cerclage",
    aliases: [
      "cervical cerclage",
      "cerclage",
      "uterine cerclage"
    ],
    block: '"cervical cerclage"[MeSH] OR "cervical cerclage" OR cerclage'
  },
  {
    canonical: "preterm birth",
    aliases: [
      "preterm birth",
      "premature birth",
      "preterm labor",
      "preterm delivery"
    ],
    block: '"premature birth"[MeSH] OR "obstetric labor, premature"[MeSH] OR "preterm birth"'
  },
  {
    canonical: "growth hormone",
    aliases: [
      "growth hormone",
      "gh",
      "adjuvant growth hormone"
    ],
    block: '"growth hormone"[MeSH] OR "growth hormone" OR "GH"'
  }
];

export const TERM_EXPANSIONS: Record<string, string> = {
  pcos: "polycystic ovary syndrome",
  ohss: "ovarian hyperstimulation syndrome",
  rpl: "recurrent pregnancy loss",
  rif: "recurrent implantation failure",
  "pgt-a": "preimplantation genetic testing",
  pgta: "preimplantation genetic testing",
  amh: "anti-mullerian hormone",
  fsh: "follicle stimulating hormone",
  lh: "luteinizing hormone",
  coq10: "coenzyme Q10",
  dhea: "dehydroepiandrosterone",
  prp: "platelet-rich plasma"
};

/**
 * Checks whether the input terms contain artificial intelligence / machine learning concepts.
 */
export function isAiMlQuery(terms: string | string[]): boolean {
  const text = Array.isArray(terms) ? terms.join(" ") : terms;
  const clean = text.toLowerCase();
  const aiKeywords = [
    "artificial intelligence",
    "machine learning",
    "deep learning",
    "neural network",
    "idascore",
    "kidscore",
    "computer vision",
    "automated embryo",
    "algorithm"
  ];
  if (aiKeywords.some(kw => clean.includes(kw))) return true;
  // Exact standalone token 'ai'
  return /\bai\b/i.test(clean);
}

/**
 * Builds a concept block for a single term, leveraging mapped synonyms and MeSH terms.
 */
export function buildConceptBlock(rawTerm: string): string {
  const sanitized = sanitizePhrase(rawTerm);
  if (!sanitized) return "";

  const lower = sanitized.toLowerCase();
  const expanded = TERM_EXPANSIONS[lower] || lower;

  // 1. Direct or alias match in CONCEPT_MAP
  for (const entry of CONCEPT_MAP) {
    if (entry.aliases.some(alias => lower === alias || expanded === alias)) {
      return `(${entry.block})`;
    }
  }

  // 2. Sub-phrase match in CONCEPT_MAP (e.g. "artificial intelligence embryo selection" contains both concepts)
  const matchedBlocks: string[] = [];
  for (const entry of CONCEPT_MAP) {
    for (const alias of entry.aliases) {
      if (alias.length >= 4 && lower.includes(alias)) {
        if (!matchedBlocks.includes(entry.block)) {
          matchedBlocks.push(entry.block);
        }
        break;
      }
    }
  }

  if (matchedBlocks.length > 0) {
    // If multiple concept blocks are identified within a multi-term phrase, intersect them
    if (matchedBlocks.length === 1) {
      return `(${matchedBlocks[0]})`;
    }
    return `(${matchedBlocks.map(b => `(${b})`).join(" AND ")})`;
  }

  // 3. Check MESH_DESCRIPTORS in pubmed-query.ts
  const meshDirect = MESH_DESCRIPTORS[lower] || MESH_DESCRIPTORS[expanded];
  if (meshDirect && meshDirect.length > 0) {
    const meshTerms = meshDirect.map(m => `"${m}"[MeSH Terms]`).join(" OR ");
    return `("${sanitized}"[tiab] OR ${meshTerms})`;
  }

  // 4. Default: quoted [tiab] phrase
  return `"${sanitized}"[tiab]`;
}

export const HIGH_EVIDENCE_DESIGN_FILTER =
  "(randomized controlled trial[pt] OR systematic review[pt] OR meta-analysis[pt])";

export interface PicoQueryOptions {
  includeComparator?: boolean;
  includeOutcome?: boolean;
  designFilter?: boolean;
  humanFilter?: boolean;
}

/**
 * Builds a structured PICO query block:
 * block(P) AND block(I) [AND block(C) optional]
 * Outcome terms are excluded by default at Level 0 for ranking purposes rather than hard exclusion (D-05).
 */
export function buildPicoQuery(
  words: Array<{ word: string; role?: string }>,
  options: PicoQueryOptions = {}
): string {
  const pWords = words.filter(w => w.role === "population");
  const iWords = words.filter(w => w.role === "intervention");
  const cWords = words.filter(w => w.role === "comparator");
  const oWords = words.filter(w => w.role === "outcome");

  const pBlocks = pWords.map(w => buildConceptBlock(w.word)).filter(Boolean);
  const iBlocks = iWords.map(w => buildConceptBlock(w.word)).filter(Boolean);
  const cBlocks = (options.includeComparator !== false ? cWords : [])
    .map(w => buildConceptBlock(w.word))
    .filter(Boolean);
  const oBlocks = (options.includeOutcome ? oWords : [])
    .map(w => buildConceptBlock(w.word))
    .filter(Boolean);

  const mainBlocks: string[] = [];

  if (pBlocks.length > 0) {
    mainBlocks.push(pBlocks.length === 1 ? pBlocks[0]! : `(${pBlocks.join(" OR ")})`);
  }
  if (iBlocks.length > 0) {
    mainBlocks.push(iBlocks.length === 1 ? iBlocks[0]! : `(${iBlocks.join(" OR ")})`);
  }
  if (cBlocks.length > 0) {
    mainBlocks.push(cBlocks.length === 1 ? cBlocks[0]! : `(${cBlocks.join(" OR ")})`);
  }
  if (oBlocks.length > 0) {
    mainBlocks.push(oBlocks.length === 1 ? oBlocks[0]! : `(${oBlocks.join(" OR ")})`);
  }

  // Fallback if no roles matched
  if (mainBlocks.length === 0) {
    const fallback = words.map(w => buildConceptBlock(w.word)).filter(Boolean);
    if (fallback.length > 0) {
      mainBlocks.push(fallback.join(" AND "));
    }
  }

  let query = mainBlocks.join(" AND ");

  if (options.designFilter) {
    query = `(${query}) AND ${HIGH_EVIDENCE_DESIGN_FILTER}`;
  }

  if (options.humanFilter !== false) {
    query = `(${query}) ${HUMAN_SUBJECT_FILTER}`;
  }

  return query;
}
