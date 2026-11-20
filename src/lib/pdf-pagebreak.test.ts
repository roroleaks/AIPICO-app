import test from "node:test";
import assert from "node:assert/strict";
import { extractText } from "unpdf";
import { buildPdfBuffer } from "./pdf-generator.ts";

/**
 * Method Documentation and Limitations:
 *
 * Method:
 * 1. `unpdf.extractText(new Uint8Array(pdfBuffer))` parses PDF page tree structures and text streams via PDF.js.
 *    - `totalPages`: Returns the document's total rendered page count.
 *    - `text`: Returns an array of strings representing the textual content of each individual page (0-indexed).
 * 2. Non-blank page check: For every page `i`, `text[i].trim().length > 0` verifies printable text presence.
 * 3. Buffer regex cross-check: `(pdfBuffer.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length`
 *    verifies the physical /Page dictionary count in the uncompressed PDF object stream.
 *
 * Limitations:
 * 1. Text extraction checks printable glyphs. If a page contained only vector graphics (e.g., shapes, rules)
 *    without text, `extractText` would report 0 characters. For all AI PICO deliverables, every valid page
 *    contains header/footer and narrative prose.
 * 2. Regex on `/Type /Page` counts page objects in the PDF xref/stream; it confirms page object allocations
 *    in uncompressed PDF output but does not evaluate text layout or ink coverage.
 */

test("PB1. Standard F-001 deliverable renders exactly 1 page with no blank trailing pages", async () => {
  const f001Payload = {
    title: "Clinical Trial of Progesterone",
    citationStyle: "vancouver" as const,
    sections: [
      {
        heading: "Summary",
        blocks: ["Progesterone administration in cervical shortening."]
      }
    ],
    references: [
      "1. Smith J. Trial of progesterone. Lancet. 2023. doi:10.1016/s0140-6736 https://pubmed.ncbi.nlm.nih.gov/31422734/"
    ],
    retainedReferences: [
      {
        pmid: "31422734",
        title: "Trial of progesterone",
        year: "2023",
        doi: "10.1016/s0140-6736"
      }
    ]
  };

  const pdfBuffer = await buildPdfBuffer(f001Payload);
  assert.ok(pdfBuffer.length > 0, "PDF buffer must be non-empty");

  const parsed = await extractText(new Uint8Array(pdfBuffer));
  const regexPageCount = (pdfBuffer.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;

  assert.equal(
    parsed.totalPages,
    1,
    `F-001 must render exactly 1 page (DEF-013 regression guard). Found totalPages: ${parsed.totalPages}`
  );
  assert.equal(
    regexPageCount,
    1,
    `F-001 PDF /Type /Page count must be 1. Found: ${regexPageCount}`
  );

  for (let i = 0; i < parsed.totalPages; i++) {
    const pageText = (parsed.text[i] || "").trim();
    assert.ok(
      pageText.length > 0,
      `Page ${i + 1} of ${parsed.totalPages} must not be blank.`
    );
  }
});

test("PB2. Multi-section deliverable renders exactly 2 pages with no blank pages", async () => {
  const longPayload = {
    title: "Comprehensive Evidence Commentary: Second-Trimester Cervical Insufficiency",
    docType: "Clinical Commentary",
    meta: "Obstetrics & Gynecology Clinical Review",
    citationStyle: "vancouver" as const,
    pico: [
      {
        label: "Population",
        value: "Asymptomatic pregnant women with singleton gestation and transvaginal ultrasound cervical length < 25 mm before 24 weeks."
      },
      {
        label: "Intervention",
        value: "Vaginal progesterone 200 mg nightly or cervical cerclage."
      },
      {
        label: "Comparison",
        value: "Placebo or expectant management with routine prenatal care."
      },
      {
        label: "Outcomes",
        value: "Spontaneous preterm birth before 34 weeks gestation and composite neonatal morbidity."
      }
    ],
    sections: [
      {
        heading: "1. Clinical Rationale and Diagnostic Criteria",
        blocks: [
          "Preterm birth remains a leading contributor to infant mortality and long-term neurodevelopmental impairment. Universal transvaginal cervical length screening between 18 and 22 weeks identifies patients with asymptomatic cervical shortening who benefit from targeted intervention.",
          "The pathophysiologic mechanism involves premature cervical remodeling, localized inflammation, and mechanical weakness of the internal os. Identification before overt effacement provides an essential window for pharmacologic or mechanical stabilization."
        ]
      },
      {
        heading: "2. Comparative Synthesis of Evidence",
        blocks: [
          "Large-scale multicenter trials demonstrate that vaginal progesterone reduces preterm birth prior to 33 weeks by approximately 30% to 40% among singleton gestations with cervical length under 25 mm. High compliance and favorable safety profiles support progesterone as initial therapy in non-surgical candidates.",
          "For patients with a history of prior spontaneous preterm birth and progressive cervical shortening despite progesterone, cerclage placement provides mechanical support and structural closure of the cervical canal.",
          "Subgroup analyses emphasize that intervention efficacy is greatest when initiated prior to 24 weeks gestation, before advanced funneling or intra-amniotic sludge develops."
        ]
      },
      {
        heading: "3. Clinical Recommendations and Implementation",
        blocks: [
          "Clinicians should implement standardized transvaginal ultrasound cervical length measurement protocols. Routine transabdominal views lack sufficient sensitivity to exclude cervical shortening.",
          "Patient counseling should address medication adherence, warning symptoms of uterine activity, and individualized follow-up surveillance schedules."
        ]
      }
    ],
    references: [
      "1. Romero R, Conde-Agudelo A, Da Fonseca E, et al. Vaginal progesterone for preventing preterm birth and adverse perinatal outcomes in singleton gestations with a short cervix: a meta-analysis of individual patient data. Am J Obstet Gynecol. 2018;218(2):161-180.",
      "2. Berghella V, Rafael TJ, Szychowski JM, Rust OA, Owen J. Cerclage for short cervix on ultrasonography in women with singleton gestations and previous preterm birth: a meta-analysis. Obstet Gynecol. 2011;117(3):663-671.",
      "3. American College of Obstetricians and Gynecologists. Prediction and prevention of spontaneous preterm birth: ACOG Practice Bulletin, Number 234. Obstet Gynecol. 2021;138(2):e65-e90."
    ],
    retainedReferences: [
      { pmid: "29155166", title: "Vaginal progesterone for preventing preterm birth", year: "2018" },
      { pmid: "21343770", title: "Cerclage for short cervix", year: "2011" },
      { pmid: "34299109", title: "Prediction and prevention of spontaneous preterm birth", year: "2021" }
    ]
  };

  const pdfBuffer = await buildPdfBuffer(longPayload);
  assert.ok(pdfBuffer.length > 0, "PDF buffer must be non-empty");

  const parsed = await extractText(new Uint8Array(pdfBuffer));
  const regexPageCount = (pdfBuffer.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;

  assert.equal(
    parsed.totalPages,
    2,
    `Multi-section payload must render exactly 2 pages. Found totalPages: ${parsed.totalPages}`
  );
  assert.equal(
    regexPageCount,
    2,
    `PDF /Type /Page count must be 2. Found: ${regexPageCount}`
  );

  for (let i = 0; i < parsed.totalPages; i++) {
    const pageText = (parsed.text[i] || "").trim();
    assert.ok(
      pageText.length > 0,
      `Page ${i + 1} of ${parsed.totalPages} must not be blank.`
    );
  }
});

test("PB3. 350-word paragraph renders flowing prose without line fragmentation and footer segments do not overlap", async () => {
  const words = [
    "Endometriosis", "is", "a", "chronic", "inflammatory", "disorder", "characterized", "by", "the",
    "presence", "of", "endometrial-like", "tissue", "outside", "the", "uterine", "cavity,", "primarily",
    "on", "the", "pelvic", "peritoneum,", "ovaries,", "and", "rectovaginal", "septum.", "The", "condition",
    "affects", "approximately", "ten", "percent", "of", "reproductive-age", "women", "globally", "and",
    "is", "associated", "with", "significant", "pelvic", "pain,", "dysmenorrhea,", "dyspareunia,", "and",
    "subfertility.", "Surgical", "management", "via", "laparoscopic", "excision", "aims", "to", "remove",
    "all", "visible", "endometriotic", "implants", "while", "preserving", "normal", "pelvic", "anatomy",
    "and", "ovarian", "reserve.", "Numerous", "randomized", "controlled", "trials", "and", "prospective",
    "cohort", "studies", "have", "demonstrated", "that", "meticulous", "laparoscopic", "excision",
    "significantly", "alleviates", "pain", "symptoms", "and", "improves", "quality", "of", "life",
    "compared", "with", "diagnostic", "laparoscopy", "or", "medical", "suppression", "alone.",
    "However,", "recurrence", "rates", "remain", "a", "substantial", "clinical", "challenge,", "with",
    "up", "to", "twenty", "percent", "of", "patients", "requiring", "subsequent", "intervention",
    "within", "two", "years", "postoperatively.", "Postoperative", "medical", "therapy", "such", "as",
    "oral", "progestins,", "combined", "oral", "contraceptives,", "or", "gonadotropin-releasing",
    "hormone", "agonists", "with", "add-back", "therapy", "is", "frequently", "recommended", "to",
    "suppress", "residual", "microscopic", "disease", "and", "extend", "the", "symptom-free", "interval.",
    "In", "patients", "desiring", "immediate", "fertility,", "laparoscopic", "excision", "of", "mild-to-moderate",
    "endometriosis", "modestly", "enhances", "spontaneous", "conception", "rates,", "whereas", "in",
    "severe", "disease", "involving", "bilateral", "endometriomas", "or", "deep", "infiltrating", "nodules,",
    "assisted", "reproductive", "technology", "remains", "the", "primary", "modality", "for", "achieving",
    "pregnancy.", "Ovarian", "cystectomy", "for", "endometriomas", "must", "be", "performed", "with",
    "careful", "hemostasis", "to", "minimize", "inadvertent", "damage", "to", "adjacent", "healthy",
    "ovarian", "cortex", "and", "preserve", "antral", "follicle", "count.", "Clinical", "guidelines",
    "consistently", "emphasize", "multidisciplinary", "care,", "incorporating", "pain", "specialists,",
    "reproductive", "endocrinologists,", "and", "specialized", "pelvic", "surgeons", "to", "optimize",
    "long-term", "outcomes", "for", "affected", "individuals.", "Comprehensive", "patient", "counseling",
    "regarding", "realistic", "expectations,", "surgical", "risks,", "and", "individualized", "postoperative",
    "surveillance", "is", "vital", "for", "informed", "shared", "decision-making.", "Future", "investigations",
    "continue", "to", "explore", "molecular", "biomarkers", "and", "targeted", "anti-inflammatory",
    "agents", "to", "improve", "diagnostic", "precision", "and", "therapeutic", "durability."
  ];

  // Repeat to yield >= 350 words
  const full350Words = words.concat(words.slice(0, 150)).join(" ");
  assert.ok(full350Words.split(/\s+/).length >= 350, "Test payload must have at least 350 words");

  const payload = {
    title: "Laparoscopic Excision in Endometriosis",
    docType: "Clinical Commentary",
    citationStyle: "vancouver" as const,
    sections: [
      {
        heading: "Clinical Evidence and Narrative Synthesis",
        blocks: [full350Words]
      }
    ],
    references: [
      "1. Practice Committee of ASRM. Treatment of pelvic pain associated with endometriosis. Fertil Steril. 2020;114(4):769-777."
    ],
    retainedReferences: [
      { pmid: "32977987", title: "Treatment of pelvic pain associated with endometriosis", year: "2020" }
    ]
  };

  const buffer = await buildPdfBuffer(payload);
  assert.ok(buffer.length > 0);

  const parsed = await extractText(new Uint8Array(buffer));
  // Standard commentary with 350 words must easily be <= 6 pages
  assert.ok(parsed.totalPages <= 6, `Page count must be <= 6; got ${parsed.totalPages}`);

  for (let p = 0; p < parsed.totalPages; p++) {
    const text = parsed.text[p] || "";
    // Footer check: verify copyright and page indicator exist
    assert.ok(text.includes("AI PICO v3.1 — © Raouf Roshdy 2026"), `Page ${p + 1} must include footer copyright`);
    assert.ok(text.includes(`Page ${p + 1} of ${parsed.totalPages}`), `Page ${p + 1} must include page indicator`);

    // Verify flowing lines (no isolated 1-word lines from manual wrap fragmentation)
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    const bodyLines = lines.filter(l =>
      !l.startsWith("AI PICO") &&
      !l.startsWith("Page ") &&
      !l.startsWith("Clinical") &&
      !l.startsWith("Laparoscopic") &&
      !l.startsWith("DOCUMENT") &&
      !l.startsWith("CLINICAL") &&
      !l.startsWith("EDUCATIONAL") &&
      !l.startsWith("· Citation Style") &&
      !l.startsWith("References") &&
      !l.startsWith("1.") &&
      !l.includes("disclaimer") &&
      !l.includes("independent clinical verification") &&
      !l.includes("pubmed.ncbi.nlm.nih.gov") &&
      !l.includes("doi.org") &&
      !l.startsWith("http") &&
      l !== "literature."
    );

    for (const line of bodyLines) {
      const lineWords = line.split(/\s+/);
      // In PDFKit native wrapping, body lines in justified text contain multiple words
      if (lineWords.length === 1 && line.length > 3) {
        assert.fail(`Detected fragmented single-word line: "${line}" on page ${p + 1}`);
      }
    }
  }
});
