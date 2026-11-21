import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import type { AuditableRef } from "./relevance.ts";
import {
  transformCitationsInText,
  formatBibliographyList,
  formatVancouverSuperscript,
  type CitationStyle
} from "./citation-formatter.ts";
import type { ProvenanceMetadata } from "./provenance.ts";
import type { WorkflowExportData } from "./docx-generator.ts";

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
  title?: string | null;
  meta?: string | null;
  citationStyle?: "vancouver" | "apa" | "harvard" | null;
  pico?: PicoRow[] | null;
  outcomes?: string[] | null;
  keywords?: string[] | null;
  sections?: PdfSection[] | null;
  references?: string[] | null;
  retainedReferences?: Array<Record<string, unknown>> | null;
  provenance?: ProvenanceMetadata | null;
  workflow?: WorkflowExportData | null;
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
  const records = (body.retainedReferences || []) as unknown as AuditableRef[];

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

  const reserveSpace = (needed: number) => {
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

    const leftWidth = 180;
    const rightWidth = 100;
    const clearance = 8;
    const centerLeft = fLeft + leftWidth + clearance;
    const centerRight = fRight - rightWidth - clearance;
    const centerWidth = centerRight - centerLeft;

    doc.text("AI PICO v3.1 — © Raouf Roshdy 2026", fLeft, bottomY, {
      width: leftWidth,
      align: "left",
      lineBreak: false
    });
    doc.text(`Page ${pageNum + 1} of ${totalPages}`, centerLeft, bottomY, {
      width: centerWidth,
      align: "center",
      lineBreak: false
    });
    doc.text(new Date().toLocaleDateString(), fRight - rightWidth, bottomY, {
      width: rightWidth,
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
    `${String(body.meta || "")} · Citation Style: ${style === "vancouver" ? "Vancouver (superscript numerals)" : style.toUpperCase()}`,
    { align: "center" }
  );
  doc.moveDown(0.8);

  // Educational Disclaimer Callout Banner
  reserveSpace(46);
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
    reserveSpace(36);
    doc.font(FONT_B).fontSize(12.5).fillColor(teal).text("Clinical Question (PICO)");
    doc.moveDown(0.12);
    doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(teal).lineWidth(1.2).stroke();
    doc.moveDown(0.35);
    for (const row of body.pico) {
      reserveSpace(22);
      const top = doc.y;
      const label = `${row.label}:`;
      const labelW = doc.widthOfString(label, { font: FONT_B, size: 9.5 } as never) + 12;
      const valW = doc.page.width - doc.page.margins.left - doc.page.margins.right - labelW - 12;
      doc.rect(doc.page.margins.left, top, labelW, 18).fillColor("#f4f9f9").fill();
      doc.rect(doc.page.margins.left, top, doc.page.width - doc.page.margins.left - doc.page.margins.right, 18).strokeColor("#e1ecec").lineWidth(0.5).stroke();
      doc.font(FONT_B).fontSize(9.5).fillColor(teal).text(label, doc.page.margins.left + 6, top + 3);
      doc.fillColor(ink).font(FONT).fontSize(10);
      const valStr = String(row.value || "").trim();
      doc.text(valStr, doc.page.margins.left + labelW + 6, top + 3, { width: valW });
      doc.moveDown(0.35);
    }
    doc.moveDown(0.4);
  }

  // Selected Outcomes
  if (Array.isArray(body.outcomes) && body.outcomes.length) {
    reserveSpace(30);
    doc.font(FONT_B).fontSize(12).fillColor(teal).text("Selected Outcomes");
    doc.moveDown(0.1);
    doc.font(FONT).fontSize(10).fillColor(ink);
    const text = body.outcomes.map(o => `•  ${o}`).join("   ·   ");
    const outWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc.text(text, { width: outWidth, lineGap: 3 });
    doc.moveDown(0.4);
  }

  // Keywords
  if (Array.isArray(body.keywords) && body.keywords.length) {
    reserveSpace(20);
    doc.font(FONT_O).fontSize(9.5).fillColor("#444d58").text(`Keywords: ${body.keywords.join("; ")}`, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, lineGap: 3 });
    doc.moveDown(0.4);
  }

  // Narrative sections
  if (Array.isArray(body.sections) && body.sections.length) {
    for (const section of body.sections) {
      if (!section || !Array.isArray(section.blocks)) continue;
      if (section.heading) {
        reserveSpace(36);
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
          reserveSpace(24);
          const cleanSub = rawText.replace(/^####\s+/, "");
          doc.font(FONT_B).fontSize(10.5).fillColor("#14535a").text(cleanSub, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, lineGap: 3 });
          doc.moveDown(0.25);
          continue;
        }

        // Bullet points
        if (rawText.startsWith("- ")) {
          const items = rawText.split(/\n-\s+/).map(it => it.replace(/^- /, "").trim()).filter(Boolean);
          const colWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right - 14;
          for (const item of items) {
            const textWithCites = style === "vancouver"
              ? formatVancouverSuperscript(item)
              : transformCitationsInText(item, records, style);
            doc.font(FONT).fontSize(10.5).fillColor(ink);
            const needed = Math.min(doc.heightOfString(`•  ${textWithCites}`, { width: colWidth, lineGap: 3 }), 36);
            reserveSpace(needed);
            doc.text(`•  ${textWithCites}`, doc.page.margins.left + 10, doc.y, { width: colWidth, lineGap: 3 });
            doc.moveDown(0.3);
          }
          continue;
        }

        // Standard narrative paragraph
        doc.font(FONT).fontSize(10.5).fillColor(ink);

        // For Vancouver: uppercase superscript with NO brackets
        const textWithCites = style === "vancouver"
          ? formatVancouverSuperscript(rawText)
          : transformCitationsInText(rawText, records, style);

        const colWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const estHeight = doc.heightOfString(textWithCites, { width: colWidth, lineGap: 3 });
        reserveSpace(Math.min(estHeight, 36));
        doc.text(textWithCites, { width: colWidth, align: "justify", lineGap: 3 });
        doc.moveDown(0.4);
      }
    }
  }

  // Methods & Provenance section
  if (body.provenance) {
    const prov = body.provenance;
    reserveSpace(46);
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
    if (prov.enginesQueried) {
      const eq = Array.isArray(prov.enginesQueried) ? prov.enginesQueried.join(", ") : String(prov.enginesQueried);
      items.push(["Engines Queried", eq]);
    }
    if (prov.googleScholarNotice) {
      items.push(["Google Scholar Proxy", String(prov.googleScholarNotice)]);
    }
    if (prov.engine) items.push(["Engine Path", String(prov.engine)]);
    if (prov.promptVersion) items.push(["Prompt Version", String(prov.promptVersion)]);
    if (prov.buildCommit) items.push(["App Build Commit", String(prov.buildCommit)]);

    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    for (const [lbl, val] of items) {
      reserveSpace(18);
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
    reserveSpace(46);
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
      const fullRef = `${prefix}${text}`;
      const neededHeight = Math.min(doc.heightOfString(fullRef, { width: width - 10, lineGap: 3 }), 36);
      reserveSpace(neededHeight);
      doc.text(fullRef, doc.page.margins.left, doc.y, { width: width - 10, lineGap: 3 });
      doc.moveDown(0.35);
    });
  }

  // Running header and footer pass with margin suspension (DEF-013 remediation intact)
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

export async function buildWorkflowPdf(workflow: WorkflowExportData): Promise<Buffer> {
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

  const reserveSpace = (needed: number) => {
    if (doc.y + needed > doc.page.height - doc.page.margins.bottom - 20) doc.addPage();
  };

  const header = (pageNum: number) => {
    if (pageNum === 0) return;
    doc.font(FONT_O).fontSize(8).fillColor(muted);
    const fLeft: number = PAGE_MARGIN;
    const fRight: number = doc.page.width - PAGE_MARGIN;
    doc.text("AI PICO v4 · Workflow Summary · Evidence-Based Medicine", fLeft, 26, {
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

    const leftWidth = 180;
    const rightWidth = 100;
    const clearance = 8;
    const centerLeft = fLeft + leftWidth + clearance;
    const centerRight = fRight - rightWidth - clearance;
    const centerWidth = centerRight - centerLeft;

    doc.text("AI PICO v4 — © Raouf Roshdy 2026", fLeft, bottomY, {
      width: leftWidth,
      align: "left",
      lineBreak: false
    });
    doc.text(`Page ${pageNum + 1} of ${totalPages}`, centerLeft, bottomY, {
      width: centerWidth,
      align: "center",
      lineBreak: false
    });
    doc.text(new Date().toLocaleDateString(), fRight - rightWidth, bottomY, {
      width: rightWidth,
      align: "right",
      lineBreak: false
    });
  };

  // Header Title Area
  doc.font(FONT_B).fontSize(8).fillColor(muted).text("WORKFLOW SUMMARY", { align: "center" });
  doc.moveDown(0.4);
  doc.font(FONT_B).fontSize(17).fillColor(ink).text(workflow.phrase, { align: "center" });
  doc.moveDown(0.4);
  const categoryLabel = workflow.category;
  doc.font(FONT_O).fontSize(9.5).fillColor(muted).text(
    `AIPICO workflow summary — ${categoryLabel} evidence focus`,
    { align: "center" }
  );
  doc.moveDown(0.8);

  // Educational Disclaimer Callout Banner
  reserveSpace(46);
  const discTop = doc.y;
  const discWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.rect(doc.page.margins.left, discTop, discWidth, 38).fillColor("#f1f5f9").strokeColor("#cbd5e1").lineWidth(0.75).fillAndStroke();
  doc.font(FONT_B).fontSize(8.5).fillColor(teal).text("EDUCATIONAL DISCLAIMER:", doc.page.margins.left + 12, discTop + 5);
  doc.font(FONT_O).fontSize(8).fillColor("#334155").text(
    "AI PICO is an assistive tool for educational and clinical inquiry formulation only. Synthesized claims, outcomes, and proposed questions require independent clinical verification against original peer-reviewed literature.",
    doc.page.margins.left + 12,
    discTop + 16,
    { width: discWidth - 24, lineGap: 1.5 }
  );
  doc.y = discTop + 46;

  // Section 1: Clinical Words (PICO)
  reserveSpace(36);
  doc.font(FONT_B).fontSize(12.5).fillColor(teal).text("Clinical words (PICO)");
  doc.moveDown(0.12);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(teal).lineWidth(1.2).stroke();
  doc.moveDown(0.35);

  const roleNameMap: Record<string, string> = {
    population: "Population (P)",
    intervention: "Intervention (I)",
    comparator: "Comparator (C)",
    outcome: "Outcome (O)"
  };

  for (const w of workflow.words) {
    reserveSpace(22);
    const top = doc.y;
    const roleLabel = `${roleNameMap[w.role] || w.role}:`;
    const labelW = doc.widthOfString(roleLabel, { font: FONT_B, size: 9.5 } as never) + 12;
    const valW = doc.page.width - doc.page.margins.left - doc.page.margins.right - labelW - 12;
    doc.rect(doc.page.margins.left, top, labelW, 18).fillColor("#f4f9f9").fill();
    doc.rect(doc.page.margins.left, top, doc.page.width - doc.page.margins.left - doc.page.margins.right, 18).strokeColor("#e1ecec").lineWidth(0.5).stroke();
    doc.font(FONT_B).fontSize(9.5).fillColor(teal).text(roleLabel, doc.page.margins.left + 6, top + 3);
    doc.fillColor(ink).font(FONT_B).fontSize(10);
    doc.text(w.word, doc.page.margins.left + labelW + 6, top + 3, { width: valW });
    doc.moveDown(0.35);
  }
  doc.moveDown(0.4);

  // Section 2: Screening
  reserveSpace(36);
  doc.font(FONT_B).fontSize(12.5).fillColor(teal).text("Screening");
  doc.moveDown(0.12);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(teal).lineWidth(1.2).stroke();
  doc.moveDown(0.35);
  doc.font(FONT).fontSize(10).fillColor(ink);
  const statsLine = `Retrieved: ${workflow.screeningStats.retrieved} records · Screened: ${workflow.screeningStats.screened} records · Search relaxation: ${workflow.screeningStats.relaxationLevel} · Excluded: ${workflow.screeningStats.excludedCount} records`;
  doc.text(statsLine, doc.page.margins.left, doc.y, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    lineGap: 3
  });
  doc.moveDown(0.6);

  // Section 3: Papers under consideration
  reserveSpace(46);
  doc.font(FONT_B).fontSize(12.5).fillColor(teal).text("Papers under consideration");
  doc.moveDown(0.12);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(teal).lineWidth(1.2).stroke();
  doc.moveDown(0.4);

  const contentW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  for (const p of workflow.papers) {
    reserveSpace(48);
    const top = doc.y;
    // Rank & Relevance %
    doc.font(FONT_B).fontSize(10).fillColor(teal).text(
      `[${p.rank}] ${p.relevancePct}% related`,
      doc.page.margins.left,
      top
    );
    doc.moveDown(0.15);

    // Title
    doc.font(FONT_B).fontSize(10).fillColor(ink).text(
      p.title,
      doc.page.margins.left,
      doc.y,
      { width: contentW }
    );
    doc.moveDown(0.15);

    // Authors / Journal / Year
    const metaParts = [
      p.authors ? `${p.authors}.` : "",
      p.journal ? `${p.journal}` : "",
      p.year ? `(${p.year})` : "",
      p.design ? `[${p.design}]` : ""
    ].filter(Boolean).join(" ");
    if (metaParts) {
      doc.font(FONT_O).fontSize(9).fillColor("#475569").text(
        metaParts,
        doc.page.margins.left,
        doc.y,
        { width: contentW }
      );
      doc.moveDown(0.15);
    }

    // Matched elements
    if (p.matchedElements && p.matchedElements.length) {
      doc.font(FONT).fontSize(8.5).fillColor("#0d9488").text(
        `Matched elements: ${p.matchedElements.join(", ")}`,
        doc.page.margins.left,
        doc.y,
        { width: contentW }
      );
    }
    doc.moveDown(0.4);
    doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
    doc.moveDown(0.4);
  }

  // Section 4: Excluded during exploration
  reserveSpace(36);
  doc.font(FONT_B).fontSize(12.5).fillColor(teal).text("Excluded during exploration");
  doc.moveDown(0.12);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(teal).lineWidth(1.2).stroke();
  doc.moveDown(0.35);
  doc.font(FONT).fontSize(10).fillColor(ink);
  doc.text(
    `${workflow.screeningStats.excludedCount} paper(s) excluded by researcher during exploration.`,
    doc.page.margins.left,
    doc.y,
    { width: contentW }
  );

  // Running header and footer pass with margin suspension
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
