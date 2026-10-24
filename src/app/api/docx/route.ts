import { NextResponse } from "next/server";
import { z } from "zod";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  Header,
  Footer,
  PageNumber
} from "docx";
import {
  transformCitationsInText,
  formatBibliographyList,
  type CitationStyle
} from "@/lib/citation-formatter.ts";
import type { AuditableRef } from "@/lib/relevance.ts";

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

const docxPayloadSchema = z.object({
  title: z.string().min(1).max(500),
  meta: z.string().max(500).optional().nullable(),
  citationStyle: z.enum(["vancouver", "apa", "harvard"]).default("vancouver"),
  pico: z.array(picoRowSchema).optional().nullable(),
  outcomes: z.array(z.string().max(500)).optional().nullable(),
  keywords: z.array(z.string().max(100)).optional().nullable(),
  sections: z.array(docxSectionSchema).optional().nullable(),
  references: z.array(z.string().max(2000)).optional().nullable(),
  retainedReferences: z.array(auditableRefSchema).optional().nullable()
});

/**
 * Splits text into text and superscript citations for Vancouver, or converts brackets for APA/Harvard
 */
function createFormattedRuns(
  text: string,
  records: AuditableRef[],
  style: CitationStyle
): TextRun[] {
  if (!text) return [];

  if (style !== "vancouver") {
    // For APA and Harvard, citations are in-text author-year parenthetical format
    const transformed = transformCitationsInText(text, records, style);
    const parts = transformed.split(/\*\*(.*?)\*\*/);
    return parts.map((part, idx) =>
      new TextRun({
        text: part,
        font: "Arial",
        size: 22, // 11pt
        color: "334155",
        bold: idx % 2 === 1
      })
    );
  }

  // Vancouver style:
  // Uppercase superscript with NO brackets!
  const citationTokenRegex = /(\[[\d\s,\-]+\])/g;
  const segments = text.split(citationTokenRegex);
  const runs: TextRun[] = [];

  for (const seg of segments) {
    if (seg.startsWith("[") && seg.endsWith("]") && /^\[[\d\s,\-]+\]$/.test(seg)) {
      // Strip brackets: [1, 2] -> 1, 2
      const innerClean = seg.replace(/^\[/, "").replace(/\]$/, "").trim();
      runs.push(
        new TextRun({
          text: innerClean,
          superScript: true,
          font: "Arial",
          size: 16, // 8pt
          bold: true,
          color: "0F766E"
        })
      );
    } else if (seg) {
      // Split bold markers **bold**
      const parts = seg.split(/\*\*(.*?)\*\*/);
      for (let pIdx = 0; pIdx < parts.length; pIdx++) {
        const p = parts[pIdx];
        if (!p) continue;
        runs.push(
          new TextRun({
            text: p,
            font: "Arial",
            size: 22, // 11pt
            color: "334155",
            bold: pIdx % 2 === 1
          })
        );
      }
    }
  }

  return runs;
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (!raw || raw.length > 500_000) {
      return NextResponse.json({ error: "Payload too large or empty." }, { status: 400 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const parseResult = docxPayloadSchema.safeParse(parsed);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid parameters: " + parseResult.error.issues.map(e => e.message).join(", ") },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    const style: CitationStyle = body.citationStyle || "vancouver";
    const records = (body.retainedReferences || []) as AuditableRef[];

    const docChildren: (Paragraph | Table)[] = [];

    // 1. Document Title
    docChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 100 },
        children: [
          new TextRun({
            text: body.title,
            font: "Arial",
            size: 44, // 22pt
            bold: true,
            color: "0F172A"
          })
        ]
      })
    );

    // 2. Subtitle / Academic Scope
    docChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [
          new TextRun({
            text: "Evidence-Based Scientific Commentary · Obstetrics & Gynecology",
            font: "Arial",
            size: 24, // 12pt
            bold: true,
            color: "0D9488"
          }),
          new TextRun({
            text: ` · Citation Style: ${style === "vancouver" ? "Vancouver (Uppercase / No Brackets)" : style.toUpperCase()}`,
            font: "Arial",
            size: 20, // 10pt
            color: "64748B"
          })
        ]
      })
    );

    // 3. Metadata Table (Author, System, Date)
    const metaTable = new Table({
      width: { size: 9500, type: WidthType.DXA },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
        left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 4750, type: WidthType.DXA },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: "Author / System: ", bold: true, font: "Arial", size: 19, color: "0F172A" }),
                    new TextRun({ text: "Dr. Raouf Roshdy · AI PICO v3.1", font: "Arial", size: 19, color: "334155" })
                  ]
                })
              ]
            }),
            new TableCell({
              width: { size: 4750, type: WidthType.DXA },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({ text: "Generated: ", bold: true, font: "Arial", size: 19, color: "0F172A" }),
                    new TextRun({ text: new Date().toLocaleDateString(), font: "Arial", size: 19, color: "334155" })
                  ]
                })
              ]
            })
          ]
        })
      ]
    });
    docChildren.push(metaTable);

    // 4. Educational Disclaimer Callout Table
    docChildren.push(
      new Paragraph({ spacing: { before: 200 } }),
      new Table({
        width: { size: 9500, type: WidthType.DXA },
        borders: {
          top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          left: { style: BorderStyle.SINGLE, size: 24, color: "0D9488" }
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 9500, type: WidthType.DXA },
                shading: { fill: "F0FDFA" },
                margins: { top: 120, bottom: 120, left: 180, right: 180 },
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: "EDUCATIONAL & CLINICAL DISCLAIMER: ",
                        bold: true,
                        font: "Arial",
                        size: 19,
                        color: "0F766E"
                      }),
                      new TextRun({
                        text: "This document is prepared for clinical decision-support and educational planning purposes. It does not replace individualized clinical judgment, patient-specific risk evaluation, or critical appraisal of primary peer-reviewed literature.",
                        font: "Arial",
                        size: 19,
                        color: "334155",
                        italics: true
                      })
                    ]
                  })
                ]
              })
            ]
          })
        ]
      })
    );

    // 5. PICO Structured Table (if available)
    if (Array.isArray(body.pico) && body.pico.length) {
      docChildren.push(
        new Paragraph({
          spacing: { before: 260, after: 120 },
          children: [
            new TextRun({
              text: "1. Formulated Clinical Question & PICO Framework",
              font: "Arial",
              size: 28, // 14pt
              bold: true,
              color: "0F172A"
            })
          ]
        })
      );

      const tableRows: TableRow[] = [
        // Table Header
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: 2600, type: WidthType.DXA },
              shading: { fill: "0F172A" },
              margins: { top: 120, bottom: 120, left: 160, right: 160 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: "PICO Component", font: "Arial", bold: true, size: 20, color: "FFFFFF" })
                  ]
                })
              ]
            }),
            new TableCell({
              width: { size: 6900, type: WidthType.DXA },
              shading: { fill: "0F172A" },
              margins: { top: 120, bottom: 120, left: 160, right: 160 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: "Clinical Specification", font: "Arial", bold: true, size: 20, color: "FFFFFF" })
                  ]
                })
              ]
            })
          ]
        })
      ];

      for (const row of body.pico) {
        if (!row.label) continue;
        tableRows.push(
          new TableRow({
            cantSplit: true,
            children: [
              new TableCell({
                width: { size: 2600, type: WidthType.DXA },
                shading: { fill: "F8FAFC" },
                margins: { top: 100, bottom: 100, left: 160, right: 160 },
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({ text: row.label, font: "Arial", bold: true, size: 20, color: "0F766E" })
                    ]
                  })
                ]
              }),
              new TableCell({
                width: { size: 6900, type: WidthType.DXA },
                margins: { top: 100, bottom: 100, left: 160, right: 160 },
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({ text: row.value || "—", font: "Arial", size: 20, color: "334155" })
                    ]
                  })
                ]
              })
            ]
          })
        );
      }

      docChildren.push(
        new Table({
          width: { size: 9500, type: WidthType.DXA },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 6, color: "E2E8F0" },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "E2E8F0" },
            left: { style: BorderStyle.SINGLE, size: 6, color: "E2E8F0" },
            right: { style: BorderStyle.SINGLE, size: 6, color: "E2E8F0" },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
            insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" }
          },
          rows: tableRows
        })
      );
    }

    // 6. Keywords
    if (Array.isArray(body.keywords) && body.keywords.length) {
      docChildren.push(
        new Paragraph({
          spacing: { before: 200, after: 120 },
          children: [
            new TextRun({ text: "MeSH Keywords: ", font: "Arial", bold: true, size: 20, color: "0F172A" }),
            new TextRun({ text: body.keywords.join("; "), font: "Arial", italics: true, size: 20, color: "0D9488" })
          ]
        })
      );
    }

    // 7. Narrative Sections (Abstract, Introduction, Thematic Discussion, Conclusion)
    if (Array.isArray(body.sections)) {
      for (const sec of body.sections) {
        if (!sec || !sec.blocks || !sec.blocks.length) continue;

        if (sec.heading) {
          docChildren.push(
            new Paragraph({
              spacing: { before: 280, after: 120 },
              children: [
                new TextRun({
                  text: sec.heading,
                  font: "Arial",
                  size: 32, // 16pt
                  bold: true,
                  color: "0F172A"
                })
              ]
            })
          );
        }

        for (const rawBlock of sec.blocks) {
          const text = String(rawBlock || "").trim();
          if (!text) continue;

          // Check if block is a subheading (e.g. starts with "#### " or is a short header)
          if (text.startsWith("#### ")) {
            const cleanSubhead = text.replace(/^####\s+/, "");
            docChildren.push(
              new Paragraph({
                spacing: { before: 200, after: 80 },
                children: [
                  new TextRun({
                    text: cleanSubhead,
                    font: "Arial",
                    size: 26, // 13pt
                    bold: true,
                    color: "0D9488"
                  })
                ]
              })
            );
            continue;
          }

          // Bullet point lists
          if (text.startsWith("- ")) {
            const items = text.split(/\n-\s+/).map(it => it.replace(/^- /, "").trim()).filter(Boolean);
            for (const item of items) {
              const runs = createFormattedRuns(item, records, style);
              docChildren.push(
                new Paragraph({
                  bullet: { level: 0 },
                  spacing: { after: 80 },
                  children: runs
                })
              );
            }
            continue;
          }

          // Standard narrative paragraph
          const runs = createFormattedRuns(text, records, style);
          docChildren.push(
            new Paragraph({
              spacing: { after: 140, line: 276 }, // 1.15 line spacing
              alignment: AlignmentType.JUSTIFIED,
              children: runs
            })
          );
        }
      }
    }

    // 8. References Section
    const bibliography = formatBibliographyList(records, style);
    if (bibliography.length) {
      docChildren.push(
        new Paragraph({
          spacing: { before: 320, after: 140 },
          children: [
            new TextRun({
              text: `References (${style === "vancouver" ? "Vancouver Style — Sequential" : style === "apa" ? "APA 7th Edition — Alphabetical" : "Harvard Style — Alphabetical"})`,
              font: "Arial",
              size: 32, // 16pt
              bold: true,
              color: "0F172A"
            })
          ]
        })
      );

      for (const item of bibliography) {
        docChildren.push(
          new Paragraph({
            spacing: { after: 100 },
            indent: style !== "vancouver" ? { left: 720, hanging: 720 } : undefined,
            children: [
              new TextRun({
                text: item.text,
                font: "Arial",
                size: 20, // 10pt
                color: "1E293B"
              })
            ]
          })
        );
      }
    }

    // Create the docx Document
    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1440,
                right: 1440,
                bottom: 1440,
                left: 1440
              }
            }
          },
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({
                      text: "AI PICO v3.1 · Clinical Evidence Commentary · Obstetrics & Gynecology",
                      font: "Arial",
                      size: 18, // 9pt
                      color: "64748B"
                    })
                  ]
                })
              ]
            })
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.BOTH,
                  children: [
                    new TextRun({
                      text: "Confidential · Clinical Question Assistant",
                      font: "Arial",
                      size: 18,
                      color: "64748B"
                    }),
                    new TextRun({
                      text: "    |    Page ",
                      font: "Arial",
                      size: 18,
                      color: "64748B"
                    }),
                    new TextRun({
                      children: [PageNumber.CURRENT],
                      font: "Arial",
                      size: 18,
                      color: "64748B"
                    }),
                    new TextRun({
                      text: " of ",
                      font: "Arial",
                      size: 18,
                      color: "64748B"
                    }),
                    new TextRun({
                      children: [PageNumber.TOTAL_PAGES],
                      font: "Arial",
                      size: 18,
                      color: "64748B"
                    }),
                    new TextRun({
                      text: "    |    copyrights@Raouf Roshdy2026",
                      font: "Arial",
                      size: 18,
                      color: "64748B"
                    })
                  ]
                })
              ]
            })
          },
          children: docChildren
        }
      ]
    });

    const buffer = await Packer.toBuffer(doc);
    const safeTitle = body.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "clinical-commentary";

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeTitle}.docx"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (err) {
    console.error("DOCX generation error:", err);
    return NextResponse.json({ error: "Failed to generate Word document." }, { status: 500 });
  }
}
