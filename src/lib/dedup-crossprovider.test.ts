import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDoi } from "./deliverable-integrity.ts";
import { refCanonicalKeys } from "./explore-scoring.ts";

test("normalizeDoi normalizes URL prefix, doi: prefix, and bare form to canonical DOI", () => {
  const urlForm = normalizeDoi("https://doi.org/10.1000/x");
  const prefixForm = normalizeDoi("doi:10.1000/x");
  const bareForm = normalizeDoi("10.1000/x");
  assert.equal(urlForm, "10.1000/x");
  assert.equal(prefixForm, "10.1000/x");
  assert.equal(bareForm, "10.1000/x");
});

test("refCanonicalKeys produces matching canonical DOI key across providers", () => {
  const recA = { title: "Clinical trial of therapy", doi: "10.1000/same", authors: "A B", year: "2020" };
  const recB = { title: "Clinical trial of therapy", doi: "https://doi.org/10.1000/same", authors: "A B", year: "2020" };
  const keysA = refCanonicalKeys(recA);
  const keysB = refCanonicalKeys(recB);

  assert.ok(keysA.includes("d:10.1000/same"));
  assert.ok(keysB.includes("d:10.1000/same"));
});

test("refCanonicalKeys differentiates records with distinct DOIs", () => {
  const rec1 = { title: "Trial one result", doi: "10.1000/d1", authors: "Smith J", year: "2020" };
  const rec2 = { title: "Trial two result", doi: "10.1000/d2", authors: "Smith J", year: "2020" };
  const keys1 = refCanonicalKeys(rec1);
  const keys2 = refCanonicalKeys(rec2);

  assert.ok(keys1.includes("d:10.1000/d1"));
  assert.ok(keys2.includes("d:10.1000/d2"));
  assert.equal(keys1.includes("d:10.1000/d2"), false);
});
