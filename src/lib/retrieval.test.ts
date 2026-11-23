import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePubMedXml,
  classifyEvidenceType,
  dedupeRefs,
  titleSimilarity,
  reconstructInvertedIndex,
  applyNoiseFilters
} from "./retrieval.ts";
import { buildPicoQuery } from "./concept-map.ts";
import type { AuditableRef } from "./relevance.ts";
import type { PicoWord } from "./pico-roles.ts";

test("RET-1. efetch XML parser extracts structured abstracts, publication types, and metadata", () => {
  const xmlFixture = `<?xml version="1.0" ?>
<!DOCTYPE PubmedArticleSet PUBLIC "-//NLM//DTD PubMedArticle, 1st January 2024//EN" "https://dtd.nlm.nih.gov/ncbi/pubmed/out/pubmed_240101.dtd">
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation Status="MEDLINE" Owner="NLM">
      <PMID Version="1">39122964</PMID>
      <Article PubModel="Print-Electronic">
        <Journal>
          <ISOAbbreviation>Nat Med</ISOAbbreviation>
          <JournalIssue CitedMedium="Internet">
            <Volume>30</Volume>
            <Issue>9</Issue>
            <PubDate>
              <Year>2024</Year>
              <Month>Sep</Month>
            </PubDate>
          </JournalIssue>
          <Title>Nature medicine</Title>
        </Journal>
        <ArticleTitle>A double-blind, randomized, controlled trial of AI-based embryo selection in IVF.</ArticleTitle>
        <Abstract>
          <AbstractText Label="BACKGROUND">Artificial intelligence models have shown promise in static embryo assessment.</AbstractText>
          <AbstractText Label="METHODS">We conducted a multi-center double-blind RCT enrolling 1,066 patients undergoing IVF.</AbstractText>
          <AbstractText Label="RESULTS">Clinical pregnancy rate did not significantly differ between the AI and conventional morphology groups.</AbstractText>
          <AbstractText Label="CONCLUSIONS">AI-based embryo selection did not improve clinical pregnancy rates compared with conventional morphology.</AbstractText>
        </Abstract>
        <AuthorList CompleteYN="Y">
          <Author ValidYN="Y">
            <LastName>Illingworth</LastName>
            <ForeName>Peter</ForeName>
            <Initials>P</Initials>
          </Author>
          <Author ValidYN="Y">
            <LastName>Smith</LastName>
            <ForeName>Adam</ForeName>
            <Initials>A</Initials>
          </Author>
        </AuthorList>
        <PublicationTypeList>
          <PublicationType UI="D016428">Journal Article</PublicationType>
          <PublicationType UI="D016449">Randomized Controlled Trial</PublicationType>
        </PublicationTypeList>
        <MeshHeadingList>
          <MeshHeading>
            <DescriptorName UI="D005298" MajorTopicYN="N">Fertilization in Vitro</DescriptorName>
          </MeshHeading>
          <MeshHeading>
            <DescriptorName UI="D001185" MajorTopicYN="N">Artificial Intelligence</DescriptorName>
          </MeshHeading>
        </MeshHeadingList>
      </Article>
      <PubmedData>
        <ArticleIdList>
          <ArticleId IdType="pubmed">39122964</ArticleId>
          <ArticleId IdType="doi">10.1038/s41591-024-03153-7</ArticleId>
        </ArticleIdList>
      </PubmedData>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

  const records = parsePubMedXml(xmlFixture);
  assert.equal(records.length, 1);

  const r = records[0];
  assert.equal(r.pmid, "39122964");
  assert.equal(r.doi, "10.1038/s41591-024-03153-7");
  assert.equal(r.journal, "Nat Med");
  assert.equal(r.year, "2024");
  assert.equal(r.authors, "Illingworth P, Smith A");
  assert.equal(r.title, "A double-blind, randomized, controlled trial of AI-based embryo selection in IVF");
  assert.equal(r.abstractAvailable, true);
  assert.ok(r.context?.includes("BACKGROUND: Artificial intelligence"));
  assert.ok(r.context?.includes("METHODS: We conducted a multi-center double-blind RCT enrolling 1,066 patients"));
  assert.ok(r.context?.includes("RESULTS: Clinical pregnancy rate did not significantly differ"));
  assert.ok(r.context?.includes("CONCLUSIONS: AI-based embryo selection did not improve"));
  assert.ok(r.pubTypes?.includes("Randomized Controlled Trial"));
  assert.equal(r.evidenceType, "rct");
});

test("RET-2. concept-map builds the expected PubMed query for AI embryo selection case", () => {
  const words: PicoWord[] = [
    { word: "IVF", role: "population" },
    { word: "artificial intelligence embryo selection", role: "intervention" },
    { word: "conventional morphology", role: "comparator" },
    { word: "live birth", role: "outcome" }
  ];

  const standardQuery = buildPicoQuery(words, {
    includeComparator: true,
    includeOutcome: false,
    designFilter: false,
    humanFilter: true
  });

  // Population block check
  assert.ok(
    standardQuery.includes('"fertilization in vitro"[MeSH] OR IVF OR ICSI OR "assisted reproduction"')
  );

  // Intervention concept blocks check
  assert.ok(
    standardQuery.includes('"artificial intelligence"[MeSH] OR "machine learning"[MeSH] OR "deep learning" OR "neural network" OR "iDAScore" OR "KIDScore"')
  );
  assert.ok(
    standardQuery.includes('"embryo selection" OR blastocyst OR "embryo assessment" OR "embryo ranking" OR "time-lapse"')
  );

  // Comparator block check
  assert.ok(
    standardQuery.includes('morphology OR "Gardner grading" OR "morphological assessment"')
  );

  // Level 0 query must NOT include live birth as hard AND (reserved for ranking per D-05)
  assert.ok(!standardQuery.includes('"live birth"[MeSH]'));

  // Human subjects filter
  assert.ok(standardQuery.includes("NOT (animals[mh] NOT humans[mh])"));

  // Design filter query
  const designQuery = buildPicoQuery(words, {
    includeComparator: true,
    includeOutcome: false,
    designFilter: true,
    humanFilter: true
  });
  assert.ok(
    designQuery.includes("(randomized controlled trial[pt] OR systematic review[pt] OR meta-analysis[pt])")
  );
});

test("RET-3. evidenceType maps correctly across priority sources, Crossref types, and DOI prefixes", () => {
  // 1. PubMed PublicationType priority
  assert.equal(
    classifyEvidenceType({ title: "Study", pubTypes: ["Randomized Controlled Trial"] }),
    "rct"
  );
  assert.equal(
    classifyEvidenceType({ title: "Study", pubTypes: ["Meta-Analysis"] }),
    "meta_analysis"
  );
  assert.equal(
    classifyEvidenceType({ title: "Study", pubTypes: ["Systematic Review"] }),
    "systematic_review"
  );
  assert.equal(
    classifyEvidenceType({ title: "Study", pubTypes: ["Practice Guideline"] }),
    "guideline"
  );

  // 2. Crossref types
  assert.equal(
    classifyEvidenceType({ title: "Study", crossrefType: "posted-content" }),
    "preprint"
  );
  assert.equal(
    classifyEvidenceType({ title: "Study", crossrefType: "book-chapter" }),
    "book_chapter"
  );
  assert.equal(
    classifyEvidenceType({ title: "Study", crossrefType: "dissertation" }),
    "thesis"
  );

  // 3. DOI prefixes
  assert.equal(
    classifyEvidenceType({ title: "Study", doi: "10.21203/rs.3.rs-5504223/v1" }),
    "preprint"
  );
  assert.equal(
    classifyEvidenceType({ title: "Study", doi: "10.1101/2024.01.15.575684" }),
    "preprint"
  );

  // 4. ClinicalTrials.gov
  assert.equal(
    classifyEvidenceType({ title: "Trial NCT04512345", source: "ClinicalTrials.gov" }),
    "trial_registration"
  );
});

test("RET-4. dedupeRefs merges preprint with journal version of record (D-14)", () => {
  const preprintRef: AuditableRef = {
    title: "Investigating the Artificial intelligence in prediction and evaluation sperm and embryo quality in In vitro fertilization (IVF): A systematic review",
    journal: "Research Square",
    year: "2024",
    doi: "10.21203/rs.3.rs-5504223/v1",
    authors: "Yaghi M, et al.",
    source: "Preprint",
    evidenceType: "preprint"
  };

  const journalRef: AuditableRef = {
    pmid: "42914619",
    title: "Investigating artificial intelligence in predicting and evaluating sperm and embryo quality in the in vitro fertilization (IVF): a systematic review",
    journal: "Eur J Obstet Gynecol Reprod Biol",
    year: "2025",
    doi: "10.1007/s44163-025-00420-8",
    authors: "Yaghi M, et al.",
    source: "PubMed",
    evidenceType: "systematic_review"
  };

  // Test title similarity directly
  const sim = titleSimilarity(preprintRef.title, journalRef.title);
  assert.ok(sim >= 0.85, `Expected similarity >= 0.85, got ${sim}`);

  // Test dedupeRefs merging
  const deduped = dedupeRefs([preprintRef, journalRef]);
  assert.equal(deduped.length, 1, "Expected preprint and journal version to merge into 1 record");

  const merged = deduped[0];
  assert.equal(merged.pmid, "42914619", "Version of record with PMID must be preferred");
  assert.equal(merged.evidenceType, "systematic_review");
  assert.ok(merged.relatedIds?.includes("10.21203/rs.3.rs-5504223/v1"), "Preprint DOI must be preserved in relatedIds");
});

test("RET-5. reconstructInvertedIndex reconstructs abstract from OpenAlex positional map", () => {
  const index = {
    This: [0],
    is: [1],
    a: [2],
    structured: [3],
    abstract: [4]
  };
  assert.equal(reconstructInvertedIndex(index), "This is a structured abstract");
  assert.equal(reconstructInvertedIndex(null), "");
  assert.equal(reconstructInvertedIndex(undefined), "");
});

test("RET-6. Noise control filters drop pre-2010 AI records and ungrounded book chapters", () => {
  const words: PicoWord[] = [
    { word: "IVF", role: "population" },
    { word: "artificial intelligence embryo selection", role: "intervention" },
    { word: "conventional morphology", role: "comparator" },
    { word: "live birth", role: "outcome" }
  ];

  const testCorpus: AuditableRef[] = [
    // 1. Pre-2010 book chapter without I-concept terms (should be dropped)
    {
      title: "Patient Screening and Selection",
      journal: "Handbook of In Vitro Fertilization",
      year: "1984",
      evidenceType: "book_chapter"
    },
    // 2. Pre-2010 equipment chapter without I-concept terms (should be dropped)
    {
      title: "Selection and Use of Equipment",
      journal: "In Vitro Fertilization and Alternative Assisted Reproduction",
      year: "1988",
      evidenceType: "book_chapter"
    },
    // 3. Pre-2010 general paper without AI/ML terms or comparator SR (should be dropped for AI query)
    {
      title: "Embryo morphology assessment in IVF",
      journal: "Fertil Steril",
      year: "1999",
      evidenceType: "cohort"
    },
    // 4. Pre-2010 systematic review of the comparator (conventional morphology) (should be kept)
    {
      title: "Conventional morphology for embryo evaluation in IVF: a systematic review",
      journal: "Hum Reprod Update",
      year: "2008",
      evidenceType: "systematic_review"
    },
    // 5. Post-2010 AI embryo trial (should be kept)
    {
      title: "Artificial intelligence embryo selection in IVF: randomized trial",
      journal: "Nat Med",
      year: "2024",
      evidenceType: "rct"
    }
  ];

  const filtered = applyNoiseFilters(testCorpus, words);
  assert.equal(filtered.length, 2);
  assert.ok(filtered.some(r => r.year === "2024"));
  assert.ok(filtered.some(r => r.year === "2008"));
  assert.ok(!filtered.some(r => r.year === "1984"));
  assert.ok(!filtered.some(r => r.year === "1988"));
  assert.ok(!filtered.some(r => r.year === "1999"));
});
