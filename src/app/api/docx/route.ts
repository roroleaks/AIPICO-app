import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { z } from "zod";
import { validateDeliverableIntegrity } from "@/lib/deliverable-integrity.ts";
import { provenanceSchema } from "@/lib/provenance.ts";
import { buildDocxBuffer, buildWorkflowDocx } from "@/lib/docx-generator.ts";
import type { CitationStyle } from "@/lib/citation-formatter.ts";
import type { AuditableRef } from "@/lib/relevance.ts";
import { isAllowedOrigin, corsHeaders } from "@/lib/security-headers";
import { checkRateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";
export const maxDuration = 25;

const picoRowSchema = z.object({
  label: z.string().max(200),
  value: z.string().max(1000)
});

const docxSectionSchema = z.object({
  heading: z.string().max(200).optional().nullable(),
  blocks: z.array(z.string().max(10000))
});

const auditableRefSchema = z.object({
  pmid: z.string().max(50).optional().nullable(),
  title: z.string().max(1000),
  authors: z.string().max(1000).optional().nullable(),
  year: z.string().max(50).optional().nullable(),
  journal: z.string().max(500).optional().nullable(),
  doi: z.string().max(500).optional().nullable(),
  url: z.string().max(1000).optional().nullable(),
  context: z.string().max(20000).optional().nullable(),
  source: z.string().max(100).optional().nullable()
});

const workflowWordSchema = z.object({
  word: z.string().min(1).max(80),
  role: z.enum(["population", "intervention", "comparator", "outcome"])
});

const workflowScreeningStatsSchema = z.object({
  retrieved: z.number().int().nonnegative(),
  screened: z.number().int().nonnegative(),
  relaxationLevel: z.number().int().min(0).max(2),
  excludedCount: z.number().int().nonnegative()
});

const workflowPaperSchema = z.object({
  rank: z.number().int().positive(),
  relevancePct: z.number().int().min(0).max(100),
  title: z.string(),
  authors: z.string(),
  journal: z.string(),
  year: z.string(),
  design: z.string(),
  matchedElements: z.array(z.string())
});

const workflowSchema = z.object({
  words: z.array(workflowWordSchema).min(3).max(5),
  category: z.enum(["established", "conflicting", "gap"]),
  phrase: z.string().min(1).max(240),
  screeningStats: workflowScreeningStatsSchema,
  papers: z.array(workflowPaperSchema).max(50)
});

const docxPayloadSchema = z.object({
  title: z.string().min(1).max(500).optional().nullable(),
  meta: z.string().max(500).optional().nullable(),
  citationStyle: z.enum(["vancouver", "apa", "harvard"]).default("vancouver"),
  pico: z.array(picoRowSchema).optional().nullable(),
  outcomes: z.array(z.string().max(500)).optional().nullable(),
  keywords: z.array(z.string().max(100)).optional().nullable(),
  sections: z.array(docxSectionSchema).optional().nullable(),
  references: z.array(z.string().max(2000)).optional().nullable(),
  retainedReferences: z.array(auditableRefSchema).optional().nullable(),
  provenance: provenanceSchema.optional().nullable(),
  workflow: workflowSchema.optional().nullable()
});

/** Handle CORS preflight for /api/docx */
export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin");
  if (isAllowedOrigin(origin)) {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin!) });
  }
  return new NextResponse(null, { status: 403 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin");
  const cors = isAllowedOrigin(origin) ? corsHeaders(origin!) : {};

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
  const limit = await checkRateLimit(ip, "docx", 10, 60);
  if (!limit.success) {
    return NextResponse.json(
      { error: "Too many requests. Please wait and try again." },
      {
        status: 429,
        headers: {
          ...cors,
          "Retry-After": String(Math.ceil((limit.reset - Date.now()) / 1000)),
        },
      }
    );
  }

  try {
    const raw = await req.text();
    if (!raw || raw.length > 500_000) {
      return NextResponse.json({ error: "Payload too large or empty." }, { status: 400, headers: cors });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400, headers: cors });
    }

    const parseResult = docxPayloadSchema.safeParse(parsed);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid parameters: " + parseResult.error.issues.map(e => e.message).join(", ") },
        { status: 400, headers: cors }
      );
    }

    const body = parseResult.data;

    if (body.workflow) {
      const buffer = await buildWorkflowDocx(body.workflow);
      const safeTitle = body.workflow.phrase
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "workflow-summary";

      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          ...cors,
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${safeTitle}.docx"`,
          "Cache-Control": "no-store"
        }
      });
    }

    if (!body.title) {
      return NextResponse.json({ error: "Document title is required." }, { status: 400, headers: cors });
    }

    const style: CitationStyle = body.citationStyle || "vancouver";
    const records = (body.retainedReferences || []) as AuditableRef[];

    // Deliverable integrity parity gate
    if (body.references?.length || body.retainedReferences?.length) {
      const integrity = validateDeliverableIntegrity({
        title: body.title,
        sections: (body.sections || []).map(s => ({
          heading: s.heading || undefined,
          blocks: s.blocks
        })),
        references: body.references || [],
        retainedReferences: records,
        citationStyle: style
      });
      if (!integrity.ok) {
        return NextResponse.json(
          {
            error: integrity.malformedReferences.length
              ? "Export refused: the reference list contained malformed entries."
              : "Export refused: references did not match the validated evidence set.",
            integrity
          },
          { status: 422, headers: cors }
        );
      }
    }

    const buffer = await buildDocxBuffer(body);
    const safeTitle = body.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "clinical-commentary";

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        ...cors,
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeTitle}.docx"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (err) {
    console.error("DOCX generation error:", err);
    return NextResponse.json({ error: "Failed to generate Word document." }, { status: 500, headers: cors });
  }
}
