import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAuthors,
  formatInTextAuthors,
  formatVancouver,
  formatApa,
  formatHarvard,
  formatBibliographyList,
  transformCitationsInText
} from "./citation-formatter.ts";
import type { AuditableRef } from "./relevance.ts";

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
    authors: "Hodgetts Morton J, Morris RK, Smith JA",
    year: "2021",
    journal: "BJOG",
    url: "https://pubmed.ncbi.nlm.nih.gov/30000002/"
  },
  {
    pmid: "30000003",
    doi: "10.1056/NEJMoa2022.1",
    title: "Emergency cerclage versus progesterone in a short cervix population",
    authors: "Berghella V",
    year: "2022",
    journal: "N Engl J Med",
    url: "https://pubmed.ncbi.nlm.nih.gov/30000003/"
  }
];

test("CF1. parseAuthors extracts surname and initials correctly", () => {
  const p1 = parseAuthors("Owen DD, Hankins G");
  assert.equal(p1.length, 2);
  assert.equal(p1[0].surname, "Owen");
  assert.equal(p1[1].surname, "Hankins");

  const p2 = parseAuthors("Berghella V");
  assert.equal(p2.length, 1);
  assert.equal(p2[0].surname, "Berghella");
});

test("CF2. formatInTextAuthors formats APA and Harvard correctly", () => {
  assert.equal(formatInTextAuthors("Owen DD, Hankins G", "apa"), "Owen & Hankins");
  assert.equal(formatInTextAuthors("Owen DD, Hankins G", "harvard"), "Owen and Hankins");
  assert.equal(formatInTextAuthors("Hodgetts Morton J, Morris RK, Smith JA", "apa"), "Hodgetts Morton et al.");
  assert.equal(formatInTextAuthors("Hodgetts Morton J, Morris RK, Smith JA", "harvard"), "Hodgetts Morton et al.");
  assert.equal(formatInTextAuthors("Berghella V", "apa"), "Berghella");
});

test("CF3. Vancouver references format with sequential numbering and no quotes", () => {
  const v1 = formatVancouver(REFS[0], 1);
  assert.ok(v1.startsWith("1. "));
  assert.ok(!v1.includes('"'));
  assert.ok(v1.includes("Obstet Gynecol. 2020."));
});

test("CF4. APA references format with year in parentheses and alphabetical sort", () => {
  const apa1 = formatApa(REFS[0]);
  assert.ok(apa1.includes("(2020)."));
  assert.ok(apa1.includes("https://doi.org/10.1001/og.2020.1"));

  const bib = formatBibliographyList(REFS, "apa");
  // Berghella (B) should come before Hodgetts Morton (H) and Owen (O)
  assert.equal(bib[0].record.pmid, "30000003"); // Berghella
  assert.equal(bib[1].record.pmid, "30000002"); // Hodgetts Morton
  assert.equal(bib[2].record.pmid, "30000001"); // Owen
});

test("CF5. Harvard references format with year without parentheses and Available at URL", () => {
  const h1 = formatHarvard(REFS[0]);
  assert.ok(h1.includes(", 2020."));
  assert.ok(h1.includes("Available at:"));

  const bib = formatBibliographyList(REFS, "harvard");
  assert.equal(bib[0].record.pmid, "30000003"); // Berghella
});

test("CF6. transformCitationsInText removes brackets for Vancouver", () => {
  const text = "Vaginal progesterone reduces preterm birth [1] and neonate death [1, 2] across trials [1-3].";
  const transformed = transformCitationsInText(text, REFS, "vancouver");

  // In Vancouver: must NOT contain brackets around citations!
  assert.ok(!transformed.includes("[1]"));
  assert.ok(!transformed.includes("[1, 2]"));
  assert.ok(!transformed.includes("[1-3]"));
  assert.ok(transformed.includes("preterm birth 1"));
  assert.ok(transformed.includes("neonate death 1, 2"));
  assert.ok(transformed.includes("across trials 1-3"));
});

test("CF7. transformCitationsInText transforms to APA author-date format", () => {
  const text = "Vaginal progesterone reduces preterm birth [1] and neonate death [2].";
  const transformed = transformCitationsInText(text, REFS, "apa");

  assert.ok(transformed.includes("(Owen & Hankins, 2020)"));
  assert.ok(transformed.includes("(Hodgetts Morton et al., 2021)"));
});

test("CF8. transformCitationsInText transforms to Harvard format", () => {
  const text = "Emergency cerclage was studied in [3].";
  const transformed = transformCitationsInText(text, REFS, "harvard");

  assert.ok(transformed.includes("(Berghella 2022)"));
});
