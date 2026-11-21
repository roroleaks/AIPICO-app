import type { PicoWord } from "./pico-roles.ts";
import type { ExploreRecord } from "./explore-scoring.ts";
import type { CitationStyle } from "./citation-formatter.ts";
import { formatInTextAuthors, parseAuthors } from "./citation-formatter.ts";
import { designOf, type AuditableRef } from "./relevance.ts";

export interface ManuscriptScreeningStats {
  retrieved: number;
  screened: number;
  relaxationLevel: number;
  excludedCount: number;
}

export interface ManuscriptSection {
  heading: string;
  paragraphs: string[];
}

export interface ManuscriptData {
  title: string;
  abstract: string[];
  sections: ManuscriptSection[];
  references: string[];
  citationStyle: CitationStyle;
  aiEnriched?: boolean;
}

export interface ComposeManuscriptInput {
  words: PicoWord[];
  category: "established" | "conflicting" | "gap";
  phrase: string;
  screeningStats: ManuscriptScreeningStats;
  records: ExploreRecord[];
  userExcluded?: string[];
  style?: CitationStyle;
}

/**
 * Format a reference without any URL, link, or http occurrence.
 */
export function formatPlainReference(
  rec: ExploreRecord | AuditableRef,
  style: CitationStyle,
  index?: number
): string {
  const isPreprint = rec.source === "preprint" || String(rec.pmid || "").startsWith("pre:");
  const isTrial = rec.source === "clinicaltrials" || String(rec.pmid || "").startsWith("ctg:");
  const badge = isPreprint ? " [preprint — not peer reviewed]" : isTrial ? " [trial registration — not evidence of effect]" : "";

  const title = rec.title ? `${rec.title.trim().replace(/\.$/, "")}${badge}.` : "Untitled study.";
  const journal = rec.journal ? `${rec.journal.trim().replace(/\.$/, "")}.` : "";
  const cleanDoi = rec.doi
    ? `doi:${rec.doi.replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:\s*/i, "").trim()}`
    : "";

  if (style === "vancouver") {
    const prefix = typeof index === "number" && index > 0 ? `${index}. ` : "";
    const authors = rec.authors ? `${rec.authors.trim().replace(/\.$/, "")}.` : "Anonymous.";
    const year = rec.year ? `${String(rec.year).trim()}.` : "";
    const core = [prefix + authors, title, journal ? `${journal} ${year}`.trim() : year, cleanDoi]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return core;
  }

  if (style === "apa") {
    const parsed = parseAuthors(rec.authors);
    let authorsFormatted = "Anonymous.";
    if (parsed.length === 1) {
      authorsFormatted = `${parsed[0].surname}${parsed[0].initials ? `, ${parsed[0].initials}.` : ""}`;
    } else if (parsed.length === 2) {
      const a1 = `${parsed[0].surname}${parsed[0].initials ? `, ${parsed[0].initials}.` : ""}`;
      const a2 = `${parsed[1].surname}${parsed[1].initials ? `, ${parsed[1].initials}.` : ""}`;
      authorsFormatted = `${a1}, & ${a2}`;
    } else if (parsed.length > 2) {
      const list = parsed.slice(0, 6).map(p => `${p.surname}${p.initials ? `, ${p.initials}.` : ""}`);
      if (parsed.length > 6) {
        authorsFormatted = `${list.join(", ")}, et al.`;
      } else {
        const allExceptLast = list.slice(0, -1).join(", ");
        const last = list[list.length - 1];
        authorsFormatted = `${allExceptLast}, & ${last}`;
      }
    }
    if (authorsFormatted && !authorsFormatted.endsWith(".")) authorsFormatted += ".";

    const year = rec.year ? `(${String(rec.year).trim()}).` : "(n.d.).";
    const core = [authorsFormatted, year, title, journal, cleanDoi]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return core;
  }

  // Harvard style
  const parsed = parseAuthors(rec.authors);
  let authorsFormatted = "Anonymous";
  if (parsed.length === 1) {
    authorsFormatted = `${parsed[0].surname}${parsed[0].initials ? `, ${parsed[0].initials.replace(/\./g, "")}` : ""}`;
  } else if (parsed.length === 2) {
    const a1 = `${parsed[0].surname}${parsed[0].initials ? `, ${parsed[0].initials.replace(/\./g, "")}` : ""}`;
    const a2 = `${parsed[1].surname}${parsed[1].initials ? `, ${parsed[1].initials.replace(/\./g, "")}` : ""}`;
    authorsFormatted = `${a1} and ${a2}`;
  } else if (parsed.length > 2) {
    authorsFormatted = `${parsed[0].surname}${parsed[0].initials ? `, ${parsed[0].initials.replace(/\./g, "")}` : ""} et al.`;
  }

  const year = rec.year ? `${String(rec.year).trim()}.` : "n.d.";
  const core = [`${authorsFormatted},`, year, title, journal, cleanDoi]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return core;
}

/**
 * Creates in-text citation string for a group of records according to style.
 */
function buildInTextCitation(
  recordsToCite: ExploreRecord[],
  style: CitationStyle,
  vancouverIndexMap: Map<string, number>
): string {
  if (recordsToCite.length === 0) return "";

  if (style === "vancouver") {
    const indices = recordsToCite
      .map(r => vancouverIndexMap.get(r.pmid || r.title))
      .filter((n): n is number => typeof n === "number");
    if (indices.length === 0) return "";
    return `[${indices.join(", ")}]`;
  }

  if (style === "apa") {
    const parts = recordsToCite.map(r => {
      const author = formatInTextAuthors(r.authors, "apa");
      const yr = r.year ? String(r.year).trim() : "n.d.";
      return `${author}, ${yr}`;
    });
    return `(${parts.join("; ")})`;
  }

  // Harvard
  const parts = recordsToCite.map(r => {
    const author = formatInTextAuthors(r.authors, "harvard");
    const yr = r.year ? String(r.year).trim() : "n.d.";
    return `${author} ${yr}`;
  });
  return `(${parts.join(", ")})`;
}

/**
 * Pure, deterministic composer for publication-grade scientific manuscripts.
 */
export function composeManuscript(input: ComposeManuscriptInput): ManuscriptData {
  const {
    words,
    category,
    phrase,
    screeningStats,
    records = [],
    userExcluded = [],
    style = "vancouver"
  } = input;

  // Filter out any excluded papers - strictly RETAINED records only
  const excludedSet = new Set(userExcluded.map(k => k.trim().toLowerCase()));
  const retained = records.filter(r => {
    const pmidKey = (r.pmid || "").trim().toLowerCase();
    const titleKey = (r.title || "").trim().toLowerCase();
    const doiKey = (r.doi || "").trim().toLowerCase();
    if (pmidKey && excludedSet.has(pmidKey)) return false;
    if (doiKey && excludedSet.has(doiKey)) return false;
    if (titleKey && excludedSet.has(titleKey)) return false;
    return true;
  });

  // Deterministic title template
  const cleanPhrase = phrase.replace(/\s+/g, " ").trim();
  const titleCategorySuffix: Record<string, string> = {
    established: "A Rapid Evidence Summary of Established Clinical Knowledge",
    conflicting: "A Rapid Evidence Summary of Conflicting Clinical Findings",
    gap: "A Rapid Evidence Summary of Identified Clinical Literature Gaps"
  };
  const title = `${cleanPhrase}: ${titleCategorySuffix[category] || titleCategorySuffix.established}`;

  // Partition retained records into relevance tiers
  const tier90 = retained.filter(r => r.relevancePct >= 90);
  const tier70 = retained.filter(r => r.relevancePct >= 70 && r.relevancePct < 90);
  const tierLow = retained.filter(r => r.relevancePct < 70);

  // Maintain Vancouver appearance order
  const vancouverOrder: ExploreRecord[] = [];
  const vancouverIndexMap = new Map<string, number>();

  const trackVancouver = (rec: ExploreRecord) => {
    const key = rec.pmid || rec.title;
    if (!vancouverIndexMap.has(key)) {
      vancouverOrder.push(rec);
      vancouverIndexMap.set(key, vancouverOrder.length);
    }
  };

  // Pre-seed Vancouver order by tier appearance
  for (const r of tier90) trackVancouver(r);
  for (const r of tier70) trackVancouver(r);
  for (const r of tierLow) trackVancouver(r);

  // Group designs for metadata synthesis
  const designCounts: Record<string, number> = {};
  for (const r of retained) {
    const d = designOf(r.title, r.journal || "") || "Observational study";
    designCounts[d] = (designCounts[d] || 0) + 1;
  }
  const designSummary = Object.entries(designCounts)
    .map(([d, cnt]) => `${cnt} ${d.toLowerCase()}`)
    .join(", ") || "no studies";

  // Section 1: Background
  const popWord = words.find(w => w.role === "population")?.word || "specified patients";
  const intWord = words.find(w => w.role === "intervention")?.word || "clinical intervention";
  const compWord = words.find(w => w.role === "comparator")?.word || "standard comparator";
  const outWord = words.find(w => w.role === "outcome")?.word || "primary clinical endpoints";

  const backgroundP1: Record<string, string> = {
    established: `In clinical decision-making, evaluating the efficacy and safety of ${intWord} in ${popWord} is essential to reinforce evidence-based guidelines. When compared with ${compWord}, therapeutic choices directly govern key patient-centered outcomes, notably ${outWord}. Synthesizing current consensus provides an objective benchmark for clinical practice.`,
    conflicting: `Clinical investigations addressing ${intWord} versus ${compWord} in ${popWord} have yielded heterogeneous and discordant findings. While selected trials report measurable improvements in ${outWord}, parallel studies observe neutral or contradictory results. Clarifying this conflicting body of literature is critical to mitigate practice variation and guide therapeutic selection.`,
    gap: `Significant uncertainty persists regarding the role of ${intWord} relative to ${compWord} in ${popWord}, specifically with respect to ${outWord}. Despite growing clinical interest, rigorously controlled studies remain sparse, leaving an evident gap in the clinical literature that complicates guideline formulation.`
  };

  const backgroundP2 = `This structured inquiry was parameterized into distinct clinical domains: Population (P): "${popWord}"; Intervention (I): "${intWord}"; Comparator (C): "${compWord}"; and Outcome (O): "${outWord}". By contextualizing these four facets within current literature indexes, this report characterizes the distribution, methodological consistency, and clinical readiness of available evidence.`;

  // Section 2: Search strategy and screening
  const searchP1 = `A structured multi-database evidence retrieval protocol was conducted across indexed biomedical repositories including PubMed/MEDLINE, Europe PMC, OpenAlex, and Cochrane Central. The search architecture utilized normalized PICO keywords: ${words.map(w => `${w.role.toUpperCase()} "${w.word}"`).join(", ")}.`;
  const searchP2 = `The initial query ladder retrieved ${screeningStats.retrieved} records. Automated title/abstract relevance screening evaluated ${screeningStats.screened} records at search relaxation level ${screeningStats.relaxationLevel}. During exploratory screening, ${screeningStats.excludedCount} record(s) were excluded based on study design or tangential relevance criteria, leaving ${retained.length} prioritized record(s) retained for formal synthesis.`;

  // Section 3: Evidence synthesis
  const synthesisParagraphs: string[] = [];
  if (retained.length === 0) {
    synthesisParagraphs.push(
      "Following screening and exploratory exclusion, zero records met the eligibility criteria for formal synthesis. Further primary trials or broadening of search terms may be required to characterize this clinical question."
    );
  } else {
    // Overview of evidence map
    const years = retained.map(r => parseInt(r.year || "0", 10)).filter(y => y > 1900);
    const minYear = years.length ? Math.min(...years) : null;
    const maxYear = years.length ? Math.max(...years) : null;
    const yearRangeStr = minYear && maxYear ? `spanning from ${minYear} to ${maxYear}` : "from recent publication years";
    const journalSet = new Set(retained.map(r => r.journal).filter(Boolean));
    const journalCount = journalSet.size;

    synthesisParagraphs.push(
      `The prioritized evidence base comprises ${retained.length} retained study record(s) ${yearRangeStr} across ${journalCount} peer-reviewed journal venue(s). Methodological designs include ${designSummary}. Records were stratified into three relevance tiers based on calculated term-density and semantic alignment with the clinical PICO parameters.`
    );

    // Tier 1 (>=90%)
    if (tier90.length > 0) {
      const cite = buildInTextCitation(tier90, style, vancouverIndexMap);
      const studyDesc = tier90.map(r => `"${r.title}" (${r.journal || "Journal"}, ${r.year || "n.d."})`).join("; ");
      synthesisParagraphs.push(
        `High-relevance evidence (≥90% alignment, n = ${tier90.length}) directly addresses the clinical query with explicit co-occurrence of the evaluated intervention and primary endpoints ${cite}. Key investigations in this tier include ${studyDesc}. These studies offer direct comparative observations concerning ${outWord} in ${popWord}.`
      );
    }

    // Tier 2 (70-89%)
    if (tier70.length > 0) {
      const cite = buildInTextCitation(tier70, style, vancouverIndexMap);
      const studyDesc = tier70.map(r => `"${r.title}" (${r.year || "n.d."})`).join("; ");
      synthesisParagraphs.push(
        `Moderate-relevance evidence (70–89% alignment, n = ${tier70.length}) provides supportive context, contributing comparative or observational perspectives across related populations ${cite}. Contributing records include ${studyDesc}, providing supplementary insights into treatment safety and secondary endpoints.`
      );
    }

    // Tier 3 (<70%)
    if (tierLow.length > 0) {
      const cite = buildInTextCitation(tierLow, style, vancouverIndexMap);
      synthesisParagraphs.push(
        `Exploratory and peripheral citations (<70% alignment, n = ${tierLow.length}) reflect broader investigative settings or preliminary cohorts ${cite}. While less directly aligned with all four PICO facets, these records provide valuable contextual grounding for physiological mechanisms and potential confounders.`
      );
    }
  }

  // Section 4: Limitations
  const limitationsParagraphs: string[] = [
    `This evidence synthesis is subject to specific methodological boundaries. First, the scope is strictly constrained to the four defined PICO parameters, potentially omitting adjacent clinical variations. Second, initial screening was conducted at the title and abstract metadata level, which may overlook detailed subgroup findings documented only within full-text reports.`
  ];
  const limP2Parts = [
    `${screeningStats.excludedCount} record(s) were excluded during exploration based on metadata screening.`
  ];
  if (screeningStats.relaxationLevel > 0) {
    limP2Parts.push(
      `Search relaxation level ${screeningStats.relaxationLevel} was utilized during query ladder execution to expand candidate retrieval, which introduces broader publication designs.`
    );
  }
  limP2Parts.push(
    "Finally, non-indexed grey literature and unpublished negative trial registries were not exhaustively queried, which should be considered when interpreting overall evidence completeness."
  );
  limitationsParagraphs.push(limP2Parts.join(" "));

  // Section 5: Conclusion
  const conclusionP1: Record<string, string> = {
    established: `In conclusion, the synthesized evidence demonstrates consistent clinical backing for the defined PICO question. The prioritized studies corroborate established standards regarding ${intWord} in ${popWord}, indicating that anticipated outcomes for ${outWord} remain clinically reproducible when compared against ${compWord}.`,
    conflicting: `In conclusion, current evidence addressing ${intWord} in ${popWord} remains conflicting and heterogeneous. While favorable signals for ${outWord} are observed in selected cohorts, contradictory results underline the necessity of cautious, individualized patient assessment until definitive multi-center trials resolve the discordant findings.`,
    gap: `In conclusion, a discernible evidence gap characterizes the clinical question of ${intWord} versus ${compWord} in ${popWord}. The scarcity of sufficiently powered prospective data on ${outWord} underscores the urgent need for dedicated primary clinical trials to substantiate therapeutic decisions.`
  };

  const conclusionP2 = `Recommended clinical research workup: Investigators should conduct full-text appraisal of all prioritized citations, execute standardized risk-of-bias evaluation (e.g., Cochrane RoB 2 or ROBINS-I), register prospective systematic reviews with PROSPERO, and establish defined cohort monitoring protocols.\n\n[Author note: Insert specific institutional clinical rationale, patient subgroup considerations, or departmental audit targets here.]`;

  const sections: ManuscriptSection[] = [
    {
      heading: "Background",
      paragraphs: [backgroundP1[category] || backgroundP1.established, backgroundP2]
    },
    {
      heading: "Search strategy and screening",
      paragraphs: [searchP1, searchP2]
    },
    {
      heading: "Evidence synthesis",
      paragraphs: synthesisParagraphs
    },
    {
      heading: "Limitations",
      paragraphs: limitationsParagraphs
    },
    {
      heading: "Conclusion",
      paragraphs: [conclusionP1[category] || conclusionP1.established, conclusionP2]
    }
  ];

  // Abstract - 4 labeled sentences
  const absObjective = `Objective: To evaluate and synthesize available clinical evidence regarding the question: "${cleanPhrase}".`;
  const absMethods = `Methods: A structured search identified ${screeningStats.retrieved} records; ${screeningStats.screened} records were screened at search relaxation level ${screeningStats.relaxationLevel}, and ${screeningStats.excludedCount} record(s) were excluded during exploratory curation.`;
  const absResults = retained.length > 0
    ? `Results: A total of ${retained.length} prioritized record(s) met inclusion criteria across ${designSummary}, with ${tier90.length} study record(s) demonstrating ≥90% alignment with the clinical PICO parameters.`
    : `Results: Zero records met final eligibility criteria for formal synthesis following screening and exclusion filters.`;
  const absConclusion: Record<string, string> = {
    established: `Conclusion: Prioritized evidence demonstrates established clinical alignment with the investigated endpoints, supporting consistent clinical practice.`,
    conflicting: `Conclusion: Current findings reveal conflicting clinical results, underscoring the need for individualized clinical judgment and rigorous confirmatory trials.`,
    gap: `Conclusion: A substantial literature gap exists for this clinical question, warranting prospective randomized controlled trials to guide evidence-based practice.`
  };

  const abstract = [
    absObjective,
    absMethods,
    absResults,
    absConclusion[category] || absConclusion.established
  ];

  // Build references list formatted according to selected style
  let references: string[] = [];
  if (style === "vancouver") {
    // Vancouver order corresponds to first appearance
    references = vancouverOrder.map((r, idx) => formatPlainReference(r, "vancouver", idx + 1));
  } else {
    // APA and Harvard sort alphabetically by first author surname
    const sorted = [...retained].sort((a, b) => {
      const aName = (a.authors || "").toLowerCase();
      const bName = (b.authors || "").toLowerCase();
      return aName.localeCompare(bName);
    });
    references = sorted.map((r, idx) => formatPlainReference(r, style, idx + 1));
  }

  return {
    title,
    abstract,
    sections,
    references,
    citationStyle: style,
    aiEnriched: false
  };
}

/**
 * Counts total words across abstract and all section paragraphs.
 */
export function countManuscriptWords(m: { abstract?: string[]; sections?: ManuscriptSection[] }): number {
  let count = 0;
  if (Array.isArray(m.abstract)) {
    for (const sent of m.abstract) {
      count += sent.trim().split(/\s+/).filter(Boolean).length;
    }
  }
  if (Array.isArray(m.sections)) {
    for (const sec of m.sections) {
      for (const p of sec.paragraphs) {
        count += p.trim().split(/\s+/).filter(Boolean).length;
      }
    }
  }
  return count;
}

const EXPECTED_HEADINGS = [
  "Background",
  "Search strategy and screening",
  "Evidence synthesis",
  "Limitations",
  "Conclusion"
];

/**
 * Hard validation of LLM-enriched manuscript text before acceptance.
 * Discards the AI text and returns null on ANY integrity violation.
 */
export function validateEnrichedManuscript(
  rawLlm: unknown,
  deterministic: ManuscriptData,
  retained: ExploreRecord[],
  style: CitationStyle
): ManuscriptData | null {
  if (!rawLlm || typeof rawLlm !== "object") return null;
  const candidate = rawLlm as Record<string, unknown>;

  // 1. Validate sections structure
  if (!Array.isArray(candidate.sections) || candidate.sections.length !== EXPECTED_HEADINGS.length) {
    return null;
  }

  const validatedSections: ManuscriptSection[] = [];
  for (let i = 0; i < EXPECTED_HEADINGS.length; i++) {
    const sec = candidate.sections[i] as { heading?: unknown; paragraphs?: unknown };
    if (!sec || typeof sec !== "object") return null;
    const heading = typeof sec.heading === "string" ? sec.heading.trim() : "";
    if (heading.toLowerCase() !== EXPECTED_HEADINGS[i].toLowerCase()) {
      return null;
    }
    if (!Array.isArray(sec.paragraphs) || sec.paragraphs.length === 0) {
      return null;
    }
    const paragraphs: string[] = [];
    for (const p of sec.paragraphs) {
      if (typeof p !== "string" || !p.trim()) return null;
      paragraphs.push(p.trim());
    }
    validatedSections.push({ heading: EXPECTED_HEADINGS[i], paragraphs });
  }

  // 2. Validate abstract
  let validatedAbstract: string[] = [];
  if (Array.isArray(candidate.abstract)) {
    validatedAbstract = candidate.abstract.filter((s): s is string => typeof s === "string" && !!s.trim());
  } else if (typeof candidate.abstract === "string" && candidate.abstract.trim()) {
    validatedAbstract = candidate.abstract.split(/(?<=[.?!])\s+/).filter(Boolean);
  }
  if (validatedAbstract.length === 0 || validatedAbstract.length > 8) {
    return null;
  }

  // 3. Check for external URLs, DOIs or hyperlinks
  const allProse = [
    ...validatedAbstract,
    ...validatedSections.flatMap(s => s.paragraphs)
  ].join(" ");

  if (/https?:\/\/|www\./i.test(allProse)) {
    return null; // Zero external links permitted
  }

  // 4. Word-count sanity bound (0.5x to 1.75x of deterministic word count)
  const detWords = countManuscriptWords(deterministic);
  const aiWords = countManuscriptWords({ abstract: validatedAbstract, sections: validatedSections });
  if (detWords > 0) {
    if (aiWords < 0.5 * detWords || aiWords > 1.75 * detWords) {
      return null; // Runaway or overly truncated output rejected
    }
  }

  // 5. In-text citation integrity check
  if (style === "vancouver") {
    const bracketMatches = allProse.matchAll(/\[([\d\s,\-]+)\]/g);
    for (const match of bracketMatches) {
      const inner = match[1];
      const parts = inner.split(/[,;\-]+/);
      for (const part of parts) {
        const clean = part.trim();
        if (!clean) continue;
        const num = parseInt(clean, 10);
        if (isNaN(num) || num < 1 || num > retained.length) {
          return null; // Out of bounds citation marker
        }
      }
    }
  } else {
    // APA or Harvard: verify that cited author surnames match retained records
    const knownSurnames = new Set(
      retained.flatMap(r => parseAuthors(r.authors).map(a => a.surname.toLowerCase().replace(/[^a-z]/g, "")))
    );
    // Extract candidate citations within parentheses containing 4-digit years
    const parenMatches = allProse.matchAll(/\(([A-Za-z\s&,.\-']+?)(?:,|\s)\s*(\d{4}|n\.d\.)\)/g);
    for (const match of parenMatches) {
      const authorPart = match[1].toLowerCase();
      // Split by & or and or commas
      const names = authorPart.split(/\s+(?:&|and)\s+|,\s*/).map(s => s.replace(/\bet\s+al\.?/i, "").replace(/[^a-z]/g, "").trim()).filter(Boolean);
      for (const name of names) {
        if (name && !knownSurnames.has(name) && name !== "anonymous") {
          return null; // Invented or unverified author citation
        }
      }
    }
  }

  const title = typeof candidate.title === "string" && candidate.title.trim()
    ? candidate.title.trim()
    : deterministic.title;

  return {
    title,
    abstract: validatedAbstract,
    sections: validatedSections,
    references: deterministic.references,
    citationStyle: style,
    aiEnriched: true
  };
}
