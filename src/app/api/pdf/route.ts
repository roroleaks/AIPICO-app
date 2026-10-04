import { NextResponse } from "next/server";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { validateDeliverableIntegrity } from "@/lib/deliverable-integrity";
import type { AuditableRef } from "@/lib/relevance";

export const runtime = "nodejs";
export const maxDuration = 20;

interface PicoRow { label: string; value: string }
interface PdfSection { heading?: string; blocks: string[] }

interface PdfPayload {
  docType?: string;
  title?: string;
  meta?: string;
  pico?: PicoRow[];
  outcomes?: string[];
  keywords?: string[];
  sections?: PdfSection[];
  references?: string[];
  /** The retained records behind `references`, so the export can be checked server-side. */
  retainedReferences?: AuditableRef[];
}

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
  pico: z.array(picoRowSchema).optional().nullable(),
  outcomes: z.array(z.string().max(500)).optional().nullable(),
  keywords: z.array(z.string().max(100)).optional().nullable(),
  sections: z.array(pdfSectionSchema).optional().nullable(),
  references: z.array(z.string().max(2000)).optional().nullable(),
  retainedReferences: z.array(auditableRefSchema).optional().nullable(),
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

    const doc = new PDFDocument({ size: "A4", margin: 56, compress: false, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));

    const FONT = "Helvetica";
    const FONT_B = "Helvetica-Bold";
    const FONT_O = "Helvetica-Oblique";
    const teal = "#0f6b6b";
    const ink = "#1c2430";
    const muted = "#8a95a0";
    const lineGap = 14;

    const wrap = (text: string, width: number): string[] => {
      const out: string[] = [];
      for (const hard of text.split("\n")) {
        let line = "";
        for (const word of hard.split(/\s+/).filter(Boolean)) {
          const cand = line ? `${line} ${word}` : word;
          if (!line || doc.widthOfString(cand, { font: FONT, size: 11 } as never) <= width) line = cand;
          else { out.push(line); line = word; }
        }
        if (line) out.push(line);
      }
      return out;
    };

    const ensure = (needed: number) => {
      if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
    };

    const footer = () => {
      doc.font(FONT_O).fontSize(8.5).fillColor(muted);
      const fLeftF: number = doc.page.margins.left;
      const fRightF: number = doc.page.width - doc.page.margins.right;
      doc.text("Clinical Question Assistant — Copyright©RaoufRoshdy2026", fLeftF, doc.page.height - doc.page.margins.bottom + 4, { width: fRightF - doc.page.margins.left - 170, lineBreak: false });
      doc.text(new Date().toLocaleDateString(), fRightF, doc.page.height - doc.page.margins.bottom + 4, { width: 120, align: "right", lineBreak: false });
    };

    const title = String(body.title).trim();
    doc.font(FONT_B).fontSize(8).fillColor(muted).text(String(body.docType || "Document").toUpperCase(), { align: "center" });
    doc.moveDown(0.5);
    doc.font(FONT_B).fontSize(19).fillColor(ink).text(title, { align: "center" });
    doc.moveDown(0.5);
    doc.font(FONT_O).fontSize(9.5).fillColor(muted).text(String(body.meta || ""), { align: "center" });
    doc.moveDown(1.2);

    if (Array.isArray(body.pico) && body.pico.length) {
      ensure(60);
      doc.font(FONT_B).fontSize(13).fillColor(teal).text("Clinical Question (PICO)");
      doc.moveDown(0.4);
      const half = doc.page.width - doc.page.margins.left - doc.page.margins.right - 6;
      for (const row of body.pico.filter(r => r && r.label)) {
        ensure(40);
        const label = String(row.label);
        const value = String(row.value || "");
        const labelW = doc.widthOfString(label, { font: FONT_B, size: 10 } as never) + 12;
        const top = doc.y;
        const labelH = 22;
        doc.rect(doc.page.margins.left, top, labelW, labelH).fill("#e3f2f2");
        doc.font(FONT_B).fontSize(10).fillColor(teal).text(label, doc.page.margins.left + 6, top + 3);
        doc.fillColor(ink).font(FONT).fontSize(10.5);
        const vLines = wrap(value, half - labelW);
        doc.text(vLines.join("\n") || "", doc.page.margins.left + labelW + 8, top + 3, { width: half - labelW, lineGap: 3 });
        doc.rect(doc.page.margins.left, top, half, Math.max(labelH, vLines.length * 16)).stroke("#b9c2cc");
        doc.moveDown(Math.max(labelH, vLines.length * 16) / 12 + 0.3);
      }
      doc.moveDown(0.6);
    }

    if (Array.isArray(body.outcomes) && body.outcomes.length) {
      ensure(40);
      doc.font(FONT_B).fontSize(13).fillColor(teal).text("Selected Outcomes");
      doc.moveDown(0.35);
      doc.font(FONT).fontSize(10.5).fillColor(ink);
      body.outcomes.forEach((o, i) => {
        ensure(20);
        doc.text(`  ${i + 1}.  ${o}`, doc.page.margins.left + 6, doc.y, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 18, lineGap: 3 });
        doc.moveDown(0.35);
      });
      doc.moveDown(0.4);
    }

    if (Array.isArray(body.keywords) && body.keywords.length) {
      ensure(20);
      doc.font(FONT_O).fontSize(10).fillColor("#444d58").text(`Keywords: ${body.keywords.join("; ")}`, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, lineGap: 3 });
      doc.moveDown(0.6);
    }

    if (Array.isArray(body.sections)) {
      for (const section of body.sections) {
        if (!section || !Array.isArray(section.blocks) || !section.blocks.length) continue;
        if (section.heading) {
          ensure(46);
          doc.font(FONT_B).fontSize(13).fillColor(teal).text(String(section.heading));
          doc.moveDown(0.15);
          doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(teal).lineWidth(1.2).stroke();
          doc.moveDown(0.4);
        }
        for (const block of section.blocks) {
          const text = String(block || "").replace(/\*\*/g, "").replace(/[*_#`~]/g, "").trim();
          if (!text) continue;
          const shortHead = text.length < 70 && !/[.!?]\s*$/.test(text);
          if (shortHead) {
            ensure(24);
            doc.font(FONT_B).fontSize(11).fillColor("#14535a").text(text, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, lineGap: 3 });
            doc.moveDown(0.25);
            continue;
          }
          ensure(22);
          doc.font(FONT).fontSize(11).fillColor(ink);
          const lines = wrap(text, doc.page.width - doc.page.margins.left - doc.page.margins.right);
          doc.text(lines.join("\n"), { align: "justify", lineGap });
          doc.moveDown(0.45);
        }
      }
    }

    if (Array.isArray(body.references) && body.references.length) {
      ensure(46);
      doc.font(FONT_B).fontSize(13).fillColor(teal).text("References");
      doc.moveDown(0.15);
      doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(teal).lineWidth(1.2).stroke();
      doc.moveDown(0.4);
      doc.font(FONT).fontSize(10).fillColor(ink);
      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      body.references.forEach((r, i) => {
        const text = String(r || "").replace(/^\[?\d+\]?[\.\)]?\s*/, "");
        const lines = wrap(`${i + 1}.  ${text}`, width - 10);
        ensure(lines.length * 15 + 8);
        doc.text(lines.join("\n"), doc.page.margins.left, doc.y, { width: width - 10, lineGap: 3 });
        doc.moveDown(lines.length * 0.6 + 0.4);
      });
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      footer();
    }
    doc.flushPages();
    doc.end();
    // Must also settle on stream error: otherwise a PDFKit failure leaves this
    // promise pending forever and the request hangs until the platform timeout.
    await new Promise<void>((resolve, reject) => {
      doc.on("end", () => resolve());
      doc.on("error", reject);
    });
    const pdf = Buffer.concat(chunks);
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