import { z } from "zod";

export interface ProvenanceMetadata {
  retrievedAt?: string | null;
  queryStrings?: string[] | string | null;
  sources?: string[] | string | null;
  engine?: string | null;
  promptVersion?: string | null;
  buildCommit?: string | null;
}

export const provenanceSchema = z.object({
  retrievedAt: z.string().max(100).optional().nullable(),
  queryStrings: z.union([z.string().max(2000), z.array(z.string().max(2000))]).optional().nullable(),
  sources: z.union([z.string().max(500), z.array(z.string().max(500))]).optional().nullable(),
  engine: z.string().max(200).optional().nullable(),
  promptVersion: z.string().max(100).optional().nullable(),
  buildCommit: z.string().max(100).optional().nullable()
});

/**
 * Resolves provenance values, avoiding hardcoded values when runtime sources exist.
 */
export function resolveProvenance(input?: Partial<ProvenanceMetadata> | null): ProvenanceMetadata {
  const commit = input?.buildCommit ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    process.env.BUILD_COMMIT ||
    "development";

  const engine = input?.engine ||
    (process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY
      ? `${process.env.LLM_MODEL || "gemini-2.0-flash"} (LLM API)`
      : "rules (deterministic-rules)");

  const promptVer = input?.promptVersion || "pico-commentary-v3.1";

  const sources = input?.sources || [
    "PubMed / NCBI E-utilities (MEDLINE)",
    "Local Clinical Knowledge Base (KB)"
  ];

  return {
    retrievedAt: input?.retrievedAt || new Date().toISOString(),
    queryStrings: input?.queryStrings || [],
    sources,
    engine,
    promptVersion: promptVer,
    buildCommit: commit
  };
}
