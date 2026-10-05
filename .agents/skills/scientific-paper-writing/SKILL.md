---
name: scientific-paper-writing
description: >-
  Comprehensive protocol, guide, and templates for authoring evidence-based scientific commentary papers
  and clinical syntheses for Step 4 of the AIPICO workflow. Enforces Vancouver citation style (ICMJE/NLM),
  strict claim-to-reference grounding, structured medical abstract drafting, thematic discussion structuring,
  and deliverable integrity. Use when synthesizing clinical evidence, authoring obstetrics and gynecology commentaries,
  formatting medical citations in Vancouver style, or validating commentary deliverables.
---

# Scientific Commentary Paper Authoring Skill (Vancouver Style)

This skill governs the production of publication-grade **Scientific Commentary Papers** for **Step 4** of the AIPICO clinical evidence workflow.

---

## 1. Clinical Mission & Core Tenets

The purpose of Step 4 is to translate the formulated clinical question (PICO) and the retrieved direct evidence into a rigorous, peer-review-quality **Scientific Commentary Paper** for clinicians, maternal-fetal medicine specialists, and gynecologists.

### Guiding Principles:
1. **Absolute Evidence Grounding (Zero Hallucination):** Every single statement asserting an effect size, safety profile, clinical mechanism, or treatment recommendation MUST be anchored directly to verified literature from the filtered direct evidence pool.
2. **Vancouver Citation Standard (ICMJE / NLM):** The paper uses sequential numerical brackets (`[1]`, `[2]`, `[1-3]`) and an ordered numerical bibliography. Chicago author-date style is strictly avoided.
3. **Thematic Clinical Synthesis:** Evidence is not merely summarized study-by-study; it is synthesized thematically by clinical outcomes, subgroup nuances, methodological certainty, and practice implications.
4. **Deliverable Parity:** The on-screen text, generated Commentary PDF, References PDF, and Word export must maintain 100% citation and bibliographic parity.

---

## 2. PICO Framework & Question Alignment

Before drafting, ensure strict alignment with the formulated PICO package from Steps 1–3:
- **Population (P):** Explicitly specified (e.g., *Asymptomatic singleton pregnancy with transvaginal ultrasound cervical length < 25 mm before 24 weeks*).
- **Intervention (I):** Clearly identified (e.g., *Vaginal progesterone 200 mg daily*).
- **Comparator (C):** Active control or standard of care (e.g., *Cervical cerclage* or *Expectant management / Placebo*).
- **Outcomes (O):** Literature-derived outcomes selected in Step 3 (e.g., *Spontaneous preterm birth < 34 weeks, Neonatal composite morbidity, Perinatal mortality*).

The paper must directly answer the **Answerable Clinical Question** formulated in Step 3.

---

## 3. Paper Architecture & Section Standards

A complete Scientific Commentary Paper contains six mandatory sections:

### 3.1 Title
- Clear, professional, and directly reflective of the evaluated clinical question.
- *Format:* Informative clinical title (e.g., *Vaginal Progesterone versus Cervical Cerclage for the Prevention of Preterm Birth in Asymptomatic Short Cervix: A Systematic Evidence Commentary*).

### 3.2 Structured Abstract (250–300 words)
- **Background:** High-level epidemiological context, clinical dilemma, and rationale.
- **Clinical Question:** Formulated PICO statement and comparative objective.
- **Evidence Synthesis:** Synthesis of randomized controlled trials (RCTs) and systematic reviews, reporting quantitative effect sizes (RR/OR, 95% CI) where documented.
- **Clinical Bottom Line:** Actionable take-home recommendation and GRADE certainty of evidence.

### 3.3 MeSH Keywords
- 5–6 controlled vocabulary descriptors aligned with National Library of Medicine (NLM) Medical Subject Headings (MeSH).
- *Examples:* `Pregnancy, High-Risk`, `Premature Birth / prevention & control`, `Uterine Cervical Incompetence`, `Progesterone / therapeutic use`, `Cerclage, Cervical`.

### 3.4 Introduction (2–3 paragraphs)
- **Paragraph 1: Clinical Problem & Burden:** Prevalence, clinical consequences (e.g., neonatal morbidity, respiratory distress, neurodevelopmental impairment).
- **Paragraph 2: Biological & Pharmacological Plausibility:** Mechanisms of action of the intervention and comparator (e.g., progesterone's anti-inflammatory and myometrial quiescence effects vs cerclage's mechanical and barrier support).
- **Paragraph 3: Clinical Rationale & Objective:** Why clinical equipoise exists, recent trial data, and the precise aim of this commentary.

### 3.5 Thematic Discussion (Structured with Subheaders)
Organize the discussion into distinct thematic sections using concise Markdown subheadings:
1. **Primary Clinical Outcomes:** Head-to-head comparison on core endpoints (e.g., delivery < 34 weeks, gestational age at birth).
2. **Secondary & Neonatal Outcomes:** Morbidity composites (IVH, NEC, RDS, NICU admission duration).
3. **Subgroup Heterogeneity:** Efficacy stratified by prior preterm birth history, cervical length severity (< 15 mm vs 15–24 mm), and multifetal gestations.
4. **Safety, Tolerability & Procedural Risks:** Medication adherence, vaginal discharge, surgical risks of cerclage (anesthesia, bleeding, cervical trauma, rupture of membranes).
5. **Methodological Quality & Certainty:** Assessment of trial designs, risk of bias, blinding limitations, and GRADE certainty.
6. **Controversies & Gaps in Knowledge:** Unresolved questions, conflicting findings, and ongoing clinical trials.

### 3.6 Clinical Conclusion (1–2 paragraphs)
- Concise, decisive summary for practicing clinicians.
- Delineates first-line therapy, specific patient phenotypes warranting alternative approaches, and directions for future research.

---

## 4. Vancouver Citation Style (ICMJE / NLM) Specification

### 4.1 In-Text Citation Rules
- In-text citations MUST use numbers in square brackets: `[1]`, `[2]`, `[1-3]`, `[1, 4]`.
- Numbering follows the **order of first appearance** in the text.
- Do NOT use author-year parenthetical citations like `(Owen 2020)`.
- If an author's name is mentioned in the narrative prose, place the bracket immediately after the name or clause:
  - *Correct:* *"Owen et al. [1] demonstrated that vaginal progesterone reduces preterm birth..."*
  - *Correct:* *"In singleton pregnancies with a short cervix, progesterone significantly reduces early preterm birth [1, 2]."*
  - *Incorrect:* *"Progesterone reduces preterm birth (Owen 2020)."*

### 4.2 Bibliography Formatting Rules
- References in the bibliography MUST be numbered sequentially starting with `1.` in the exact order they are cited in the text.
- **Authors:** List up to 6 authors (Surname Initials without periods between initials, separated by commas). If more than 6 authors, list the first 6 followed by `et al.`
- **Article Title:** Sentence capitalization, ending with a period. **NO quotation marks**.
- **Journal Name:** Standard NLM/Index Medicus abbreviated journal title, ending with a period.
- **Year & Details:** Publication year followed by a period (or `Year;Volume(Issue):Pages.`).
- **Identifiers:** Include DOI (`doi:10.xxx`) and official URL/PMID (`https://pubmed.ncbi.nlm.nih.gov/xxxx/`).

#### Vancouver Reference Template:
```text
1. Author AA, Author BB, Author CC, Author DD, Author EE, Author FF, et al. Title of journal article in sentence case. Abbreviated Journal Name. Year;Volume(Issue):Pages. doi:10.xxxx/xxxx https://pubmed.ncbi.nlm.nih.gov/xxxx/
```

#### Comparison: Vancouver vs. Chicago Style:
| Feature | Vancouver Style (Required) | Chicago Author-Date Style (Forbidden) |
| :--- | :--- | :--- |
| **In-text citation** | Numbered brackets `[1]` or `[1, 2]` | Parenthetical `(Author 2020)` |
| **Bibliography ordering** | Sequential order of appearance (`1, 2, 3...`) | Alphabetical by author surname |
| **Article title** | Plain text, no quotation marks | Enclosed in double quotes `"Title."` |
| **Year location** | After the journal title (`Obstet Gynecol. 2020.`) | Immediately after author (`Owen. 2020.`) |
| **Author initials** | No punctuation (`Owen DD`) | Given name or periods (`Owen, D. D.`) |

---

## 5. Deliverable Integrity & Verification Checklist

Before publishing or exporting any commentary deliverable (PDF, Word, or Clipboard):

- [ ] **No Hallucinated Citations:** Every cited record originates from the verified direct evidence pool.
- [ ] **No Orphan Citations:** Every bracketed citation (e.g. `[1]`, `[2]`) maps to an existing entry in the reference list. No out-of-range citations (e.g. `[7]` when only 4 references exist).
- [ ] **No Uncited References:** Every reference in the bibliography is cited at least once in the narrative.
- [ ] **Sequential Ordering:** Reference `[1]` is cited before `[2]`, which is cited before `[3]`.
- [ ] **Title Quote Elimination:** No double quotes around article titles in the reference list.
- [ ] **Quantitative Precision:** Reported relative risks, odds ratios, and confidence intervals match the underlying source abstract verbatim.

---

## 6. References & Templates

- [Vancouver Style Guide & Examples](./references/vancouver-style-guide.md)
- [Obstetrics & Gynecology Commentary Template](./references/commentary-template.md)
- [Sample Commentary Walkthrough](./examples/sample-commentary.md)
