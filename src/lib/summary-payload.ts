import type { PicoWord } from "./pico-roles";
import type { ScreenPayload } from "./deterministic-screen";
import type { ExploreRecord } from "./explore-scoring";
import type { ExcludedState } from "./session";
import type { WorkflowExportData } from "./docx-generator";
import type { ManuscriptData } from "./manuscript-composer";
import { designOf } from "./relevance.ts";

export interface ExploreSnapshot {
  records: ExploreRecord[];
  corpusStats: {
    retrieved: number;
    screened: number;
    blocked: number;
    returned: number;
  };
  hasMore: boolean;
  phrase?: string;
  category?: string;
}

export interface ChoiceState {
  category: "established" | "conflicting" | "gap";
  phrase: string;
}

export const ELEMENT_LABELS: Record<string, string> = {
  P: "Population",
  I: "Intervention",
  C: "Comparator",
  O: "Outcome"
};

/**
 * Builds the canonical workflow export data from session snapshots.
 * Single source of truth for both display and document export.
 */
export function buildSummaryPayload(
  words: PicoWord[],
  choice: ChoiceState,
  screenSnapshot: ScreenPayload | null,
  exploreSnapshot: ExploreSnapshot | null,
  excludedState: ExcludedState | null,
  manuscript?: ManuscriptData | null
): WorkflowExportData {
  const records = exploreSnapshot?.records || [];
  const papers = records.map((r, idx) => ({
    rank: idx + 1,
    relevancePct: r.relevancePct,
    title: r.title,
    authors: r.authors || "",
    journal: r.journal || "",
    year: r.year || "",
    design: designOf(r.title || "", r.journal || "") || "Observational study",
    matchedElements: (r.matchedElements || []).map(code => ELEMENT_LABELS[code] || code)
  }));

  const retrieved = screenSnapshot?.corpusStats?.retrieved ?? exploreSnapshot?.corpusStats?.retrieved ?? 0;
  const screened = screenSnapshot?.corpusStats?.screened ?? exploreSnapshot?.corpusStats?.screened ?? 0;
  const relaxationLevel = screenSnapshot?.corpusStats?.relaxationLevel ?? 0;
  const excludedCount = excludedState?.userExcluded?.length ?? 0;

  const base: WorkflowExportData = {
    words: words.map(w => ({
      word: w.word,
      role: w.role
    })),
    category: choice.category,
    phrase: choice.phrase,
    screeningStats: {
      retrieved,
      screened,
      relaxationLevel,
      excludedCount
    },
    papers
  };

  if (manuscript) {
    base.title = manuscript.title;
    base.abstract = manuscript.abstract;
    base.sections = manuscript.sections;
    base.references = manuscript.references;
    base.citationStyle = manuscript.citationStyle;
    base.aiEnriched = manuscript.aiEnriched;
  }

  return base;
}
