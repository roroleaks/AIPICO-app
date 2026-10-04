// Explicit `.ts` extension keeps this module importable by the Node test runner, which
// does not apply the bundler's extensionless resolution.
import { KB } from "./kb.ts";
import {
  parseClinicalKeywords,
  validateKeywords,
  keywordCountHint,
  resolveCorrections,
  keywordsToString,
  correctionKey,
  type ParsedKeywords,
  type KeywordCorrection,
  type CorrectionRecord
} from "./clinical-keywords.ts";

/**
 * Live clinical vocabulary taken from the knowledge base, so a term added to `KB` is
 * immediately recognized as a single logical keyword without editing the parser.
 */
export function clinicalVocab(): string[] {
  const out: string[] = [];
  for (const spec of Object.values(KB)) {
    out.push(...spec.conditions, ...spec.interventions, ...spec.outcomesRanked, ...spec.terminology);
    for (const rule of spec.outcomeRules) {
      out.push(rule.primary, ...(rule.alternatives || []), ...rule.keywords);
    }
  }
  return out;
}

export interface ClinicalInput {
  rawInput: string;
  keywords: string[];
  normalizedKeywords: string[];
  /** Full audit trail of every suggestion the user decided, oldest first. */
  corrections: CorrectionRecord[];
  /** Suggestions still awaiting an Apply/Keep decision. */
  pendingCorrections: KeywordCorrection[];
}

/** Parse using the knowledge-base vocabulary layered on top of the built-in dictionary. */
export function parseInput(input: string): ParsedKeywords {
  return parseClinicalKeywords(input, clinicalVocab());
}

/**
 * Serialized session payload. The canonical comma-joined string is what downstream consumes.
 * The full correction history is retained for audit; applied corrections are never dropped
 * from it, only from the pending list.
 */
export function toSessionInput(parsed: ParsedKeywords, rawInput: string): ClinicalInput {
  return {
    rawInput: rawInput.trim().replace(/\s+/g, " "),
    keywords: parsed.rawTokens,
    normalizedKeywords: parsed.normalizedTokens,
    corrections: parsed.history,
    pendingCorrections: parsed.corrections
  };
}

/** The normalized string handed to PICO formulation and evidence search. */
export function sessionSearchText(input: ClinicalInput): string {
  return keywordsToString(input.normalizedKeywords);
}

/** Defensive coercion for correction arrays read back from storage. */
function normalizeCorrectionRecords(value: unknown): CorrectionRecord[] {
  if (!Array.isArray(value)) return [];
  const out: CorrectionRecord[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.from !== "string" || typeof e.to !== "string") continue;
    if (!e.from || !e.to) continue;
    out.push({
      from: e.from,
      to: e.to,
      kind: e.kind === "typo" ? "typo" : "alias",
      decision: e.decision === "kept" ? "kept" : "applied"
    });
  }
  return out;
}

/**
 * Read session data written by older builds, which stored only the raw string.
 * Accepts `string` or the current `ClinicalInput` object shape.
 */
export function readSessionInput(stored: unknown): ClinicalInput | null {
  if (typeof stored === "string") {
    const trimmed = stored.trim();
    if (!trimmed) return null;
    const parsed = parseInput(trimmed);
    return toSessionInput(parsed, trimmed);
  }
  if (stored && typeof stored === "object") {
    const obj = stored as Partial<ClinicalInput> & Record<string, unknown>;
    const normalized = Array.isArray(obj.normalizedKeywords) ? obj.normalizedKeywords : [];
    if (normalized.length) {
      return {
        rawInput: typeof obj.rawInput === "string" ? obj.rawInput : "",
        keywords: Array.isArray(obj.keywords) ? obj.keywords : normalized,
        normalizedKeywords: normalized,
        // Older builds stored only `{from,to}` pairs with no decision; those are treated as
        // applied, which is what that build did, so behaviour is unchanged on upgrade.
        corrections: normalizeCorrectionRecords(obj.corrections),
        pendingCorrections: normalizeCorrectionRecords(obj.pendingCorrections)
      };
    }
    // Object written but without keywords: fall back to the legacy string field.
    if (typeof obj.rawInput === "string" && obj.rawInput.trim()) {
      return readSessionInput(obj.rawInput);
    }
  }
  return null;
}

export { validateKeywords, keywordCountHint, resolveCorrections, keywordsToString, correctionKey };
export type { KeywordCorrection, CorrectionRecord, ParsedKeywords };
