import test from "node:test";
import assert from "node:assert/strict";
import { extractText } from "unpdf";
import JSZip from "jszip";
import { z } from "zod";
import { buildWorkflowPdf } from "./pdf-generator.ts";
import { buildWorkflowDocx, type WorkflowExportData } from "./docx-generator.ts";

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
