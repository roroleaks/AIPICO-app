import test from "node:test";
import assert from "node:assert/strict";
import {
  validateDeliverableIntegrity,
  type DeliverableIntegrityInput
} from "./deliverable-integrity.ts";
import { formatReference, type AuditableRef } from "./relevance.ts";

const RECORDS: AuditableRef[] = [
  {
    pmid: "42431373",
    doi: "10.1016/j.ajogmf.2026.102055",
    title: "Progesterone and cerclage together for short cervix",
    authors: "Berghella V, Paladino I, Gulersen M",
    year: "2026",
    journal: "AJOG MFM",
    url: "https://pubmed.ncbi.nlm.nih.gov/42431373/"
  },
  {
    pmid: "42425371",
    doi: "10.1016/j.ajogmf.2026.102054",
    title: "Preoperative considerations for cervical cerclage",
    authors: "Paladino I, Gulersen M, Roman A",
    year: "2026",
    journal: "AJOG MFM",
    url: "https://pubmed.ncbi.nlm.nih.gov/42425371/"
  }
];

const REF_A = formatReference(RECORDS[0]);
const REF_B = formatReference(RECORDS[1]);

test("accepts a consistent deliverable whose exports match the retained set", () => {
  const result = validateDeliverableIntegrity({
    fields: {
      abstract: "Short cervix confers risk of preterm birth.",
      introduction: "Progesterone has been evaluated (Berghella 2026).",
      discussion: "Cerclage remains standard (Paladino 2026).",
      conclusion: "Both interventions target the same outcome."
    },
    references: [REF_A, REF_B],
    retainedRecords: RECORDS
  });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("rejects a citation in any narrative field that no retained record supports", () => {
  for (const field of ["abstract", "introduction", "discussion", "conclusion"] as const) {
    const fields: Record<string, string> = {
      abstract: "",
      introduction: "",
      discussion: "",
      conclusion: ""
    };
    fields[field] = "Progesterone reduces preterm birth (Berghella 2026) and is well tolerated (Ghost 2025).";
    const result = validateDeliverableIntegrity({
      fields,
      references: [REF_A],
      retainedRecords: RECORDS
    });
    assert.equal(result.ok, false, `${field} must be checked, not just discussion`);
    assert.ok(
      result.unsupportedCitations.some(c => c.includes("Ghost")),
      `${field}: expected Ghost 2025 to be reported unsupported, got ${JSON.stringify(result.unsupportedCitations)}`
    );
  }
});

test("rejects an orphan citation with no entry in the reference list", () => {
  // Kansal appears on no listed reference, so the citation resolves to nothing in the
  // bibliography even though the author is a real short-cervix investigator.
  const result = validateDeliverableIntegrity({
    fields: { discussion: "Progesterone reduces preterm birth (Berghella 2026) and cerclage helps (Kansal 2026)." },
    references: [REF_A],
    retainedRecords: RECORDS
  });
  assert.equal(result.ok, false);
  assert.ok(result.orphanCitations.length > 0, JSON.stringify(result));
});

test("accepts a citation by any author on a retained record, not only the first", () => {
  // The gate mirrors the pipeline's resolution rather than tightening it. A stricter gate would
  // reject commentary the reconciliation stage considers sound, and would reject it in
  // production while every other integrity check passes.
  const result = validateDeliverableIntegrity({
    fields: { discussion: "Cerclage technique has been described (Gulersen 2026)." },
    references: [REF_A],
    retainedRecords: RECORDS
  });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("rejects a published reference that no retained record accounts for", () => {
  const result = validateDeliverableIntegrity({
    fields: { discussion: "An unlisted source is cited here (Berghella 2026)." },
    references: [REF_A, "Smith Q. 2020. \"A fabricated paper.\" Journal of Nothing. doi:10.9/fake"],
    retainedRecords: RECORDS
  });
  assert.equal(result.ok, false);
  assert.ok(result.unresolvedReferences.length >= 1);
});

test("rejects an export that reintroduces a source the claim filter rejected", () => {
  const rejected = formatReference({
    pmid: "99999999",
    doi: "10.1016/j.ajogmf.2026.999999",
    title: "An off-topic record",
    authors: "Nobody X",
    year: "2026",
    journal: "AJOG MFM"
  });
  const result = validateDeliverableIntegrity({
    fields: { discussion: "Progesterone reduces preterm birth (Berghella 2026)." },
    references: [REF_A],
    retainedRecords: RECORDS,
    // The Word/PDF/clipboard path trying to smuggle the rejected record back in.
    exportReferences: [REF_A, rejected]
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.extraExportReferences.length, 1);
});

test("does not report every reference as uncited when no narrative travels with the export", () => {
  // Reference-list PDFs and the Word bibliography legitimately carry no prose. Treating their
  // references as uncited would refuse a correct export.
  const result = validateDeliverableIntegrity({
    fields: {},
    references: [REF_A, REF_B],
    retainedRecords: RECORDS,
    exportReferences: [REF_A, REF_B]
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.uncitedReferences, []);
});

test("rejects the same reference listed twice", () => {
  const result = validateDeliverableIntegrity({
    fields: { discussion: "Progesterone reduces preterm birth (Berghella 2026)." },
    references: [REF_A, REF_A],
    retainedRecords: RECORDS
  });
  assert.equal(result.ok, false);
  assert.ok(result.duplicateCitationKeys.length >= 1);
});

test("is deterministic for the same input", () => {
  const input = {
    fields: { discussion: "Progesterone reduces preterm birth (Berghella 2026) and cerclage helps (Paladino 2026)." },
    references: [REF_A],
    retainedRecords: RECORDS
  };
  const first = JSON.stringify(validateDeliverableIntegrity(input));
  for (let i = 0; i < 10; i++) {
    assert.equal(JSON.stringify(validateDeliverableIntegrity(input)), first);
  }
});

test("accepts the same set whichever field order the caller supplies", () => {
  const a = validateDeliverableIntegrity({
    fields: { abstract: "Risk is elevated (Berghella 2026).", discussion: "Cerclage helps (Paladino 2026)." },
    references: [REF_A, REF_B],
    retainedRecords: RECORDS
  });
  const b = validateDeliverableIntegrity({
    fields: { discussion: "Cerclage helps (Paladino 2026).", abstract: "Risk is elevated (Berghella 2026)." },
    references: [REF_A, REF_B],
    retainedRecords: RECORDS
  });
  assert.equal(a.ok, b.ok);
  assert.deepEqual(a.orphanCitations, b.orphanCitations);
  assert.deepEqual(a.uncitedReferences, b.uncitedReferences);
});

// --- Malformed input contract (audit F-02) ---------------------------------
//
// /api/pdf passes the untrusted request body straight into this gate, so the gate is reachable
// with whatever shape a caller sends. Each case below previously threw `ref.trim is not a
// function` or similar and surfaced as an opaque HTTP 500. The requirement is that it refuses
// with a structured, named reason and never throws.

test("refuses object-shaped references instead of throwing", () => {
  const r = validateDeliverableIntegrity({
    fields: {},
    references: [{ citation: "Smith 2020 fake" }] as unknown as string[],
    retainedRecords: RECORDS
  });
  assert.equal(r.ok, false);
  assert.equal(r.malformedReferences.length, 1);
  assert.match(r.malformedReferences[0], /^references\[0\] must be a string, received object$/);
});

test("refuses malformed references even when valid records accompany them", () => {
  const r = validateDeliverableIntegrity({
    fields: {},
    references: [REF_A, { nope: true }, null, 42] as unknown as string[],
    retainedRecords: RECORDS
  });
  assert.equal(r.ok, false);
  assert.equal(r.malformedReferences.length, 3);
  assert.match(r.malformedReferences[0], /references\[1\] .* received object$/);
  assert.match(r.malformedReferences[1], /references\[2\] .* received null$/);
  assert.match(r.malformedReferences[2], /references\[3\] .* received number$/);
});

test("refuses malformed exportReferences", () => {
  const r = validateDeliverableIntegrity({
    fields: {},
    references: [REF_A],
    retainedRecords: RECORDS,
    exportReferences: [REF_A, { citation: "Smith 2020" }] as unknown as string[]
  });
  assert.equal(r.ok, false);
  assert.match(r.malformedReferences[0], /^exportReferences\[1\] must be a string/);
});

test("accepts a non-array references value as absent rather than crashing", () => {
  const r = validateDeliverableIntegrity({
    fields: { abstract: "No citations here." },
    references: "not an array" as unknown as string[],
    retainedRecords: RECORDS
  });
  assert.equal(r.ok, false);
  assert.match(r.malformedReferences[0], /^references must be an array of strings, received string$/);
});

test("survives null fields and absent retainedRecords", () => {
  const r = validateDeliverableIntegrity({
    fields: null as unknown as Record<string, string>,
    references: [REF_A],
    retainedRecords: undefined as unknown as AuditableRef[]
  });
  // No narrative travels with it, so "uncited" cannot be judged, but the reference has no
  // retained record behind it and must be reported as unresolved rather than throwing.
  assert.equal(r.ok, false);
  assert.deepEqual(r.unresolvedReferences, [REF_A]);
  assert.deepEqual(r.malformedReferences, []);
});

test("survives a completely absent input object", () => {
  const r = validateDeliverableIntegrity(undefined as unknown as DeliverableIntegrityInput);
  assert.equal(r.ok, true);
  assert.deepEqual(r.malformedReferences, []);
});

test("drops non-object retainedRecords without failing the whole call", () => {
  const r = validateDeliverableIntegrity({
    fields: { abstract: "Progesterone helps (Berghella 2026)." },
    references: [REF_A],
    retainedRecords: [RECORDS[0], null, "x"] as unknown as AuditableRef[]
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.malformedReferences, []);
});

test("reports non-string narrative field values", () => {
  const r = validateDeliverableIntegrity({
    fields: { abstract: "ok", discussion: 7 } as unknown as Record<string, string>,
    references: [REF_A],
    retainedRecords: RECORDS
  });
  assert.equal(r.ok, false);
  assert.match(r.malformedReferences[0], /^fields\.discussion must be a string, received number$/);
});
