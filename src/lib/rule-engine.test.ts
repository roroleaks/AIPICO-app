import test from "node:test";
import assert from "node:assert/strict";
import { ruleAnalyze, ruleClarify, ruleFormulate } from "./rule-engine.ts";
import { KB, type Analysis } from "./kb.ts";

/**
 * These functions are the deterministic fallback for the AI path. The route reaches them from
 * inside a catch block, so a throw here does not degrade gracefully - it escapes the catch and
 * becomes a bare HTTP 500 with a zero-byte body (audit F-03). Each case below previously threw
 * `Cannot read properties of undefined (reading 'find')` or produced a malformed result.
 */

const FULL: Analysis = {
  specialty: "infertility",
  specialtyLabel: KB.infertility.label,
  condition: "PCOS",
  intervention: "IVF",
  comparator: "IUI",
  questionType: "Therapy / Prognosis",
  framework: "PICO",
  missing: ["outcome"],
  interpretation: "Infertility treatment question.",
  source: "rules"
};

test("ruleClarify survives a completely empty analysis", () => {
  const r = ruleClarify({} as Analysis, {});
  assert.equal(r.done, true);
  assert.equal(r.field, null);
  assert.deepEqual(r.options, []);
});

test("ruleClarify survives the shapes that are truthy but not analyses", () => {
  for (const bad of [[], "x", 0, true]) {
    const r = ruleClarify(bad as unknown as Analysis, {});
    assert.equal(r.done, true, `failed for ${JSON.stringify(bad)}`);
  }
});

test("ruleClarify survives an absent or non-array missing list", () => {
  for (const missing of [undefined, null, "outcome", 42, {}]) {
    const r = ruleClarify({ ...FULL, missing } as unknown as Analysis, { condition: "PCOS" });
    // With no usable `missing` list there is nothing left to ask, so clarification is complete.
    assert.equal(r.done, true, `failed for missing=${JSON.stringify(missing)}`);
  }
});

test("ruleClarify survives an unknown specialty", () => {
  const r = ruleClarify({ ...FULL, specialty: "nope" } as unknown as Analysis, {});
  assert.equal(r.done, true);
});

test("ruleClarify survives absent answered and asked nothing", () => {
  const r = ruleClarify({ ...FULL, missing: [] } as Analysis, undefined as unknown as Record<string, string>);
  assert.equal(r.done, true);
});

test("ruleClarify still asks a real question for a real analysis", () => {
  const r = ruleClarify(FULL, { condition: "PCOS" });
  assert.equal(r.done, false);
  assert.equal(r.field, "outcome");
  assert.ok(r.options.length > 0, "expected outcome options");
  assert.equal(r.source, "rules");
});

test("ruleFormulate survives an empty analysis instead of inventing content", () => {
  const r = ruleFormulate({} as Analysis, {});
  // It must return a structurally valid Formulation rather than throwing. The placeholder wording
  // it falls back to is tracked separately as F-05.
  assert.equal(typeof r.finalQuestion, "string");
  assert.ok(r.elements.length > 0);
  assert.equal(r.source, "rules");
});

test("ruleFormulate survives null analysis and null answered", () => {
  const r = ruleFormulate(null as unknown as Analysis, null as unknown as Record<string, string>);
  assert.equal(typeof r.finalQuestion, "string");
  assert.ok((r.variants || []).length > 0);
});

test("ruleFormulate honours a real analysis", () => {
  const r = ruleFormulate(FULL, { outcome: "live birth" });
  assert.match(r.finalQuestion, /PCOS/);
  assert.match(r.finalQuestion, /IVF/);
  assert.equal(r.framework, "PICO");
});

test("ruleAnalyze survives an empty string", () => {
  const r = ruleAnalyze("");
  assert.equal(r.specialty, null);
  assert.deepEqual(r.missing, ["condition", "intervention", "comparator", "outcome"]);
  assert.equal(r.source, "rules");
});
