import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceSet } from "./evidence-set.ts";
import { sanitizeCitationsAgainstEvidenceSet } from "./relevance.ts";
import type { AuditableRef } from "./relevance.ts";

const FIXTURE: AuditableRef[] = [
  { pmid: "11100001", title: "Vaginal progesterone versus cerclage", authors: "Likes M, Smith J", year: "2019", journal: "OG", doi: "10.1001/og.2020.0001", url: "https://example.com/1" },
  { pmid: "11100002", title: "Cerclage vs progesterone", authors: "Likes M, Jones K", year: "2021", journal: "BJOG", doi: "10.1111/bjog.2021.0002", url: "https://example.com/2" },
  { pmid: "11100003", title: "Cerclage and progesterone", authors: "Likes M, Doe R", year: "2022", journal: "AJOG", doi: "10.1067/ajog.2022.0003", url: "https://example.com/3" }
];

test("deterministic finalization rejects unsupported citations and produces stable keys", async () => {
  const es = await buildEvidenceSet(FIXTURE);
  const inconsistent = "Both strategies work (Likes 2019; Kansal 2026; Likes 2021). (Alirevic 2018). (Zombie 2025).";
  const { text, warnings } = sanitizeCitationsAgainstEvidenceSet(inconsistent, es.allowedCitationKeys, es.citationMap);
  assert.ok(text.includes("Likes 2019"), "allowed citation survives");
  assert.ok(text.includes("Likes 2021"), "allowed citation survives");
  assert.ok(!text.includes("(Kansal 2026)"), "unsupported removed");
  assert.ok(!text.includes("Alirevic 2018"), "unsupported removed");
  assert.ok(!text.includes("Zombie 2025"), "unsupported removed");
  assert.ok(warnings.length >= 1, "warnings recorded");
  
  // run 20x
  const keys = es.allowedCitationKeys;
  const baseText = text;
  for (let i = 0; i < 20; i++) {
    const r = sanitizeCitationsAgainstEvidenceSet(inconsistent, keys, es.citationMap);
    assert.equal(r.text, baseText, "sanitized text deterministic");
    assert.deepEqual(Array.from(keys), Array.from(es.allowedCitationKeys), "keys stable");
  }
  assert.deepEqual(Array.from(keys).sort(), ["doi:10.1001/og.2020.0001", "doi:10.1111/bjog.2021.0002", "doi:10.1067/ajog.2022.0003"].sort());
});
