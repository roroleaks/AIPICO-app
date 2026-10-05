import test from "node:test";
import assert from "node:assert/strict";
import {
  formatVancouverReference,
  formatReference,
  checkCitations,
  stripOrphanCitations,
  extractNumericCites,
  resolveReference,
  type AuditableRef
} from "./relevance.ts";
import { validateDeliverableIntegrity } from "./deliverable-integrity.ts";

const REFS: AuditableRef[] = [
  {
    pmid: "30000001",
    doi: "10.1001/og.2020.1",
    title: "Vaginal progesterone to prevent preterm birth in women with a short cervix",
    authors: "Owen DD, Hankins G",
    year: "2020",
    journal: "Obstet Gynecol",
    url: "https://pubmed.ncbi.nlm.nih.gov/30000001/"
  },
  {
    pmid: "30000002",
    doi: "10.1111/bjog.2021.1",
    title: "Cerclage versus progesterone in women with a short cervix meta-analysis",
    authors: "Hodgetts Morton J, Morris RK",
    year: "2021",
    journal: "BJOG",
    url: "https://pubmed.ncbi.nlm.nih.gov/30000002/"
  },
  {
    pmid: "30000003",
    doi: "10.1056/NEJMoa2022.1",
    title: "Emergency cerclage versus progesterone in a short cervix population",
    authors: "Kansal N, Berghella V",
    year: "2022",
    journal: "N Engl J Med",
    url: "https://pubmed.ncbi.nlm.nih.gov/30000003/"
  }
];

test("V1. formatVancouverReference adheres to ICMJE/NLM style without quotation marks on titles", () => {
  const v1 = formatVancouverReference(REFS[0], 1);
  assert.equal(
    v1,
    "1. Owen DD, Hankins G. Vaginal progesterone to prevent preterm birth in women with a short cervix. Obstet Gynecol. 2020. doi:10.1001/og.2020.1 https://pubmed.ncbi.nlm.nih.gov/30000001/"
  );
  assert.ok(!v1.includes('"'), "Vancouver style must not enclose titles in double quotes");
});

test("V2. extractNumericCites parses single, multiple and range citations", () => {
  const text = "Progesterone reduces preterm delivery [1]. Others found similar efficacy [2, 3] and trials [1-3].";
  const { citedNumbers, rawBrackets } = extractNumericCites(text);
  assert.deepEqual([...citedNumbers].sort(), [1, 2, 3]);
  assert.equal(rawBrackets.length, 3);
});

test("V3. checkCitations accepts pure Vancouver numerical in-text citations", () => {
  const bibliography = REFS.map((r, i) => formatVancouverReference(r, i + 1));
  const discussion = "Progesterone improves outcomes [1]. Cerclage was evaluated in [2]. Further trials corroborated [3].";
  const c = checkCitations(discussion, bibliography);
  assert.equal(c.consistent, true);
  assert.equal(c.citedRefs, 3);
  assert.deepEqual(c.uncited, []);
  assert.deepEqual(c.orphans, []);
});

test("V4. checkCitations flags out-of-range numerical citations as orphans", () => {
  const bibliography = [formatVancouverReference(REFS[0], 1), formatVancouverReference(REFS[1], 2)];
  const discussion = "Progesterone reduces risk [1], but another trial reported conflicting data [9].";
  const c = checkCitations(discussion, bibliography);
  assert.equal(c.consistent, false);
  assert.ok(c.orphans.includes("[9]"));
});

test("V5. checkCitations flags unreferenced items in numerical citation scheme as uncited", () => {
  const bibliography = REFS.map((r, i) => formatVancouverReference(r, i + 1));
  const discussion = "Progesterone improves outcomes [1].";
  const c = checkCitations(discussion, bibliography);
  assert.equal(c.consistent, false);
  assert.equal(c.citedRefs, 1);
  assert.equal(c.uncited.length, 2);
});

test("V6. stripOrphanCitations removes numeric orphan brackets", () => {
  const text = "Progesterone is effective [1], whereas conflicting evidence was noted [5].";
  const stripped = stripOrphanCitations(text, ["[5]"]);
  assert.ok(!stripped.text.includes("[5]"));
  assert.ok(stripped.text.includes("[1]"));
  assert.deepEqual(stripped.removed, ["[5]"]);
});

test("V7. resolveReference resolves unquoted Vancouver references back to record", () => {
  const v = formatVancouverReference(REFS[0], 1);
  const resolved = resolveReference(v, REFS);
  assert.ok(resolved);
  assert.equal(resolved?.pmid, REFS[0].pmid);
});

test("V8. validateDeliverableIntegrity passes for full Vancouver deliverable", () => {
  const bibliography = REFS.map((r, i) => formatVancouverReference(r, i + 1));
  const result = validateDeliverableIntegrity({
    fields: {
      abstract: "Preterm birth is a major complication [1].",
      introduction: "Vaginal progesterone has been compared with cerclage [1, 2].",
      discussion: "Cerclage yields comparable results in randomized investigations [2, 3].",
      conclusion: "Evidence supports risk stratification [1-3]."
    },
    references: bibliography,
    retainedRecords: REFS,
    exportReferences: bibliography
  });
  assert.equal(result.ok, true, JSON.stringify(result));
});
