import test from "node:test";
import assert from "node:assert/strict";
import { extractText } from "unpdf";
import { buildPdfBuffer } from "./pdf-generator.ts";

test("PU1. PDF export preserves mathematical symbols, Greek letters, and author diacritics", async () => {
  const testString = "≥ ≤ α ± µ é ü – ’ Müller J, Peña É";
  const payload = {
    title: `Symbol Test: ${testString}`,
    citationStyle: "vancouver" as const,
    sections: [
      {
        heading: "Evidence Section",
        blocks: [
          `Analysis of dose ≥ 200 µg vs ≤ 50 µg (± 5 µg) with threshold α = 0.05 – observed by Müller J & Peña É (résumé: é, ü).`
        ]
      }
    ],
    references: [
      `1. Müller J, Peña É. Progesterone dose ≥ 200 µg vs ≤ 50 µg. Lancet. 2024. doi:10.1016/s0140 https://pubmed.ncbi.nlm.nih.gov/31422734/`
    ],
    retainedReferences: [
      {
        pmid: "31422734",
        title: "Progesterone dose ≥ 200 µg vs ≤ 50 µg",
        authors: "Müller J, Peña É",
        year: "2024",
        doi: "10.1016/s0140"
      }
    ]
  };

  const pdfBuffer = await buildPdfBuffer(payload);
  assert.ok(pdfBuffer.length > 0, "PDF buffer must not be empty");

  const { text, totalPages } = await extractText(new Uint8Array(pdfBuffer));
  assert.equal(totalPages, 1, "Page count must be 1 for single-section deliverable");

  const combinedText = text.join("\n");
  const normText = combinedText.normalize("NFKC");

  const requiredTokens = [
    "≥",
    "≤",
    "α",
    "±",
    "µ",
    "é",
    "ü",
    "–",
    "’",
    "Müller",
    "Peña",
    "É"
  ];

  const missing: string[] = [];
  for (const token of requiredTokens) {
    const present = combinedText.includes(token) || normText.includes(token.normalize("NFKC"));
    if (!present) {
      missing.push(token);
    }
  }

  assert.equal(
    missing.length,
    0,
    `The following characters were corrupted or missing from the rendered PDF: ${missing.join(", ")}. Extracted text: ${JSON.stringify(combinedText)}`
  );
});
