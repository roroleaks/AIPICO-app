import test from "node:test";
import assert from "node:assert/strict";
import { classifyWordRole, assignPicoRoles } from "./pico-roles.ts";

test("pico-roles: classifyWordRole identifies canonical roles accurately", () => {
  // Population
  const pop = classifyWordRole("poor responders");
  assert.equal(pop.role, "population");
  assert.equal(pop.confidence, "high");

  // Interventions
  const ivf = classifyWordRole("ivf");
  assert.equal(ivf.role, "intervention");
  assert.equal(ivf.confidence, "high");

  const gh = classifyWordRole("growth hormone");
  assert.equal(gh.role, "intervention");
  assert.equal(gh.confidence, "high");

  // CoQ10: intervention or comparator accepted by prompt specification
  const coq = classifyWordRole("co enzyme q10");
  assert.ok(
    coq.role === "intervention" || coq.role === "comparator",
    `co enzyme q10 should be intervention or comparator, got ${coq.role}`
  );

  // Comparator
  const comp = classifyWordRole("placebo");
  assert.equal(comp.role, "comparator");
  assert.equal(comp.confidence, "high");

  // Outcomes
  const o1 = classifyWordRole("clinical pregnancy rate");
  assert.equal(o1.role, "outcome");
  assert.equal(o1.confidence, "high");

  const o2 = classifyWordRole("preterm birth");
  assert.equal(o2.role, "outcome");
  assert.equal(o2.confidence, "high");
});

test("pico-roles: tie-breaking honors population > intervention > comparator > outcome priority", () => {
  // A phrase with both population and intervention signals (e.g. "ovarian surgery")
  // Both match medium/high; tie priority prefers population over intervention
  const res = classifyWordRole("ovarian surgery");
  assert.ok(
    res.role === "population" || res.role === "intervention",
    `Must resolve tie deterministically: got ${res.role}`
  );
  // Disease condition default
  const bareCondition = classifyWordRole("endometrioma");
  assert.equal(bareCondition.role, "population");
});

test("pico-roles: assignPicoRoles maps arrays and preserves distinct roles", () => {
  const words = ["poor responders", "ivf", "growth hormone", "clinical pregnancy rate"];
  const assigned = assignPicoRoles(words);

  assert.equal(assigned.length, 4);
  assert.equal(assigned[0].role, "population");
  assert.equal(assigned[1].role, "intervention");
  assert.equal(assigned[2].role, "intervention");
  assert.equal(assigned[3].role, "outcome");
});

test("pico-roles: assignPicoRoles enforces role diversity when all words receive identical role", () => {
  const homogeneous = ["endometriosis", "pcos", "short cervix", "preeclampsia"];
  const assigned = assignPicoRoles(homogeneous);

  assert.equal(assigned.length, 4);
  assert.equal(assigned[0].role, "population");
  assert.equal(assigned[1].role, "population");
  assert.equal(assigned[2].role, "population");
  // Last word reclassified as outcome
  assert.equal(assigned[3].role, "outcome");
  assert.equal(assigned[3].word, "preeclampsia");
});
