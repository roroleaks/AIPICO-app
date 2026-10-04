import test from "node:test";
import assert from "node:assert/strict";
import { extractInTextCites, parseCitationSlots, stripOrphanCitations, checkCitations } from "./relevance.ts";

const pairs = (t: string) => extractInTextCites(t).map(c => `${c.author} ${c.year}`);

test("P1. each name in a multi-citation bracket keeps its own year", () => {
  const p = pairs("Rates fell (Berghella 2026; Broad 2009) in this cohort.");
  assert.ok(p.includes("Berghella 2026"), "first slot keeps its own year");
  assert.ok(p.includes("Broad 2009"), "second slot keeps its own year");
  assert.ok(!p.includes("Berghella 2009"), "no cross-pairing of author and year");
  assert.ok(!p.includes("Broad 2026"), "no cross-pairing of author and year");
});

test("P2. one name carrying several years yields one citation per year", () => {
  const p = pairs("Mixed evidence (Gen 2012, 2014) persists.");
  assert.ok(p.includes("Gen 2012"));
  assert.ok(p.includes("Gen 2014"));
});

test("P3. a name-only slot inherits the single year declared in its bracket", () => {
  const p = pairs("Cited by (Smith; Jones 2019).");
  assert.ok(p.includes("Smith 2019"));
  assert.ok(p.includes("Jones 2019"));
});

test("P4. an abbreviated author with a period is still parsed as a citation", () => {
  assert.deepEqual(parseCitationSlots("Gen., 2012").map(s => s.names[0]), ["Gen"]);
});

test("P5. square-bracket and brace citations are parsed and stripped", () => {
  const refs = ['Berghella V. 2026. "P." AJOG. doi:10.1/a'];
  for (const body of ["Data are limited [Broad 2009].", "Data are limited {Broad 2009}."]) {
    const c = checkCitations(body, refs);
    assert.deepEqual(c.orphans, ["Broad 2009"]);
    const s = stripOrphanCitations(body, c.orphans);
    assert.deepEqual(checkCitations(s.text, refs).orphans, [], `orphan survived in ${body}`);
    assert.ok(!s.text.includes("Broad"));
  }
});

test("P6. stripping is idempotent and leaves no orphan behind on a second pass", () => {
  const refs = ['Berghella V. 2026. "P." AJOG. doi:10.1/a'];
  const cases = [
    "Rates fell (Berghella 2026; Broad 2009).",
    "Mixed evidence (Gen 2012, 2014) persists.",
    "Mixed evidence (Gen., 2012) persists.",
    "The pessary data are limited (Zarko Alfirevic 2012)."
  ];
  for (const body of cases) {
    const first = stripOrphanCitations(body, checkCitations(body, refs).orphans);
    const second = stripOrphanCitations(first.text, checkCitations(first.text, refs).orphans);
    assert.equal(second.text, first.text, `second pass changed the text: ${body}`);
    assert.deepEqual(checkCitations(first.text, refs).orphans, [], `orphan survived: ${body}`);
  }
});

test("P7. a stripped bracket leaves surrounding prose intact", () => {
  const refs = ['Berghella V. 2026. "P." AJOG. doi:10.1/a'];
  const body = "Rates fell (Broad 2009). Later work repeated it. Cerclage data (Berghella 2026) are sparse.";
  const s = stripOrphanCitations(body, checkCitations(body, refs).orphans);
  assert.ok(s.text.includes("Later work repeated it."), "surrounding prose survives");
  assert.ok(s.text.includes("Berghella 2026"), "the resolvable citation survives");
  assert.ok(!s.text.includes("Broad"), "only the orphan is removed");
  assert.ok(!/\(\s*\)/.test(s.text), "no empty bracket is left behind");
});

test("P8. a bracket holding only orphans is removed whole", () => {
  const refs = ['Berghella V. 2026. "P." AJOG. doi:10.1/a'];
  const body = "Earlier work reported an effect (Broad 2009; Gen 2012). Later work repeated it.";
  const s = stripOrphanCitations(body, checkCitations(body, refs).orphans);
  assert.deepEqual(checkCitations(s.text, refs).orphans, []);
  assert.ok(!s.text.includes("Broad") && !s.text.includes("Gen"));
  assert.ok(s.text.includes("Later work repeated it."));
});
