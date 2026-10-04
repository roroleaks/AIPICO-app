import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceSet, normalizeCitationKey } from "./evidence-set.ts";

test("a Crossref cr: identifier with a DOI normalizes to the DOI", () => {
  const k = normalizeCitationKey({ crossrefId: "cr:123", doi: "10.1000/abc", title: "T", authors: "A B", year: "2020" });
  assert.ok(k.startsWith("doi:"), k);
  assert.ok(!k.includes("cr:"), k);
});

test("a Crossref cr: identifier without a DOI normalizes to crossref provenance", () => {
  const k = normalizeCitationKey({ crossrefId: "cr:123", title: "T", authors: "A B", year: "2020" });
  assert.equal(k, "crossref:123");
});

test("the same DOI from Crossref and OpenAlex is one retained record", async () => {
  const es = await buildEvidenceSet([
    { crossrefId: "cr:555", doi: "10.1000/same", title: "T", authors: "A B", year: "2020" },
    { openAlexId: "W123", doi: "10.1000/same", title: "T", authors: "A B", year: "2020" }
  ]);
  assert.equal(es.retainedCount, 1);
  assert.equal(es.warnings.length, 1);
});

test("the same DOI from PubMed and Crossref is one retained record", async () => {
  const es = await buildEvidenceSet([
    { pmid: "1", doi: "10.1000/same2", title: "T", authors: "A B", year: "2020" },
    { crossrefId: "cr:999", doi: "10.1000/same2", title: "T", authors: "A B", year: "2020" }
  ]);
  assert.equal(es.retainedCount, 1);
  assert.deepEqual(Array.from(es.allowedCitationKeys), ["doi:10.1000/same2"]);
});

test("similar title, author and year with different DOIs stay separate", async () => {
  const es = await buildEvidenceSet([
    { doi: "10.1000/d1", title: "Same Title", authors: "Smith J", year: "2020" },
    { doi: "10.1000/d2", title: "Same Title", authors: "Smith J", year: "2020" }
  ]);
  assert.equal(es.retainedCount, 2);
});

test("a DOI URL and its bare DOI form are the same key", () => {
  const a = normalizeCitationKey({ doi: "https://doi.org/10.1000/x", title: "T", authors: "A B", year: "2020" });
  const b = normalizeCitationKey({ doi: "doi:10.1000/x", title: "T", authors: "A B", year: "2020" });
  assert.equal(a, b, `${a} vs ${b}`);
});
