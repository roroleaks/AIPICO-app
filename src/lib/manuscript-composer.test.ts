import test from "node:test";
import assert from "node:assert/strict";
import {
  composeManuscript,
  validateEnrichedManuscript,
  type ComposeManuscriptInput
} from "./manuscript-composer.ts";
import type { ExploreRecord } from "./explore-scoring.ts";

const sampleRecords: ExploreRecord[] = [
  {
    title: "Growth hormone co-treatment in poor ovarian responders undergoing IVF: a meta-analysis",
    authors: "Smith J, Doe A",
    journal: "Hum Reprod",
    year: "2023",
    relevancePct: 95,
    matchedElements: ["P", "I", "C", "O"],
    pmid: "31000001",
    doi: "10.1093/humrep/dead012"
  },
  {
    title: "Clinical pregnancy outcomes with adjuvant growth hormone therapy",
    authors: "Lee K, Chen M",
    journal: "Fertil Steril",
    year: "2022",
    relevancePct: 78,
    matchedElements: ["P", "I", "O"],
    pmid: "31000002",
    doi: "10.1016/j.fertnstert.2022.01.005"
  },
  {
    title: "Investigating ovarian response markers in assisted reproduction",
    authors: "Adams R, Brown T, Wilson P",
    journal: "Reprod Biomed Online",
    year: "2021",
    relevancePct: 62,
    matchedElements: ["P", "O"],
    pmid: "31000003"
  }
];

const baseInput: ComposeManuscriptInput = {
  words: [
    { word: "poor responders", role: "population" },
    { word: "ivf", role: "intervention" },
    { word: "growth hormone", role: "comparator" },
    { word: "clinical pregnancy rate", role: "outcome" }
  ],
  category: "conflicting",
  phrase: "In poor responders (P), does ivf (I) compared with growth hormone (C) affect clinical pregnancy rate (O)?",
  screeningStats: {
    retrieved: 48,
    screened: 48,
    relaxationLevel: 0,
    excludedCount: 2
  },
  records: sampleRecords,
  userExcluded: [],
  style: "vancouver"
};

test("MC1. Determinism: identical input yields byte-identical manuscript", () => {
  const run1 = composeManuscript(baseInput);
  const run2 = composeManuscript(baseInput);

  assert.deepEqual(run1, run2, "Repeated invocations must produce identical results");
});

test("MC2. Style rendering: Vancouver, APA, Harvard formats", () => {
  // Vancouver: numerical in-text citations [1], [2], [3]
  const vancouver = composeManuscript({ ...baseInput, style: "vancouver" });
  assert.equal(vancouver.citationStyle, "vancouver");
  assert.equal(vancouver.references.length, 3);
  assert.ok(vancouver.references[0].startsWith("1. Smith J, Doe A."));
  assert.ok(vancouver.references[0].includes("Hum Reprod. 2023."));
  assert.ok(vancouver.references[0].includes("doi:10.1093/humrep/dead012"));

  const synthesisTextV = vancouver.sections.find(s => s.heading === "Evidence synthesis")?.paragraphs.join(" ") || "";
  assert.ok(synthesisTextV.includes("[1]"), "Vancouver text must include numerical in-text marker [1]");
  assert.ok(synthesisTextV.includes("[2]"), "Vancouver text must include numerical in-text marker [2]");
  assert.ok(synthesisTextV.includes("[3]"), "Vancouver text must include numerical in-text marker [3]");

  // APA: author-year in-text (Smith & Doe, 2023) and alphabetical reference list
  const apa = composeManuscript({ ...baseInput, style: "apa" });
  assert.equal(apa.citationStyle, "apa");
  assert.equal(apa.references.length, 3);
  // Alphabetical: Adams comes before Lee, Lee before Smith
  assert.ok(apa.references[0].startsWith("Adams, R., Brown, T., & Wilson, P. (2021)."));
  assert.ok(apa.references[1].startsWith("Lee, K., & Chen, M. (2022)."));
  assert.ok(apa.references[2].startsWith("Smith, J., & Doe, A. (2023)."));

  const synthesisTextApa = apa.sections.find(s => s.heading === "Evidence synthesis")?.paragraphs.join(" ") || "";
  assert.ok(synthesisTextApa.includes("(Smith & Doe, 2023)"), "APA text must include (Smith & Doe, 2023)");
  assert.ok(synthesisTextApa.includes("(Lee & Chen, 2022)"), "APA text must include (Lee & Chen, 2022)");

  // Harvard: author-year in-text (Smith and Doe 2023) and alphabetical reference list
  const harvard = composeManuscript({ ...baseInput, style: "harvard" });
  assert.equal(harvard.citationStyle, "harvard");
  assert.equal(harvard.references.length, 3);
  assert.ok(harvard.references[0].startsWith("Adams, R et al., 2021."));
  assert.ok(harvard.references[1].startsWith("Lee, K and Chen, M, 2022."));
  assert.ok(harvard.references[2].startsWith("Smith, J and Doe, A, 2023."));

  const synthesisTextHarv = harvard.sections.find(s => s.heading === "Evidence synthesis")?.paragraphs.join(" ") || "";
  assert.ok(synthesisTextHarv.includes("(Smith and Doe 2023)"), "Harvard text must include (Smith and Doe 2023)");
});

test("MC3. Excluded records are NEVER cited in synthesis or reference list", () => {
  const withExcluded = composeManuscript({
    ...baseInput,
    userExcluded: ["31000002"], // exclude Lee K
    style: "vancouver"
  });

  assert.equal(withExcluded.references.length, 2, "Excluded record must be omitted from reference list");
  const allRefText = withExcluded.references.join("\n");
  assert.ok(!allRefText.includes("Lee K"), "Excluded author must not appear in references");
  assert.ok(!allRefText.includes("Clinical pregnancy outcomes"), "Excluded title must not appear in references");

  const fullManuscriptText = JSON.stringify(withExcluded);
  assert.ok(!fullManuscriptText.includes("Clinical pregnancy outcomes"), "Excluded title must never appear in manuscript text");
});

test("MC4. Category framing switches properly across established, conflicting, and gap", () => {
  const est = composeManuscript({ ...baseInput, category: "established" });
  assert.ok(est.title.includes("Established Clinical Knowledge"));
  assert.ok(est.sections[0].paragraphs[0].includes("reinforce evidence-based guidelines"));
  assert.ok(est.abstract[3].includes("established clinical alignment"));

  const conf = composeManuscript({ ...baseInput, category: "conflicting" });
  assert.ok(conf.title.includes("Conflicting Clinical Findings"));
  assert.ok(conf.sections[0].paragraphs[0].includes("heterogeneous and discordant"));
  assert.ok(conf.abstract[3].includes("conflicting clinical results"));

  const gap = composeManuscript({ ...baseInput, category: "gap" });
  assert.ok(gap.title.includes("Identified Clinical Literature Gaps"));
  assert.ok(gap.sections[0].paragraphs[0].includes("Significant uncertainty persists"));
  assert.ok(gap.abstract[3].includes("literature gap exists"));
});

test("MC5. Graceful empty state when zero records are retained", () => {
  const empty = composeManuscript({
    ...baseInput,
    records: [],
    style: "vancouver"
  });

  assert.equal(empty.references.length, 0);
  assert.ok(empty.abstract[2].includes("Zero records met final eligibility"));
  const synthP = empty.sections.find(s => s.heading === "Evidence synthesis")?.paragraphs[0];
  assert.ok(synthP?.includes("zero records met the eligibility criteria"));
});

test("MC6. Strict plain text: ZERO http occurrences in references and document body", () => {
  for (const style of ["vancouver", "apa", "harvard"] as const) {
    const doc = composeManuscript({ ...baseInput, style });
    const fullText = JSON.stringify(doc);
    assert.ok(!fullText.includes("http:"), `Manuscript in ${style} must have zero http occurrences`);
    assert.ok(!fullText.includes("https:"), `Manuscript in ${style} must have zero https occurrences`);

    for (const ref of doc.references) {
      assert.ok(!ref.includes("http"), `Reference line must not contain http: ${ref}`);
    }
  }
});

test("MC7. validateEnrichedManuscript accepts valid enrichment and rejects violations", () => {
  const det = composeManuscript(baseInput);

  // Valid enrichment passes
  const validAi = {
    title: det.title,
    abstract: det.abstract,
    sections: det.sections
  };
  const accepted = validateEnrichedManuscript(validAi, det, sampleRecords, "vancouver");
  assert.ok(accepted !== null, "Valid AI enrichment must be accepted");
  assert.equal(accepted?.aiEnriched, true);

  // Reject out of bounds Vancouver citation ([99])
  const invalidCitation = {
    ...validAi,
    sections: det.sections.map((s, idx) =>
      idx === 2
        ? { ...s, paragraphs: [s.paragraphs[0] + " Unverified claim [99].", ...s.paragraphs.slice(1)] }
        : s
    )
  };
  assert.equal(
    validateEnrichedManuscript(invalidCitation, det, sampleRecords, "vancouver"),
    null,
    "Out-of-bounds citation [99] must trigger rejection"
  );

  // Reject URL/http injection
  const urlInjection = {
    ...validAi,
    sections: det.sections.map((s, idx) =>
      idx === 0
        ? { ...s, paragraphs: [s.paragraphs[0] + " See https://example.com/info for details."] }
        : s
    )
  };
  assert.equal(
    validateEnrichedManuscript(urlInjection, det, sampleRecords, "vancouver"),
    null,
    "URL injection must trigger rejection"
  );

  // Reject runaway word count (> 1.75x)
  const runaway = {
    ...validAi,
    sections: det.sections.map(s => ({
      ...s,
      paragraphs: Array(10).fill(s.paragraphs.join(" "))
    }))
  };
  assert.equal(
    validateEnrichedManuscript(runaway, det, sampleRecords, "vancouver"),
    null,
    "Runaway word count must trigger rejection"
  );

  // Reject modified headings
  const wrongHeading = {
    ...validAi,
    sections: [
      { heading: "Invalid Custom Section", paragraphs: ["Content"] },
      ...det.sections.slice(1)
    ]
  };
  assert.equal(
    validateEnrichedManuscript(wrongHeading, det, sampleRecords, "vancouver"),
    null,
    "Altered section heading must trigger rejection"
  );
});
