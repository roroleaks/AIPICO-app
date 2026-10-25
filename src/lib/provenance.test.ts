import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { extractText } from "unpdf";
import { buildPdfBuffer } from "./pdf-generator.ts";
import { buildDocxBuffer } from "./docx-generator.ts";
import { resolveProvenance, type ProvenanceMetadata } from "./provenance.ts";
import { validateDeliverableIntegrity } from "./deliverable-integrity.ts";

const sampleProvenance: ProvenanceMetadata = {
  retrievedAt: "2026-10-25T20:45:00.000Z",
  queryStrings: [
    "(\"thin endometrium\"[tiab] OR \"Endometrium\"[MeSH Terms]) AND (\"PRP\"[tiab] OR \"Platelet-Rich Plasma\"[MeSH Terms]) NOT (animals[mh] NOT humans[mh])"
  ],
  sources: ["PubMed / NCBI E-utilities (MEDLINE)", "Local Clinical Knowledge Base (KB)"],
  engine: "rules (deterministic-rules)",
  promptVersion: "pico-commentary-v3.1",
  buildCommit: "41d4a4d"
};

const basePayload = {
  title: "Clinical Commentary: High-Risk Obstetrics & Provenance",
  docType: "Clinical Commentary",
  citationStyle: "vancouver" as const,
  sections: [
    {
      heading: "1. Clinical Background",
      blocks: ["Evaluation of intrauterine platelet-rich plasma in thin endometrium."]
    }
  ],
  references: [
    "1. Smith J. Trial of progesterone and PRP. Lancet. 2024. https://pubmed.ncbi.nlm.nih.gov/31422734/"
  ],
  retainedReferences: [
    {
      pmid: "31422734",
      title: "Trial of progesterone and PRP",
      year: "2024",
      authors: "Smith J"
    }
  ],
  provenance: sampleProvenance
};

test("PR1. PDF export renders Methods & Provenance block with all metadata fields", async () => {
  const pdfBuffer = await buildPdfBuffer(basePayload);
  assert.ok(pdfBuffer.length > 0, "PDF buffer must be non-empty");

  const { text } = await extractText(new Uint8Array(pdfBuffer));
  const fullText = text.join("\n");

  assert.ok(fullText.includes("Methods and Provenance"), "Must contain Methods and Provenance section");
  assert.ok(fullText.includes("2026-10-25T20:45:00.000Z"), "Must contain retrieval timestamp");
  assert.ok(fullText.includes("PubMed / NCBI E-utilities"), "Must contain sources queried");
  assert.ok(fullText.includes("thin endometrium"), "Must contain query string");
  assert.ok(fullText.includes("rules (deterministic-rules)"), "Must contain engine path");
  assert.ok(fullText.includes("pico-commentary-v3.1"), "Must contain prompt version");
  assert.ok(fullText.includes("41d4a4d"), "Must contain build commit");
});

test("PR2. DOCX export renders Methods & Provenance block with all metadata fields", async () => {
  const docxBuffer = await buildDocxBuffer(basePayload);
  assert.ok(docxBuffer.length > 0, "DOCX buffer must be non-empty");

  const zip = await JSZip.loadAsync(docxBuffer);
  const docXml = await zip.file("word/document.xml")?.async("text");
  assert.ok(docXml, "DOCX must contain word/document.xml");

  assert.ok(docXml.includes("Methods and Provenance"), "Must contain Methods and Provenance heading");
  assert.ok(docXml.includes("2026-10-25T20:45:00.000Z"), "Must contain retrieval timestamp");
  assert.ok(docXml.includes("PubMed / NCBI E-utilities"), "Must contain sources queried");
  assert.ok(docXml.includes("thin endometrium"), "Must contain query string");
  assert.ok(docXml.includes("rules (deterministic-rules)"), "Must contain engine path");
  assert.ok(docXml.includes("pico-commentary-v3.1"), "Must contain prompt version");
  assert.ok(docXml.includes("41d4a4d"), "Must contain build commit");
});

test("PR3. Deliverable integrity parity gate detects tampered references in export payloads", () => {
  const tamperedPayload = {
    title: basePayload.title,
    sections: basePayload.sections,
    references: [
      "1. Fake Author. Fabricated paper. 2026. https://pubmed.ncbi.nlm.nih.gov/99999999/"
    ],
    retainedReferences: basePayload.retainedReferences,
    citationStyle: basePayload.citationStyle
  };

  const integrity = validateDeliverableIntegrity(tamperedPayload);
  assert.equal(integrity.ok, false, "Tampered reference must fail parity gate");
  assert.ok(
    integrity.unresolvedReferences.length > 0 || integrity.malformedReferences.length > 0,
    "Must report unresolved or malformed reference"
  );
});

test("PR4. resolveProvenance dynamically populates environment and runtime values", () => {
  const resolved = resolveProvenance();
  assert.ok(resolved.retrievedAt, "retrievedAt must not be empty");
  assert.ok(resolved.engine, "engine must not be empty");
  assert.ok(resolved.sources && resolved.sources.length > 0, "sources must not be empty");
  assert.ok(resolved.promptVersion, "promptVersion must not be empty");
  assert.ok(resolved.buildCommit, "buildCommit must not be empty");
});
