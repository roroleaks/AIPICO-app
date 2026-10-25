import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import type { AuditableRef } from "./relevance.ts";
import {
  transformCitationsInText,
  formatBibliographyList,
  type CitationStyle
} from "./citation-formatter.ts";
import type { ProvenanceMetadata } from "./provenance.ts";

export interface PicoRow {
  label: string;
  value: string;
}

export interface PdfSection {
  heading?: string | null;
  blocks: string[];
}

export interface PdfPayload {
  docType?: string | null;
  title: string;
  meta?: string | null;
  citationStyle?: "vancouver" | "apa" | "harvard" | null;
  pico?: PicoRow[] | null;
  outcomes?: string[] | null;
  keywords?: string[] | null;
  sections?: PdfSection[] | null;
  references?: string[] | null;
  retainedReferences?: any[] | null;
  provenance?: ProvenanceMetadata | null;
}

function resolveFontsDir(): string {
  const currentDir = typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

  const candidates = [
    path.join(process.cwd(), "src", "fonts"),
    path.join(currentDir, "..", "fonts"),
    path.join(currentDir, "fonts")
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "DejaVuSans.ttf"))) {
      return c;
    }
  }
  return candidates[0];
}

export async function buildPdfBuffer(body: PdfPayload): Promise<Buffer> {
  const style: CitationStyle = body.citationStyle || "vancouver";
  const records = (body.retainedReferences || []) as AuditableRef[];

  const PAGE_MARGIN = 54;
  const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN, compress: false, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const fontsDir = resolveFontsDir();
  const fontRegular = path.join(fontsDir, "DejaVuSans.ttf");
  const fontBold = path.join(fontsDir, "DejaVuSans-Bold.ttf");
  const fontOblique = path.join(fontsDir, "DejaVuSans-Oblique.ttf");

  doc.registerFont("DejaVuSans", fontRegular);
  doc.registerFont("DejaVuSans-Bold", fontBold);
  doc.registerFont("DejaVuSans-Oblique", fontOblique);

  const FONT = "DejaVuSans";
  const FONT_B = "DejaVuSans-Bold";
  const FONT_O = "DejaVuSans-Oblique";

  const teal = "#0f6b6b";
  const ink = "#1c2430";
  const muted = "#8a95a0";
  const lineGap = 13;

  const wrap = (text: string, width: number): string[] => {
    const out: string[] = [];
    for (const hard of text.split("\n")) {
      let line = "";
      for (const word of hard.split(/\s+/).filter(Boolean)) {
        const cand = line ? `${line} ${word}` : word;
        if (!line || doc.widthOfString(cand, { font: FONT, size: 10.5 } as never) <= width) line = cand;
        else { out.push(line); line = word; }
      }
      if (line) out.push(line);
    }
    return out;
  };

  const ensure = (needed: number) => {
    if (doc.y + needed > doc.page.height - doc.page.margins.bottom - 20) doc.addPage();
  };

  const header = (pageNum: number) => {
    if (pageNum === 0) return; // omit running header on page 1
    doc.font(FONT_O).fontSize(8).fillColor(muted);
    const fLeft: number = PAGE_MARGIN;
    const fRight: number = doc.page.width - PAGE_MARGIN;
    doc.text("AI PICO v3.1 · Clinical Evidence Commentary · Obstetrics & Gynecology", fLeft, 26, {
      width: fRight - fLeft,
      align: "right",
      lineBreak: false
    });
    doc.moveTo(fLeft, 38).lineTo(fRight, 38).strokeColor("#cbd5e1").lineWidth(0.5).stroke();
  };

  const footer = (pageNum: number, totalPages: number) => {
    doc.font(FONT_O).fontSize(8.5).fillColor(muted);
    const fLeft: number = PAGE_MARGIN;
    const fRight: number = doc.page.width - PAGE_MARGIN;
    const bottomY = doc.page.height - PAGE_MARGIN + 8;
    doc.moveTo(fLeft, bottomY - 6).lineTo(fRight, bottomY - 6).strokeColor("#cbd5e1").lineWidth(0.5).stroke();
    doc.text("AI PICO v3.1 — Copyright©RaoufRoshdy2026", fLeft, bottomY, {
      width: 220,
      lineBreak: false
    });
    doc.text(`Page ${pageNum + 1} of ${totalPages}`, fLeft, bottomY, {
      width: fRight - fLeft,
      align: "center",
      lineBreak: false
    });
    doc.text(new Date().toLocaleDateString(), fRight - 100, bottomY, {
      width: 100,
      align: "right",
      lineBreak: false
    });
  };

  const title = String(body.title).trim();
  doc.font(FONT_B).fontSize(8).fillColor(muted).text(String(body.docType || "Document").toUpperCase(), { align: "center" });
  doc.moveDown(0.4);
  doc.font(FONT_B).fontSize(18).fillColor(ink).text(title, { align: "center" });
  doc.moveDown(0.4);
  doc.font(FONT_O).fontSize(9.5).fillColor(muted).text(
    `${String(body.meta || "")} · Citation Style: ${style === "vancouver" ? "Vancouver (Uppercase / No Brackets)" : style.toUpperCase()}`,
    { align: "center" }
  );
  doc.moveDown(0.8);

  // Educational Disclaimer Callout Banner
  ensure(46);
  const discTop = doc.y;
  const discWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.rect(doc.page.margins.left, discTop, discWidth, 38).fillColor("#f1f5f9").strokeColor("#cbd5e1").lineWidth(0.75).fillAndStroke();
  doc.font(FONT_B).fontSize(8.5).fillColor(teal).text("EDUCATIONAL DISCLAIMER:", doc.page.margins.left + 12, discTop + 5);
  doc.font(FONT_O).fontSize(8).fillColor("#334155").text(
    "AI PICO is an experimental assistive tool for educational and clinical inquiry formulation only. Synthesized claims, outcomes, and proposed questions require independent clinical verification against original peer-reviewed literature.",
    doc.page.margins.left + 12,
    discTop + 16,
    { width: discWidth - 24, lineGap: 1.5 }
  );
  doc.y = discTop + 46;

  // PICO grid
  if (Array.isArray(body.pico) && body.pico.length) {
    ensure(36);
    doc.font(FONT_B).fontSize(12.5).fillColor(teal).text("Clinical Question (PICO)");
    doc.moveDown(0.12);
    doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(teal).lineWidth(1.2).stroke();
    doc.moveDown(0.35);
    for (const row of body.pico) {
      ensure(22);
      const top = doc.y;
      const label = `${row.label}:`;
      const labelW = doc.widthOfString(label, { font: FONT_B, size: 9.5 } as never) + 12;
      const valW = doc.page.width - doc.page.margins.left - doc.page.margins.right - labelW - 12;
      doc.rect(doc.page.margins.left, top, labelW, 18).fillColor("#f4f9f9").fill();
      doc.rect(doc.page.margins.left, top, doc.page.width - doc.page.margins.left - doc.page.margins.right, 18).strokeColor("#e1ecec").lineWidth(0.5).stroke();
      doc.font(FONT_B).fontSize(9.5).fillColor(teal).text(label, doc.page.margins.left + 6, top + 3);
      doc.fillColor(ink).font(FONT).fontSize(10);
      const valLines = wrap(String(row.value || "").trim(), valW);
      doc.text(valLines.join(" "), doc.page.margins.left + labelW + 6, top + 3, { width: valW });
      doc.moveDown(0.35);
    }
    doc.moveDown(0.4);
  }

  // Selected Outcomes
  if (Array.isArray(body.outcomes) && body.outcomes.length) {
    ensure(30);
    doc.font(FONT_B).fontSize(12).fillColor(teal).text("Selected Outcomes");
    doc.moveDown(0.1);
    doc.font(FONT).fontSize(10).fillColor(ink);
    const text = body.outcomes.map(o => `•  ${o}`).join("   ·   ");
    const lines = wrap(text, doc.page.width - doc.page.margins.left - doc.page.margins.right);
    doc.text(lines.join("\n"), { lineGap: 3 });
    doc.moveDown(0.4);
  }

  // Keywords
  if (Array.isArray(body.keywords) && body.keywords.length) {
    ensure(20);
    doc.font(FONT_O).fontSize(9.5).fillColor("#444d58").text(`Keywords: ${body.keywords.join("; ")}`, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, lineGap: 3 });
    doc.moveDown(0.4);
  }

  // Narrative sections
  if (Array.isArray(body.sections) && body.sections.length) {
    for (const section of body.sections) {
      if (!section || !Array.isArray(section.blocks)) continue;
      if (section.heading) {
        ensure(36);
        doc.font(FONT_B).fontSize(12.5).fillColor(teal).text(String(section.heading));
        doc.moveDown(0.12);
        doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(teal).lineWidth(1.2).stroke();
        doc.moveDown(0.35);
      }
      for (const block of section.blocks) {
        const rawText = String(block || "").replace(/[*_#`~]/g, "").trim();
        if (!rawText) continue;

        const isSubhead = rawText.startsWith("#### ") || (rawText.length < 75 && !/[.!?]\s*$/.test(rawText));
        if (isSubhead) {
          ensure(24);
          const cleanSub = rawText.replace(/^####\s+/, "");
          doc.font(FONT_B).fontSize(10.5).fillColor("#14535a").text(cleanSub, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, lineGap: 3 });
          doc.moveDown(0.25);
          continue;
        }

        // Bullet points
        if (rawText.startsWith("- ")) {
          const items = rawText.split(/\n-\s+/).map(it => it.replace(/^- /, "").trim()).filter(Boolean);
          for (const item of items) {
            ensure(20);
            const textWithCites = style === "vancouver"
              ? item.replace(/\[([\d\s,\-]+)\]/g, "$1") // uppercase style with NO brackets
              : transformCitationsInText(item, records, style);
            doc.font(FONT).fontSize(10.5).fillColor(ink);
            const lines = wrap(`•  ${textWithCites}`, doc.page.width - doc.page.margins.left - doc.page.margins.right - 14);
            doc.text(lines.join("\n"), doc.page.margins.left + 10, doc.y, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 14, lineGap: 3 });
            doc.moveDown(0.3);
          }
          continue;
        }

        // Standard narrative paragraph
        ensure(24);
        doc.font(FONT).fontSize(10.5).fillColor(ink);

        // For Vancouver: "note that vancover must be uppercase and with no barckets"
        // We remove brackets from citations: [1, 2] -> 1, 2
        const textWithCites = style === "vancouver"
          ? rawText.replace(/\[([\d\s,\-]+)\]/g, "$1")
          : transformCitationsInText(rawText, records, style);

        const lines = wrap(textWithCites, doc.page.width - doc.page.margins.left - doc.page.margins.right);
        doc.text(lines.join("\n"), { align: "justify", lineGap });
        doc.moveDown(0.4);
      }
    }
  }

  // Methods & Provenance section
  if (body.provenance) {
    const prov = body.provenance;
    ensure(46);
    doc.font(FONT_B).fontSize(12.5).fillColor(teal).text("Methods and Provenance");
    doc.moveDown(0.12);
    doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(teal).lineWidth(1.2).stroke();
    doc.moveDown(0.35);

    const items: [string, string][] = [];
    if (prov.retrievedAt) items.push(["Retrieval Date/Time", String(prov.retrievedAt)]);
    if (prov.sources) {
      const s = Array.isArray(prov.sources) ? prov.sources.join(", ") : String(prov.sources);
      items.push(["Sources Queried", s]);
    }
    if (prov.queryStrings) {
      const q = Array.isArray(prov.queryStrings) ? prov.queryStrings.join(" | ") : String(prov.queryStrings);
      if (q) items.push(["Search Queries", q]);
    }
    if (prov.engine) items.push(["Engine Path", String(prov.engine)]);
    if (prov.promptVersion) items.push(["Prompt Version", String(prov.promptVersion)]);
    if (prov.buildCommit) items.push(["App Build Commit", String(prov.buildCommit)]);

    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    for (const [lbl, val] of items) {
      ensure(18);
      doc.font(FONT_B).fontSize(9).fillColor(teal).text(`${lbl}: `, doc.page.margins.left, doc.y, { continued: true });
      doc.font(FONT).fontSize(9).fillColor(ink).text(val, { width, lineGap: 2 });
      doc.moveDown(0.25);
    }
    doc.moveDown(0.3);
  }

  // References section
  const bibList = formatBibliographyList(records, style);
  const refsToRender = bibList.length
    ? bibList.map(b => b.text)
    : (body.references || []);

  if (refsToRender.length) {
    ensure(46);
    doc.font(FONT_B).fontSize(12.5).fillColor(teal).text(
      `References (${style === "vancouver" ? "Vancouver Style — Sequential" : style === "apa" ? "APA 7th Edition — Alphabetical" : "Harvard Style — Alphabetical"})`
    );
    doc.moveDown(0.12);
    doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(teal).lineWidth(1.2).stroke();
    doc.moveDown(0.35);
    doc.font(FONT).fontSize(9.5).fillColor(ink);
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    refsToRender.forEach((r, i) => {
      const text = String(r || "").replace(/^\[?\d+\]?[\.\)]?\s*/, "");
      const prefix = style === "vancouver" ? `${i + 1}.  ` : "";
      const lines = wrap(`${prefix}${text}`, width - 10);
      ensure(lines.length * 14 + 6);
      doc.text(lines.join("\n"), doc.page.margins.left, doc.y, { width: width - 10, lineGap: 3 });
      doc.moveDown(lines.length * 0.5 + 0.35);
    });
  }

  // Running header and footer pass with margin suspension (DEF-013 fix intact)
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const oldBottom = doc.page.margins.bottom;
    const oldTop = doc.page.margins.top;
    doc.page.margins.bottom = 0;
    doc.page.margins.top = 0;
    header(i);
    footer(i, range.count);
    doc.page.margins.bottom = oldBottom;
    doc.page.margins.top = oldTop;
  }
  doc.flushPages();
  doc.end();

  await new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  return Buffer.concat(chunks);
}
