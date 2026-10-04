import test from "node:test";
import assert from "node:assert/strict";
import {
  readSessionInput,
  sessionSearchText,
  parseInput,
  toSessionInput,
  resolveCorrections
} from "./clinical-input.ts";

test("legacy session data holding only a raw string still resolves", () => {
  const legacy = readSessionInput("short cervix, progesterone, cerclage, preterm birth");
  assert.ok(legacy);
  assert.equal(legacy!.normalizedKeywords.length, 4);
  assert.equal(sessionSearchText(legacy!), "short cervix, progesterone, cerclage, preterm birth");
});

test("current object shape round-trips and preserves logical boundaries", () => {
  const parsed = parseInput("short cervix, vit d, co enzyme q 10, endometrial hyperplasia");
  const stored = toSessionInput(parsed, "  short cervix,  vit d, co enzyme q 10, endometrial hyperplasia ");
  const back = readSessionInput(JSON.parse(JSON.stringify(stored)));
  assert.ok(back);
  assert.deepEqual(back!.normalizedKeywords, parsed.normalizedTokens);
  assert.equal(back!.rawInput, "short cervix, vit d, co enzyme q 10, endometrial hyperplasia");
  assert.ok(back!.normalizedKeywords.includes("endometrial hyperplasia"));
  // Nothing was decided yet, so the typed aliases are stored verbatim, not rewritten.
  assert.ok(back!.normalizedKeywords.includes("vit d"));
  assert.equal(back!.normalizedKeywords.includes("vitamin D"), false);
  assert.equal(back!.pendingCorrections.length, 2);
});

test("session payload carries the full correction audit trail", () => {
  const raw = "short cervix, vit d, co enzyme q 10, progesterone";
  const initial = parseInput(raw);
  assert.equal(initial.corrections.length, 2);

  // User applies one suggestion and keeps the other.
  const [vitD, coQ10] = initial.corrections;
  const afterApply = resolveCorrections(parseInput(raw), [{ ...vitD, decision: "applied" }]);
  const decided = resolveCorrections(parseInput(raw), [
    ...afterApply.history,
    { ...coQ10, decision: "kept" }
  ]);

  const stored = toSessionInput(decided, raw);
  const back = readSessionInput(JSON.parse(JSON.stringify(stored)))!;
  assert.ok(back);

  // Applied suggestion rewrites the term; kept suggestion does not.
  assert.ok(back.normalizedKeywords.includes("vitamin D"), back.normalizedKeywords.join("|"));
  assert.ok(back.normalizedKeywords.includes("co enzyme q 10"), back.normalizedKeywords.join("|"));
  assert.equal(back.normalizedKeywords.includes("coenzyme Q10"), false, "kept term is not rewritten");

  // Audit trail survives serialization with original term, suggestion, and decision.
  assert.equal(back.corrections.length, 2, "applied corrections are never dropped from history");
  const vitRecord = back.corrections.find(c => c.from === "vit d")!;
  assert.equal(vitRecord.to, "vitamin D");
  assert.equal(vitRecord.decision, "applied");
  assert.equal(vitRecord.kind, "alias");
  const coRecord = back.corrections.find(c => c.from === "co enzyme q 10")!;
  assert.equal(coRecord.to, "coenzyme Q10");
  assert.equal(coRecord.decision, "kept");

  // Nothing is left pending, and downstream text reflects only the applied change.
  assert.equal(back.pendingCorrections.length, 0);
  assert.equal(
    sessionSearchText(back),
    "short cervix, vitamin D, co enzyme q 10, progesterone"
  );
});

test("decisions persisted in session suppress the suggestion on a later visit", () => {
  const raw = "short cervix, vit d, co enzyme q 10, progesterone";
  const first = parseInput(raw);
  const keptAll = resolveCorrections(
    parseInput(raw),
    first.corrections.map(c => ({ ...c, decision: "kept" as const }))
  );
  const stored = JSON.parse(JSON.stringify(toSessionInput(keptAll, raw)));

  // A fresh visit re-parses from the raw input, as a reload would.
  const rehydrated = readSessionInput(stored)!;
  assert.equal(rehydrated.pendingCorrections.length, 0, "Keep must persist across a reload");
  assert.equal(sessionSearchText(rehydrated), "short cervix, vit d, co enzyme q 10, progesterone");
  assert.equal(rehydrated.corrections.length, 2);
  assert.ok(rehydrated.corrections.every(c => c.decision === "kept"));
});

test("null, empty and unusable session values are handled", () => {
  assert.equal(readSessionInput(null), null);
  assert.equal(readSessionInput(""), null);
  assert.equal(readSessionInput("   "), null);
  assert.equal(readSessionInput({}), null);
  // object without keywords but with a legacy rawInput string
  const legacyish = readSessionInput({ rawInput: "short cervix, progesterone, cerclage, preterm birth" });
  assert.ok(legacyish);
  assert.equal(legacyish!.normalizedKeywords.length, 4);
});

test("knowledge-base terms are recognized as single keywords via live vocab", () => {
  // 'OHSS incidence' comes from KB.outcomesRanked, not from the built-in phrase list.
  const p = parseInput("PCOS, OHSS incidence, IVF, live birth rate");
  assert.ok(p.normalizedTokens.includes("OHSS incidence"), p.normalizedTokens.join("|"));
});

test("normalized search text is what downstream stages consume", () => {
  const p = parseInput("short cervix - progesterone - cerclage - preterm birth");
  const text = sessionSearchText(toSessionInput(p, "x"));
  assert.equal(text, "short cervix, progesterone, cerclage, preterm birth");
});
