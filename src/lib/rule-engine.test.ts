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

test("ruleClarify keeps asking when the specialty is unknown (F-05 root cause)", () => {
  // It used to return done: true here, which skipped clarification entirely and let
  // ruleFormulate fabricate "Women with the population of interest".
  const r = ruleClarify({ ...FULL, specialty: "nope" } as unknown as Analysis, {});
  assert.equal(r.done, false);
  assert.equal(r.field, "outcome");
  assert.equal(r.allowFreeText, true);
  assert.ok(r.questionText.length > 0);
  // Outcome suggestions come from the cross-specialty outcome logic, which works without a spec.
  assert.ok(Array.isArray(r.options));

  // A field with no spec behind it offers no suggestions but must still ask, free text only.
  const c = ruleClarify(
    { ...FULL, specialty: null, missing: ["condition"] } as unknown as Analysis,
    {}
  );
  assert.equal(c.done, false);
  assert.equal(c.field, "condition");
  assert.deepEqual(c.options, []);
  assert.equal(c.allowFreeText, true);
});

test("ruleClarify walks every missing field with no specialty spec", () => {
  const a = { ...FULL, specialty: null, missing: ["condition", "intervention", "comparator", "outcome"] } as unknown as Analysis;
  const seen: string[] = [];
  let ans: Record<string, string> = {};
  for (let i = 0; i < 6; i++) {
    const r = ruleClarify(a, ans);
    if (r.done) break;
    seen.push(r.field as string);
    ans = { ...ans, [r.field as string]: "answered" };
  }
  assert.deepEqual(seen, ["condition", "intervention", "comparator", "outcome"]);
  assert.equal(ruleClarify(a, ans).done, true, "must terminate once every field is answered");
});

test("ruleFormulate refuses to fabricate when population or intervention is missing (F-05)", () => {
  const cases: [Record<string, string>, Record<string, string>, string[]][] = [
    [{}, {}, ["condition", "intervention"]],
    [{ condition: "PCOS" }, {}, ["intervention"]],
    [{ intervention: "metformin" }, {}, ["condition"]],
    [{ condition: "   " }, { intervention: "IVF" }, ["condition"]],
  ];
  for (const [a, ans, expected] of cases) {
    const r = ruleFormulate(a as unknown as Analysis, ans);
    assert.equal(r.complete, false, `should refuse for ${JSON.stringify({ a, ans })}`);
    assert.deepEqual(r.missingElements, expected);
    assert.equal(r.finalQuestion, "", "must not emit a question with invented content");
    assert.deepEqual(r.variants, []);
    assert.deepEqual(r.elements, []);
  }
});

test("ruleFormulate survives null analysis and null answered by refusing, not throwing", () => {
  const r = ruleFormulate(null as unknown as Analysis, null as unknown as Record<string, string>);
  assert.equal(r.complete, false);
  assert.equal(r.finalQuestion, "");
});

test("ruleFormulate states a real question once population and intervention are known", () => {
  const r = ruleFormulate({ condition: "PCOS" } as unknown as Analysis, { intervention: "metformin" });
  assert.equal(r.complete, true);
  assert.deepEqual(r.missingElements, []);
  assert.match(r.finalQuestion, /PCOS/);
  assert.match(r.finalQuestion, /metformin/);
  assert.ok(r.elements.length > 0);
  assert.ok(r.variants!.length > 0);
});

test("ruleFormulate never leaks the old placeholder wording", () => {
  const r = ruleFormulate({ condition: "PCOS" } as unknown as Analysis, { intervention: "metformin", comparator: "placebo" });
  for (const banned of ["the population of interest", "the intervention"]) {
    assert.ok(!r.finalQuestion.includes(banned), `finalQuestion must not contain "${banned}"`);
    assert.ok(!r.elements.some(e => e.value.includes(banned)), `elements must not contain "${banned}"`);
  }
});

test("ruleFormulate honours a real analysis", () => {
  const r = ruleFormulate(FULL, { outcome: "live birth" });
  assert.equal(r.complete, true);
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
