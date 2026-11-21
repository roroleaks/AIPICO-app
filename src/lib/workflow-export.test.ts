import test from "node:test";
import assert from "node:assert/strict";
import { extractText } from "unpdf";
import JSZip from "jszip";
import { z } from "zod";
import { buildWorkflowPdf } from "./pdf-generator.ts";
import { buildWorkflowDocx, type WorkflowExportData } from "./docx-generator.ts";
import { composeManuscript } from "./manuscript-composer.ts";
import type { ExploreRecord } from "./explore-scoring.ts";

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
  papers: z.array(workflowPaperSchema).max(50),
  title: z.string().max(240).optional(),
  abstract: z.array(z.string()).max(8).optional(),
  sections: z.array(z.object({
    heading: z.string().max(120),
    paragraphs: z.array(z.string()).min(1)
  })).max(10).optional(),
  references: z.array(z.string().max(2000)).max(50).optional(),
  citationStyle: z.enum(["vancouver", "apa", "harvard"]).optional(),
  aiEnriched: z.boolean().optional()
});

const sampleWorkflow: WorkflowExportData = {
  words: [
    { word: "poor responders", role: "population" },
    { word: "ivf", role: "intervention" },
    { word: "growth hormone", role: "comparator" },
    { word: "clinical pregnancy rate", role: "outcome" }
  ],
  category: "conflicting",
  phrase: "(P) poor responders (I) ivf (C) growth hormone (O) clinical pregnancy rate",
  screeningStats: {
    retrieved: 45,
    screened: 45,
    relaxationLevel: 0,
    excludedCount: 2
  },
  papers: [
    {
      rank: 1,
      relevancePct: 95,
      title: "Growth hormone co-treatment in poor ovarian responders undergoing IVF",
      authors: "Smith J, Doe A",
      journal: "Hum Reprod",
      year: "2023",
      design: "Systematic review and meta-analysis",
      matchedElements: ["Population", "Intervention", "Comparator", "Outcome"]
    },
    {
      rank: 2,
      relevancePct: 78,
      title: "Clinical pregnancy outcomes with adjuvant growth hormone therapy",
      authors: "Lee K, Chen M",
      journal: "Fertil Steril",
      year: "2022",
      design: "Randomized controlled trial",
      matchedElements: ["Population", "Intervention", "Outcome"]
    }
  ]
};

test("WF1. buildWorkflowPdf generates valid PDF with phrase, words, and exact percentages", async () => {
  const pdfBuffer = await buildWorkflowPdf(sampleWorkflow);
  assert.ok(pdfBuffer.length > 10_000, `PDF buffer must exceed 10 KB, got ${pdfBuffer.length}`);

  // Signature check: starts with %PDF
  const sig = pdfBuffer.subarray(0, 4).toString("utf8");
  assert.equal(sig, "%PDF", "PDF signature must start with %PDF");

  const parsed = await extractText(new Uint8Array(pdfBuffer));
  const fullText = parsed.text.join(" ");

  assert.ok(
    fullText.includes("poor responders"),
    "PDF text must include population word"
  );
  assert.ok(
    fullText.includes("growth hormone"),
    "PDF text must include intervention/comparator word"
  );
  assert.ok(
    fullText.includes("conflicting evidence focus"),
    "PDF text must declare category focus"
  );
  assert.ok(
    fullText.includes("95% related"),
    "PDF text must render exact computed percentage for paper 1"
  );
  assert.ok(
    fullText.includes("78% related"),
    "PDF text must render exact computed percentage for paper 2"
  );
  assert.ok(
    fullText.includes("2 paper(s) excluded by researcher"),
    "PDF text must render exclusion metrics"
  );
});

test("WF2. buildWorkflowDocx generates valid DOCX with phrase, words, and exact percentages", async () => {
  const docxBuffer = await buildWorkflowDocx(sampleWorkflow);
  assert.ok(docxBuffer.length > 10_000, `DOCX buffer must exceed 10 KB, got ${docxBuffer.length}`);

  const zip = await JSZip.loadAsync(docxBuffer);
  const docXml = await zip.file("word/document.xml")?.async("text");
  assert.ok(docXml, "DOCX must contain word/document.xml");

  assert.ok(
    docXml.includes("poor responders"),
    "DOCX xml must include population word"
  );
  assert.ok(
    docXml.includes("growth hormone"),
    "DOCX xml must include comparator word"
  );
  assert.ok(
    docXml.includes("95%"),
    "DOCX xml must render exact computed percentage"
  );
  assert.ok(
    docXml.includes("conflicting evidence focus"),
    "DOCX xml must declare category focus"
  );
  assert.ok(
    docXml.includes("2 paper(s) excluded by researcher"),
    "DOCX xml must render excluded count"
  );
});

test("WF3. workflowSchema validates valid payload and rejects out-of-bounds percentages or word counts", () => {
  // Valid payload passes
  const validRes = workflowSchema.safeParse(sampleWorkflow);
  assert.ok(validRes.success, "Valid workflow must pass validation");

  // Reject percentage > 100
  const invalidPct = {
    ...sampleWorkflow,
    papers: [
      {
        ...sampleWorkflow.papers[0],
        relevancePct: 105
      }
    ]
  };
  const pctRes = workflowSchema.safeParse(invalidPct);
  assert.equal(pctRes.success, false, "relevancePct > 100 must be rejected");

  // Reject negative percentage
  const negPct = {
    ...sampleWorkflow,
    papers: [
      {
        ...sampleWorkflow.papers[0],
        relevancePct: -5
      }
    ]
  };
  const negRes = workflowSchema.safeParse(negPct);
  assert.equal(negRes.success, false, "relevancePct < 0 must be rejected");

  // Reject fewer than 3 words
  const fewWords = {
    ...sampleWorkflow,
    words: [
      { word: "poor responders", role: "population" as const },
      { word: "ivf", role: "intervention" as const }
    ]
  };
  const fewRes = workflowSchema.safeParse(fewWords);
  assert.equal(fewRes.success, false, "Fewer than 3 words must be rejected");

  // Reject more than 5 words
  const manyWords = {
    ...sampleWorkflow,
    words: [
      { word: "w1", role: "population" as const },
      { word: "w2", role: "intervention" as const },
      { word: "w3", role: "comparator" as const },
      { word: "w4", role: "outcome" as const },
      { word: "w5", role: "outcome" as const },
      { word: "w6", role: "outcome" as const }
    ]
  };
  const manyRes = workflowSchema.safeParse(manyWords);
  assert.equal(manyRes.success, false, "More than 5 words must be rejected");
});

const sampleExploreRecords: ExploreRecord[] = [
  {
    title: "Growth hormone co-treatment in poor ovarian responders undergoing IVF: a meta-analysis",
    authors: "Smith J, Doe A",
    journal: "Hum Reprod",
    year: "2023",
    relevancePct: 95,
    matchedElements: ["P", "I", "C", "O"],
    pmid: "31000001",
    doi: "10.1093/humrep/dead012"
  },
  {
    title: "Clinical pregnancy outcomes with adjuvant growth hormone therapy",
    authors: "Lee K, Chen M",
    journal: "Fertil Steril",
    year: "2022",
    relevancePct: 78,
    matchedElements: ["P", "I", "O"],
    pmid: "31000002",
    doi: "10.1016/j.fertnstert.2022.01.005"
  }
];

test("WF4. Manuscript PDF export in Vancouver, APA, and Harvard with zero http occurrences", async () => {
  for (const style of ["vancouver", "apa", "harvard"] as const) {
    const manuscript = composeManuscript({
      words: sampleWorkflow.words,
      category: sampleWorkflow.category,
      phrase: sampleWorkflow.phrase,
      screeningStats: sampleWorkflow.screeningStats,
      records: sampleExploreRecords,
      style
    });

    const exportData: WorkflowExportData = {
      ...sampleWorkflow,
      title: manuscript.title,
      abstract: manuscript.abstract,
      sections: manuscript.sections,
      references: manuscript.references,
      citationStyle: style,
      aiEnriched: false
    };

    const pdfBuffer = await buildWorkflowPdf(exportData);
    assert.ok(pdfBuffer.length > 10_000, `PDF buffer in ${style} must exceed 10 KB, got ${pdfBuffer.length}`);
    const sig = pdfBuffer.subarray(0, 4).toString("utf8");
    assert.equal(sig, "%PDF", "PDF signature must start with %PDF");

    const parsed = await extractText(new Uint8Array(pdfBuffer));
    const fullText = parsed.text.join(" ").replace(/\s+/g, " ");

    assert.ok(fullText.includes(sampleWorkflow.phrase), `PDF must include the phrase for ${style}`);
    assert.ok(!fullText.includes("http:"), `PDF in ${style} must contain zero http: occurrences`);
    assert.ok(!fullText.includes("https:"), `PDF in ${style} must contain zero https: occurrences`);

    if (style === "vancouver") {
      assert.ok(fullText.includes("[1]"), "Vancouver PDF must contain numeric citation [1]");
      assert.ok(fullText.includes("1. Smith J, Doe A."), "Vancouver PDF must contain formatted reference");
    } else if (style === "apa") {
      assert.ok(fullText.includes("Smith & Doe, 2023"), "APA PDF must contain author-year citation");
      assert.ok(fullText.includes("Smith, J., & Doe, A. (2023)."), "APA PDF must contain APA formatted reference");
    } else if (style === "harvard") {
      assert.ok(fullText.includes("Smith and Doe 2023"), "Harvard PDF must contain author-year citation");
      assert.ok(fullText.includes("Smith, J and Doe, A, 2023."), "Harvard PDF must contain Harvard formatted reference");
    }
  }
});

test("WF5. Manuscript DOCX export in Vancouver, APA, and Harvard with zero http occurrences", async () => {
  for (const style of ["vancouver", "apa", "harvard"] as const) {
    const manuscript = composeManuscript({
      words: sampleWorkflow.words,
      category: sampleWorkflow.category,
      phrase: sampleWorkflow.phrase,
      screeningStats: sampleWorkflow.screeningStats,
      records: sampleExploreRecords,
      style
    });

    const exportData: WorkflowExportData = {
      ...sampleWorkflow,
      title: manuscript.title,
      abstract: manuscript.abstract,
      sections: manuscript.sections,
      references: manuscript.references,
      citationStyle: style,
      aiEnriched: false
    };

    const docxBuffer = await buildWorkflowDocx(exportData);
    assert.ok(docxBuffer.length > 10_000, `DOCX buffer in ${style} must exceed 10 KB, got ${docxBuffer.length}`);

    const zip = await JSZip.loadAsync(docxBuffer);
    const docXml = await zip.file("word/document.xml")?.async("text");
    assert.ok(docXml, `DOCX must contain word/document.xml for ${style}`);

    // Extract document prose from <w:t> tags
    const textMatches = (docXml || "").match(/<w:t[^>]*>(.*?)<\/w:t>/g) || [];
    const extractedContent = textMatches.map(m => m.replace(/<[^>]+>/g, "")).join(" ").replace(/&amp;/g, "&");

    assert.ok(extractedContent.includes(sampleWorkflow.phrase), `DOCX must include the phrase for ${style}`);
    assert.ok(!extractedContent.includes("http:"), `DOCX content in ${style} must contain zero http: occurrences`);
    assert.ok(!extractedContent.includes("https:"), `DOCX content in ${style} must contain zero https: occurrences`);

    if (style === "vancouver") {
      assert.ok(extractedContent.includes("[1]"), "Vancouver DOCX must contain numeric citation [1]");
      assert.ok(extractedContent.includes("1. Smith J, Doe A."), "Vancouver DOCX must contain formatted reference");
    } else if (style === "apa") {
      assert.ok(extractedContent.includes("Smith & Doe, 2023"), "APA DOCX must contain author-year citation");
      assert.ok(extractedContent.includes("Smith, J., & Doe, A. (2023)."), "APA DOCX must contain APA formatted reference");
    } else if (style === "harvard") {
      assert.ok(extractedContent.includes("Smith and Doe 2023"), "Harvard DOCX must contain author-year citation");
      assert.ok(extractedContent.includes("Smith, J and Doe, A, 2023."), "Harvard DOCX must contain Harvard formatted reference");
    }
  }
});

test("WF6. Additive workflowSchema bounds validation", () => {
  const manuscript = composeManuscript({
    words: sampleWorkflow.words,
    category: sampleWorkflow.category,
    phrase: sampleWorkflow.phrase,
    screeningStats: sampleWorkflow.screeningStats,
    records: sampleExploreRecords,
    style: "vancouver"
  });

  const fullData = {
    ...sampleWorkflow,
    title: manuscript.title,
    abstract: manuscript.abstract,
    sections: manuscript.sections,
    references: manuscript.references,
    citationStyle: "vancouver" as const,
    aiEnriched: false
  };

  const validRes = workflowSchema.safeParse(fullData);
  assert.ok(validRes.success, "Full manuscript export data must pass workflowSchema validation");

  // Reject more than 10 sections
  const excessiveSections = {
    ...fullData,
    sections: Array(11).fill({ heading: "H", paragraphs: ["P"] })
  };
  const secRes = workflowSchema.safeParse(excessiveSections);
  assert.equal(secRes.success, false, "More than 10 sections must be rejected");

  // Reject more than 50 references
  const excessiveRefs = {
    ...fullData,
    references: Array(51).fill("1. Ref text")
  };
  const refRes = workflowSchema.safeParse(excessiveRefs);
  assert.equal(refRes.success, false, "More than 50 references must be rejected");

  // Reject more than 8 abstract sentences
  const excessiveAbstract = {
    ...fullData,
    abstract: Array(9).fill("Abstract sentence.")
  };
  const absRes = workflowSchema.safeParse(excessiveAbstract);
  assert.equal(absRes.success, false, "More than 8 abstract sentences must be rejected");
});
