import test from "node:test";
import assert from "node:assert/strict";
import { extractPicoFromQuestion } from "./pico-parser.ts";

test("extractPicoFromQuestion parses explicit (P), (I), (C), (O) markers", () => {
  const q = "In women with preterm birth risk (P), does vaginal progesterone (I) compared with cervical cerclage (C) improve primary patient-centered clinical outcomes (O)?";
  const pico = extractPicoFromQuestion(q, "preterm birth", "obstetrics");

  assert.equal(pico.condition, "preterm birth risk");
  assert.equal(pico.intervention, "vaginal progesterone");
  assert.equal(pico.comparator, "cervical cerclage");
  assert.equal(pico.outcome, "primary patient-centered clinical outcomes");
  assert.equal(pico.specialty, "obstetrics");
});

test("extractPicoFromQuestion parses natural language PICO question", () => {
  const q = "In pregnant individuals with a short cervix, does vaginal progesterone compared with cervical cerclage reduce preterm birth?";
  const pico = extractPicoFromQuestion(q);

  assert.ok(pico.condition.includes("short cervix"));
  assert.equal(pico.intervention, "vaginal progesterone");
  assert.equal(pico.comparator, "cervical cerclage");
  assert.equal(pico.outcome, "preterm birth");
  assert.equal(pico.specialty, "obstetrics");
});

test("extractPicoFromQuestion parses gynecology question", () => {
  const q = "In women with uterine fibroids, does ulipristal acetate compared with leuprolide reduce menstrual blood loss?";
  const pico = extractPicoFromQuestion(q);

  assert.ok(pico.condition.includes("fibroids"));
  assert.equal(pico.intervention, "ulipristal acetate");
  assert.equal(pico.comparator, "leuprolide");
  assert.equal(pico.outcome, "menstrual blood loss");
  assert.equal(pico.specialty, "gynecology");
});

test("extractPicoFromQuestion parses infertility question", () => {
  const q = "In women with PCOS undergoing ovulation induction, does letrozole compared with clomiphene citrate increase live birth rate?";
  const pico = extractPicoFromQuestion(q);

  assert.ok(pico.condition.includes("PCOS"));
  assert.equal(pico.intervention, "letrozole");
  assert.equal(pico.comparator, "clomiphene citrate");
  assert.equal(pico.outcome, "live birth rate");
  assert.equal(pico.specialty, "infertility");
});

test("extractPicoFromQuestion handles complex subgroup questions", () => {
  const q = "In high-risk subgroups of women with gestational diabetes (P), does early intervention with insulin (I) compared with conservative management (C) reduce disease progression or acute complications (O)?";
  const pico = extractPicoFromQuestion(q);

  assert.ok(pico.condition.length > 0);
  assert.ok(pico.intervention.includes("insulin"));
  assert.equal(pico.comparator, "conservative management");
  assert.equal(pico.specialty, "obstetrics");
});

test("extractPicoFromQuestion falls back gracefully on vague question with topic", () => {
  const q = "What is the best treatment option?";
  const topic = "preeclampsia, low-dose aspirin, gestational age";
  const pico = extractPicoFromQuestion(q, topic);

  assert.ok(pico.condition.length > 0);
  assert.ok(pico.intervention.length > 0);
  assert.ok(pico.comparator.length > 0);
  assert.equal(pico.specialty, "obstetrics");
});
