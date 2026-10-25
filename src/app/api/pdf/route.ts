import { NextResponse } from "next/server";
import { z } from "zod";
import { validateDeliverableIntegrity } from "@/lib/deliverable-integrity";
import type { AuditableRef } from "@/lib/relevance";
import { buildPdfBuffer } from "@/lib/pdf-generator";
import { provenanceSchema } from "@/lib/provenance";

export const runtime = "nodejs";
export const maxDuration = 20;

const picoRowSchema = z.object({
  label: z.string().max(200),
  value: z.string().max(1000),
});

const pdfSectionSchema = z.object({
  heading: z.string().max(200).optional().nullable(),
  blocks: z.array(z.string().max(10000)),
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
  source: z.string().max(100).optional().nullable(),
  crossrefId: z.string().max(100).optional().nullable(),
  openAlexId: z.string().max(100).optional().nullable(),
});

const pdfPayloadSchema = z.object({
  docType: z.string().max(100).optional().nullable(),
  title: z.string().min(1).max(500),
  meta: z.string().max(500).optional().nullable(),
  citationStyle: z.enum(["vancouver", "apa", "harvard"]).optional().nullable(),
  pico: z.array(picoRowSchema).optional().nullable(),
  outcomes: z.array(z.string().max(500)).optional().nullable(),
  keywords: z.array(z.string().max(100)).optional().nullable(),
  sections: z.array(pdfSectionSchema).optional().nullable(),
  references: z.array(z.string().max(2000)).optional().nullable(),
  retainedReferences: z.array(auditableRefSchema).optional().nullable(),
  provenance: provenanceSchema.optional().nullable(),
});

const BODY_MAX = 400_000;

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (!raw || raw.length > BODY_MAX) {
      return NextResponse.json({ error: "Payload too large or empty." }, { status: 400 });
    }
    // Malformed JSON is a client error. Letting JSON.parse throw into the outer catch reported
    // it as HTTP 500 "PDF generation failed", which told the caller to retry a request that
    // could never succeed and buried the real cause in server logs.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
    }

    const parseResult = pdfPayloadSchema.safeParse(parsed);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid parameters: " + parseResult.error.issues.map(e => e.message).join(", ") },
        { status: 400 }
      );
    }
    const body = parseResult.data;

    // A caller that asks for a document with neither narrative sections nor references is asking
    // for a titled PDF with no content, which is misleading rather than merely empty. This must
    // not depend on whether `references` was sent as [] or omitted entirely: the two mean the
    // same thing to the reader, so they are treated the same way here. Exports that legitimately
    // have no references, such as the evidence map, carry sections and are unaffected.
    const hasReferences = Array.isArray(body.references) && body.references.length > 0;
    const hasSections = Array.isArray(body.sections) && body.sections.length > 0;
    if (!hasReferences && !hasSections) {
      return NextResponse.json(
        { error: "No references or sections available to export." },
        { status: 400 }
      );
    }
    // Server-side half of the parity gate. The browser already checks this, but the browser is
    // not the trust boundary: a caller can post to this endpoint directly, and a PDF is the most
    // durable and most citable artifact this app produces. Every reference emitted must be
    // accountable to a retained record the claim filter approved.
    if (Array.isArray(body.references) && body.references.length > 0) {
      const integrity = validateDeliverableIntegrity({
        fields: {},
        references: body.references,
        retainedRecords: Array.isArray(body.retainedReferences) ? (body.retainedReferences as unknown as AuditableRef[]) : [],
        exportReferences: body.references
      });
      if (!integrity.ok) {
        return NextResponse.json(
          {
            error: integrity.malformedReferences.length
              ? "Export refused: the reference list contained malformed entries."
              : "Export refused: references did not match the validated evidence set.",
            integrity
          },
          { status: 422 }
        );
      }
    }

    const title = String(body.title).trim();
    const pdf = await buildPdfBuffer(body);
    const safe = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "document";

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safe}.pdf"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (e) {
    console.error("PDF generation failed:", e);
    return NextResponse.json({ error: "PDF generation failed. Please retry." }, { status: 500 });
  }
}
