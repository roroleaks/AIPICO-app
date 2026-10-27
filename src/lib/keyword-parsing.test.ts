import test from "node:test";
import assert from "node:assert/strict";
import { parseClinicalKeywords, validateKeywords } from "./clinical-keywords.ts";

test("A-019. 'X- Y' with trailing-space dash separates into two tokens 'x' and 'y'", () => {
  const parsed = parseClinicalKeywords("X- Y");
  assert.equal(parsed.logicalCount, 2, `expected 2 tokens, got ${parsed.logicalCount} (${parsed.normalizedTokens.join(", ")})`);
  assert.deepEqual(parsed.normalizedTokens.map(t => t.toLowerCase()), ["x", "y"]);
});

test("A-020. 'labor and delivery' preserves clinical phrase containing 'and' as single token", () => {
  const parsed = parseClinicalKeywords("labor and delivery");
  assert.equal(parsed.logicalCount, 1, `expected 1 token, got ${parsed.logicalCount} (${parsed.normalizedTokens.join(", ")})`);
  assert.deepEqual(parsed.normalizedTokens.map(t => t.toLowerCase()), ["labor and delivery"]);
});

test("A-021. 'diabetes and pregnancy' preserves clinical phrase containing 'and' as single token", () => {
  const parsed = parseClinicalKeywords("diabetes and pregnancy");
  assert.equal(parsed.logicalCount, 1, `expected 1 token, got ${parsed.logicalCount} (${parsed.normalizedTokens.join(", ")})`);
  assert.deepEqual(parsed.normalizedTokens.map(t => t.toLowerCase()), ["diabetes and pregnancy"]);
});

test("A-022. 'X and Y' preserves phrase containing 'and' as single token", () => {
  const parsed = parseClinicalKeywords("X and Y");
  assert.equal(parsed.logicalCount, 1, `expected 1 token, got ${parsed.logicalCount} (${parsed.normalizedTokens.join(", ")})`);
  assert.deepEqual(parsed.normalizedTokens.map(t => t.toLowerCase()), ["x and y"]);
});

test("A-023. 'A or B' preserves phrase containing 'or' and leading 'A' as single token", () => {
  const parsed = parseClinicalKeywords("A or B");
  assert.equal(parsed.logicalCount, 1, `expected 1 token, got ${parsed.logicalCount} (${parsed.normalizedTokens.join(", ")})`);
  assert.deepEqual(parsed.normalizedTokens.map(t => t.toLowerCase()), ["a or b"]);
});

// 10 Further OB/GYN phrases from 08_parsing_behavior.md Table 3
test("OBGYN-01. 'labor and delivery' single phrase token", () => {
  const parsed = parseClinicalKeywords("labor and delivery");
  assert.equal(parsed.logicalCount, 1);
  assert.deepEqual(parsed.normalizedTokens.map(t => t.toLowerCase()), ["labor and delivery"]);
});

test("OBGYN-02. 'polycystic ovary syndrome' single phrase token", () => {
  const parsed = parseClinicalKeywords("polycystic ovary syndrome");
  assert.equal(parsed.logicalCount, 1);
  assert.deepEqual(parsed.normalizedTokens.map(t => t.toLowerCase()), ["polycystic ovary syndrome"]);
});

test("OBGYN-03. 'pre-eclampsia' compound hyphen preserved intact", () => {
  const parsed = parseClinicalKeywords("pre-eclampsia");
  assert.equal(parsed.logicalCount, 1);
  assert.deepEqual(parsed.normalizedTokens.map(t => t.toLowerCase()), ["pre-eclampsia"]);
});

test("OBGYN-04. 'in vitro fertilization' single phrase token", () => {
  const parsed = parseClinicalKeywords("in vitro fertilization");
  assert.equal(parsed.logicalCount, 1);
  assert.deepEqual(parsed.normalizedTokens.map(t => t.toLowerCase()), ["in vitro fertilization"]);
});

test("OBGYN-05. 'signs and symptoms' single phrase token", () => {
  const parsed = parseClinicalKeywords("signs and symptoms");
  assert.equal(parsed.logicalCount, 1);
  assert.deepEqual(parsed.normalizedTokens.map(t => t.toLowerCase()), ["signs and symptoms"]);
});

test("OBGYN-06. 'safety and efficacy' single phrase token", () => {
  const parsed = parseClinicalKeywords("safety and efficacy");
  assert.equal(parsed.logicalCount, 1);
  assert.deepEqual(parsed.normalizedTokens.map(t => t.toLowerCase()), ["safety and efficacy"]);
});

test("OBGYN-07. 'induction of labor' single phrase token", () => {
  const parsed = parseClinicalKeywords("induction of labor");
  assert.equal(parsed.logicalCount, 1);
  assert.deepEqual(parsed.normalizedTokens.map(t => t.toLowerCase()), ["induction of labor"]);
});

test("OBGYN-08. 'trial of labor after cesarean' single phrase token", () => {
  const parsed = parseClinicalKeywords("trial of labor after cesarean");
  assert.equal(parsed.logicalCount, 1);
  assert.deepEqual(parsed.normalizedTokens.map(t => t.toLowerCase()), ["trial of labor after cesarean"]);
});

test("OBGYN-09. 'singleton or twin pregnancy' single phrase token", () => {
  const parsed = parseClinicalKeywords("singleton or twin pregnancy");
  assert.equal(parsed.logicalCount, 1);
  assert.deepEqual(parsed.normalizedTokens.map(t => t.toLowerCase()), ["singleton or twin pregnancy"]);
});

test("OBGYN-10. 'co-enzyme Q10' compound hyphen preserved intact", () => {
  const parsed = parseClinicalKeywords("co-enzyme Q10");
  assert.equal(parsed.logicalCount, 1);
  assert.deepEqual(parsed.normalizedTokens.map(t => t.toLowerCase()), ["co-enzyme q10"]);
});

test("VAL-01. validateKeywords copy includes conjunction explanation", () => {
  const parsed = parseClinicalKeywords("short cervix, progesterone, cerclage");
  const msg = validateKeywords(parsed);
  assert.ok(msg);
  assert.match(msg, /Conjunctions such as “and” or “or” do not split a phrase/);
  assert.match(msg, /labor and delivery/);
});
