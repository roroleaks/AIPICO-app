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
} from "./citation-formatter.ts";
import type { AuditableRef } from "./relevance.ts";
import type { ProvenanceMetadata } from "./provenance.ts";

export interface PicoRow {
  label: string;
  value: string;
}

export interface DocxSection {
  heading?: string | null;
  blocks: string[];
}

export interface WorkflowWord {
  word: string;
  role: "population" | "intervention" | "comparator" | "outcome";
}

export interface WorkflowScreeningStats {
  retrieved: number;
  screened: number;
  relaxationLevel: number;
  excludedCount: number;
}

export interface WorkflowPaper {
  rank: number;
  relevancePct: number;
  title: string;
  authors: string;
  journal: string;
  year: string;
  design: string;
  matchedElements: string[];
}

export interface WorkflowExportData {
  words: WorkflowWord[];
  category: "established" | "conflicting" | "gap";
  phrase: string;
  screeningStats: WorkflowScreeningStats;
  papers: WorkflowPaper[];
}

export interface DocxPayload {
  title?: string | null;
  meta?: string | null;
  citationStyle?: "vancouver" | "apa" | "harvard" | null;
  pico?: PicoRow[] | null;
  outcomes?: string[] | null;
  keywords?: string[] | null;
  sections?: DocxSection[] | null;
  references?: string[] | null;
  retainedReferences?: Array<Record<string, unknown>> | null;
  provenance?: ProvenanceMetadata | null;
  workflow?: WorkflowExportData | null;
}

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
  let cleanText = text.replace(/([?!])\s*\[([\d\s,\-]+)\]\.?/g, "$1[$2]");
  cleanText = cleanText.replace(/\s*\[([\d\s,\-]+)\]/g, "[$1]");
  const citationTokenRegex = /(\[[\d\s,\-]+\])/g;
  const segments = cleanText.split(citationTokenRegex);
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
          size: 22, // 11pt
          bold: true,
          color: "0F766E"
        })
      );
    } else if (seg) {
      const parts = seg.split(/\*\*(.*?)\*\*/);
      parts.forEach((part, idx) => {
        if (!part) return;
        runs.push(
          new TextRun({
            text: part,
            font: "Arial",
            size: 22, // 11pt
            color: "334155",
            bold: idx % 2 === 1
          })
        );
      });
    }
  }

  return runs;
}

/**
 * Build elegant 2-column PICO table
 */
function createPicoTable(pico: PicoRow[]): Table {
  const rows: TableRow[] = [];

  // Table Header
  rows.push(
    new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          width: { size: 2400, type: WidthType.DXA },
          shading: { fill: "0F766E" },
          margins: { top: 120, bottom: 120, left: 160, right: 160 },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: "PICO Component",
                  bold: true,
                  font: "Arial",
                  size: 20, // 10pt
                  color: "FFFFFF"
                })
              ]
            })
          ]
        }),
        new TableCell({
          width: { size: 6960, type: WidthType.DXA },
          shading: { fill: "0F766E" },
          margins: { top: 120, bottom: 120, left: 160, right: 160 },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: "Clinical Specification",
                  bold: true,
                  font: "Arial",
                  size: 20,
                  color: "FFFFFF"
                })
              ]
            })
          ]
        })
      ]
    })
  );

  // Data rows with alternating zebra shading
  pico.forEach((item, index) => {
    const isEven = index % 2 === 0;
    const bg = isEven ? "F8FAFC" : "FFFFFF";

    rows.push(
      new TableRow({
        children: [
          new TableCell({
            width: { size: 2400, type: WidthType.DXA },
            shading: { fill: bg },
            margins: { top: 100, bottom: 100, left: 160, right: 160 },
            borders: {
              bottom: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
              top: { style: BorderStyle.NONE },
              left: { style: BorderStyle.NONE },
              right: { style: BorderStyle.NONE }
            },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: item.label,
                    bold: true,
                    font: "Arial",
                    size: 20,
                    color: "0F766E"
                  })
                ]
              })
            ]
          }),
          new TableCell({
            width: { size: 6960, type: WidthType.DXA },
            shading: { fill: bg },
            margins: { top: 100, bottom: 100, left: 160, right: 160 },
            borders: {
              bottom: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
              top: { style: BorderStyle.NONE },
              left: { style: BorderStyle.NONE },
              right: { style: BorderStyle.NONE }
            },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: item.value,
                    font: "Arial",
                    size: 20,
                    color: "1E293B"
                  })
                ]
              })
            ]
          })
        ]
      })
    );
  });

  return new Table({
    width: { size: 9360, type: WidthType.DXA }, // Full content width within 1-inch margins
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
      bottom: { style: BorderStyle.SINGLE, size: 8, color: "0F766E" },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
      insideVertical: { style: BorderStyle.NONE }
    },
    rows
  });
}

export async function buildDocxBuffer(body: DocxPayload): Promise<Buffer> {
  const style: CitationStyle = body.citationStyle || "vancouver";
  const records = (body.retainedReferences || []) as unknown as AuditableRef[];

  const docChildren: (Paragraph | Table)[] = [];

  // 1. Document Title
  docChildren.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 100 },
      children: [
        new TextRun({
          text: body.title || "Clinical Commentary",
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
          text: `${body.meta || "Obstetrics & Gynecology Clinical Review"} · Citation Style: ${style === "vancouver" ? "Vancouver (superscript numerals)" : style.toUpperCase()}`,
          font: "Arial",
          size: 20, // 10pt
          italics: true,
          color: "64748B"
        })
      ]
    })
  );

  // 3. Clinical Disclaimer Banner
  docChildren.push(
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      borders: {
        top: { style: BorderStyle.NONE },
        bottom: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE },
        left: { style: BorderStyle.SINGLE, size: 24, color: "0F766E" }, // 3pt left teal border
        insideHorizontal: { style: BorderStyle.NONE },
        insideVertical: { style: BorderStyle.NONE }
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 9360, type: WidthType.DXA },
              shading: { fill: "F0FDFA" }, // Light teal tint
              margins: { top: 120, bottom: 120, left: 200, right: 160 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: "EDUCATIONAL & CLINICAL DECISION-SUPPORT DISCLAIMER: ",
                      font: "Arial",
                      size: 18,
                      bold: true,
                      color: "0F766E"
                    }),
                    new TextRun({
                      text: "AI PICO is an experimental assistive tool designed for inquiry formulation. Synthesized claims, outcomes, and proposed questions require independent clinician verification against original peer-reviewed primary literature.",
                      font: "Arial",
                      size: 18,
                      color: "334155"
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

  docChildren.push(new Paragraph({ spacing: { after: 240 } }));

  // 4. PICO Grid Table
  if (Array.isArray(body.pico) && body.pico.length) {
    docChildren.push(
      new Paragraph({
        spacing: { before: 200, after: 120 },
        children: [
          new TextRun({
            text: "Clinical Question Framework (PICO)",
            font: "Arial",
            size: 28, // 14pt
            bold: true,
            color: "0F766E"
          })
        ]
      })
    );
    docChildren.push(createPicoTable(body.pico));
    docChildren.push(new Paragraph({ spacing: { after: 240 } }));
  }

  // 5. Targeted Outcomes
  if (Array.isArray(body.outcomes) && body.outcomes.length) {
    docChildren.push(
      new Paragraph({
        spacing: { before: 200, after: 80 },
        children: [
          new TextRun({
            text: "Target Clinical Outcomes",
            font: "Arial",
            size: 24, // 12pt
            bold: true,
            color: "0F766E"
          })
        ]
      })
    );
    for (const outcome of body.outcomes) {
      docChildren.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 60 },
          children: [
            new TextRun({
              text: outcome,
              font: "Arial",
              size: 20,
              color: "1E293B"
            })
          ]
        })
      );
    }
    docChildren.push(new Paragraph({ spacing: { after: 200 } }));
  }

  // 6. Keywords
  if (Array.isArray(body.keywords) && body.keywords.length) {
    docChildren.push(
      new Paragraph({
        spacing: { before: 100, after: 60 },
        children: [
          new TextRun({
            text: "Keywords: ",
            font: "Arial",
            size: 18,
            bold: true,
            color: "0F766E"
          }),
          new TextRun({
            text: body.keywords.join(" • "),
            font: "Arial",
            size: 18,
            color: "64748B"
          })
        ]
      })
    );
    docChildren.push(new Paragraph({ spacing: { after: 200 } }));
  }

  // 7. Content Sections
  if (Array.isArray(body.sections) && body.sections.length) {
    for (const section of body.sections) {
      if (section.heading) {
        docChildren.push(
          new Paragraph({
            spacing: { before: 300, after: 120 },
            children: [
              new TextRun({
                text: String(section.heading),
                font: "Arial",
                size: 28, // 14pt
                bold: true,
                color: "0F766E"
              })
            ]
          })
        );
      }

      for (const block of section.blocks) {
        const text = String(block || "").trim();
        if (!text) continue;

        const isSubhead = text.startsWith("#### ") || (text.length < 75 && !/[.!?]\s*$/.test(text));
        if (isSubhead) {
          const cleanSub = text.replace(/^####\s+/, "");
          docChildren.push(
            new Paragraph({
              spacing: { before: 200, after: 80 },
              children: [
                new TextRun({
                  text: cleanSub,
                  font: "Arial",
                  size: 22,
                  bold: true,
                  color: "14535A"
                })
              ]
            })
          );
          continue;
        }

        // Bullet lists
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

  // 7.5. Methods & Provenance Section
  if (body.provenance) {
    const prov = body.provenance;
    docChildren.push(
      new Paragraph({
        spacing: { before: 300, after: 120 },
        children: [
          new TextRun({
            text: "Methods and Provenance",
            font: "Arial",
            size: 28, // 14pt
            bold: true,
            color: "0F766E"
          })
        ]
      })
    );

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

    for (const [lbl, val] of items) {
      docChildren.push(
        new Paragraph({
          spacing: { before: 40, after: 40 },
          children: [
            new TextRun({
              text: `${lbl}: `,
              font: "Arial",
              size: 20, // 10pt
              bold: true,
              color: "0F766E"
            }),
            new TextRun({
              text: val,
              font: "Arial",
              size: 20, // 10pt
              color: "334155"
            })
          ]
        })
      );
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
                    text: "    |    © Raouf Roshdy 2026",
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

  return await Packer.toBuffer(doc);
}

export async function buildWorkflowDocx(workflow: WorkflowExportData): Promise<Buffer> {
  const docChildren: (Paragraph | Table)[] = [];

  // Title
  docChildren.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 100 },
      children: [
        new TextRun({
          text: workflow.phrase,
          font: "Arial",
          size: 40,
          bold: true,
          color: "0F172A"
        })
      ]
    })
  );

  // Subtitle
  const categoryLabel =
    workflow.category === "established"
      ? "established"
      : workflow.category === "conflicting"
      ? "conflicting"
      : "gap";

  docChildren.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: `AIPICO workflow summary — ${categoryLabel} evidence focus`,
          font: "Arial",
          size: 20,
          italics: true,
          color: "64748B"
        })
      ]
    })
  );

  // Clinical Disclaimer Banner
  docChildren.push(
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      borders: {
        top: { style: BorderStyle.NONE },
        bottom: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE },
        left: { style: BorderStyle.SINGLE, size: 24, color: "0F766E" },
        insideHorizontal: { style: BorderStyle.NONE },
        insideVertical: { style: BorderStyle.NONE }
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 9360, type: WidthType.DXA },
              shading: { fill: "F0FDFA" },
              margins: { top: 120, bottom: 120, left: 200, right: 160 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: "EDUCATIONAL & CLINICAL DECISION-SUPPORT DISCLAIMER: ",
                      font: "Arial",
                      size: 18,
                      bold: true,
                      color: "0F766E"
                    }),
                    new TextRun({
                      text: "AI PICO is an assistive tool designed for inquiry formulation. Synthesized claims, outcomes, and proposed questions require independent clinician verification against original peer-reviewed primary literature.",
                      font: "Arial",
                      size: 18,
                      color: "334155"
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

  // 1. Clinical words (PICO) section
  docChildren.push(
    new Paragraph({
      spacing: { before: 280, after: 120 },
      children: [
        new TextRun({
          text: "Clinical words (PICO)",
          font: "Arial",
          size: 26,
          bold: true,
          color: "0F766E"
        })
      ]
    })
  );

  const roleNameMap: Record<string, string> = {
    population: "Population [P]",
    intervention: "Intervention [I]",
    comparator: "Comparator [C]",
    outcome: "Outcome [O]"
  };

  const wordRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          width: { size: 4680, type: WidthType.DXA },
          shading: { fill: "E6FFFA" },
          margins: { top: 120, bottom: 120, left: 160, right: 160 },
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: "Clinical Word", bold: true, font: "Arial", size: 20, color: "0F766E" })
              ]
            })
          ]
        }),
        new TableCell({
          width: { size: 4680, type: WidthType.DXA },
          shading: { fill: "E6FFFA" },
          margins: { top: 120, bottom: 120, left: 160, right: 160 },
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: "PICO Role", bold: true, font: "Arial", size: 20, color: "0F766E" })
              ]
            })
          ]
        })
      ]
    })
  ];

  workflow.words.forEach((w, idx) => {
    const bg = idx % 2 === 0 ? "F8FAFC" : "FFFFFF";
    wordRows.push(
      new TableRow({
        children: [
          new TableCell({
            width: { size: 4680, type: WidthType.DXA },
            shading: { fill: bg },
            margins: { top: 100, bottom: 100, left: 160, right: 160 },
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: w.word, bold: true, font: "Arial", size: 20, color: "1E293B" })
                ]
              })
            ]
          }),
          new TableCell({
            width: { size: 4680, type: WidthType.DXA },
            shading: { fill: bg },
            margins: { top: 100, bottom: 100, left: 160, right: 160 },
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: roleNameMap[w.role] || w.role, font: "Arial", size: 20, color: "0F766E" })
                ]
              })
            ]
          })
        ]
      })
    );
  });

  docChildren.push(
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
        bottom: { style: BorderStyle.SINGLE, size: 8, color: "0F766E" },
        left: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
        insideVertical: { style: BorderStyle.NONE }
      },
      rows: wordRows
    })
  );

  // 2. Screening section
  docChildren.push(
    new Paragraph({
      spacing: { before: 280, after: 120 },
      children: [
        new TextRun({
          text: "Screening",
          font: "Arial",
          size: 26,
          bold: true,
          color: "0F766E"
        })
      ]
    })
  );

  docChildren.push(
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: `Retrieved: ${workflow.screeningStats.retrieved} records. Screened: ${workflow.screeningStats.screened} records. Search relaxation level: ${workflow.screeningStats.relaxationLevel}. Excluded during exploration: ${workflow.screeningStats.excludedCount}.`,
          font: "Arial",
          size: 20,
          color: "334155"
        })
      ]
    })
  );

  // 3. Papers under consideration section
  docChildren.push(
    new Paragraph({
      spacing: { before: 280, after: 120 },
      children: [
        new TextRun({
          text: "Papers under consideration",
          font: "Arial",
          size: 26,
          bold: true,
          color: "0F766E"
        })
      ]
    })
  );

  const paperRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          width: { size: 800, type: WidthType.DXA },
          shading: { fill: "E6FFFA" },
          margins: { top: 120, bottom: 120, left: 100, right: 100 },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: "Rank", bold: true, font: "Arial", size: 18, color: "0F766E" })]
            })
          ]
        }),
        new TableCell({
          width: { size: 1200, type: WidthType.DXA },
          shading: { fill: "E6FFFA" },
          margins: { top: 120, bottom: 120, left: 100, right: 100 },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: "Relevance", bold: true, font: "Arial", size: 18, color: "0F766E" })]
            })
          ]
        }),
        new TableCell({
          width: { size: 3960, type: WidthType.DXA },
          shading: { fill: "E6FFFA" },
          margins: { top: 120, bottom: 120, left: 120, right: 120 },
          children: [
            new Paragraph({
              children: [new TextRun({ text: "Title", bold: true, font: "Arial", size: 18, color: "0F766E" })]
            })
          ]
        }),
        new TableCell({
          width: { size: 1400, type: WidthType.DXA },
          shading: { fill: "E6FFFA" },
          margins: { top: 120, bottom: 120, left: 100, right: 100 },
          children: [
            new Paragraph({
              children: [new TextRun({ text: "Journal / Year", bold: true, font: "Arial", size: 18, color: "0F766E" })]
            })
          ]
        }),
        new TableCell({
          width: { size: 1000, type: WidthType.DXA },
          shading: { fill: "E6FFFA" },
          margins: { top: 120, bottom: 120, left: 100, right: 100 },
          children: [
            new Paragraph({
              children: [new TextRun({ text: "Design", bold: true, font: "Arial", size: 18, color: "0F766E" })]
            })
          ]
        }),
        new TableCell({
          width: { size: 1000, type: WidthType.DXA },
          shading: { fill: "E6FFFA" },
          margins: { top: 120, bottom: 120, left: 100, right: 100 },
          children: [
            new Paragraph({
              children: [new TextRun({ text: "Matched", bold: true, font: "Arial", size: 18, color: "0F766E" })]
            })
          ]
        })
      ]
    })
  ];

  workflow.papers.forEach((p, idx) => {
    const bg = idx % 2 === 0 ? "F8FAFC" : "FFFFFF";
    const jYear = `${p.journal || ""}${p.journal && p.year ? ` (${p.year})` : p.year || ""}`;

    paperRows.push(
      new TableRow({
        children: [
          new TableCell({
            width: { size: 800, type: WidthType.DXA },
            shading: { fill: bg },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: String(p.rank), bold: true, font: "Arial", size: 18, color: "334155" })]
              })
            ]
          }),
          new TableCell({
            width: { size: 1200, type: WidthType.DXA },
            shading: { fill: bg },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: `${p.relevancePct}%`, bold: true, font: "Arial", size: 18, color: "0F766E" })]
              })
            ]
          }),
          new TableCell({
            width: { size: 3960, type: WidthType.DXA },
            shading: { fill: bg },
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: p.title, bold: true, font: "Arial", size: 18, color: "0F172A" })]
              }),
              ...(p.authors
                ? [
                    new Paragraph({
                      children: [new TextRun({ text: p.authors, italics: true, font: "Arial", size: 16, color: "64748B" })]
                    })
                  ]
                : [])
            ]
          }),
          new TableCell({
            width: { size: 1400, type: WidthType.DXA },
            shading: { fill: bg },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: jYear, font: "Arial", size: 18, color: "475569" })]
              })
            ]
          }),
          new TableCell({
            width: { size: 1000, type: WidthType.DXA },
            shading: { fill: bg },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: p.design || "Study", font: "Arial", size: 18, color: "475569" })]
              })
            ]
          }),
          new TableCell({
            width: { size: 1000, type: WidthType.DXA },
            shading: { fill: bg },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: p.matchedElements.join(", ") || "Broad", font: "Arial", size: 18, color: "0F766E" })]
              })
            ]
          })
        ]
      })
    );
  });

  docChildren.push(
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
        bottom: { style: BorderStyle.SINGLE, size: 8, color: "0F766E" },
        left: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
        insideVertical: { style: BorderStyle.NONE }
      },
      rows: paperRows
    })
  );

  // 4. Excluded during exploration section
  docChildren.push(
    new Paragraph({
      spacing: { before: 280, after: 120 },
      children: [
        new TextRun({
          text: "Excluded during exploration",
          font: "Arial",
          size: 26,
          bold: true,
          color: "0F766E"
        })
      ]
    })
  );

  docChildren.push(
    new Paragraph({
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: `${workflow.screeningStats.excludedCount} paper(s) excluded by researcher during exploration.`,
          font: "Arial",
          size: 20,
          color: "475569"
        })
      ]
    })
  );

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
          }
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: "AI PICO v4 · Workflow Summary · Evidence-Based Medicine",
                    font: "Arial",
                    size: 18,
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
                    text: "    |    © Raouf Roshdy 2026",
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

  return await Packer.toBuffer(doc);
}
