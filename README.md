# AIPICO v3.1 — Evidence-Grounded Clinical Question Assistant (Obstetrics & Gynecology)

Turns a clinical inquiry into a structured PICO, formulates candidate literature queries, retrieves and validates evidence from PubMed and partner repositories, and generates publication-grade evidence syntheses and commentaries where **every cited reference resolves strictly to a source that survived deterministic, claim-specific filtering**.

- Live App: **https://aipico.vercel.app**
- Secondary Production Alias: **https://aipico-app.vercel.app**

The fundamental safety problem this codebase addresses: large language models readily draft fluent medical commentaries that invent non-existent studies, cite papers never retrieved, introduce irrelevant clinical interventions, or attribute findings to incorrect authors. In clinical decision support, such hallucinations can directly misinform care. Within AIPICO, unsupported claims cannot reach an exported deliverable — they are rewritten into explicit uncertainty disclosures or the export is refused.

---

## Core Capabilities and Architecture

### 1. Multi-Style Publication Citation Engine
- **Vancouver Style (ICMJE/NLM)**: Pure uppercase superscript numerical in-text citations without surrounding brackets (e.g., `¹`, `¹ ²`, `¹⁻³`), paired with an ICMJE-compliant numerical bibliography.
- **APA 7th Edition**: Author-date parenthetical in-text citations `(Author et al., Year)` and alphabetical bibliography.
- **Harvard Style**: Author-year citations `(Author et al. Year)` with complete electronic identifier linkages (`Available at: URL`).
- **Dynamic In-Session Toggling**: Clinicians can select their preferred citation framework during intake (Step 3: `/question`) or switch dynamically in the commentary viewer (Step 4: `/paper`).

### 2. Publication-Grade Multi-Format Export Pipelines
- **Microsoft Word (.docx)**: Native binary document generation via `/api/docx` and `src/lib/docx-generator.ts`. Adheres strictly to ICMJE standards with 1-inch margins, running headers, running footers with native Word field page numbers (`Page X of Y`), Arial typography, structured PICO summary tables, and full reference trees.
- **Vector PDF Generation**: High-fidelity PDF compilation via `/api/pdf` and `src/lib/pdf-generator.ts` utilizing PDFKit and bundled TrueType fonts (DejaVu Sans). Implements exact single-page budgeting, margin suspension during running header/footer passes, and parity validation gates.
- **Glyph and Symbol Preservation**: Complete UTF-8 preservation of non-WinAnsi mathematical and Greek characters (≥, ≤, α, ±, µ, é, ü, –, ’, →) across all exports.

### 3. Specialty Scope Boundary & Clinical Safety
- **Specialty Boundary Gate (`checkQueryScope`)**: Enforces clinical scoping across 54 core Obstetric & Gynecologic root terms. Out-of-scope adult general medicine queries (non-obstetric Cardiology, Neurology, Orthopedics, Gastroenterology, Dermatology) are intercepted with informative HTTP 422 advisories.
- **Obstetric Precedence Rule**: Clinical inquiries presenting dual context (e.g., *peripartum cardiomyopathy*, *cardiac disease in pregnancy*, *ovarian stimulation in heart disease*) retain maternal context and execute normally.
- **Specificity & Vagueness Interception (`checkQueryVagueness`)**: Underspecified or non-specific inquiries (e.g., single-term searches or generic filler) receive structured HTTP 422 clarification requests.
- **NLM Human Subject Clinical Filter**: Restricts PubMed retrieval ladders with `NOT (animals[mh] NOT humans[mh])`, excluding veterinary and preclinical rodent models from human clinical evidence sets.
- **Regulatory Intake Disclaimer**: Persistent banner (`PhiNotice.tsx`) warns clinicians against entering protected health information (PHI/PII).

### 4. Deterministic Multi-Stage Integrity Pipeline

Each stage is an isolated, pure module with automated verification:

| Pipeline Stage | Implementation Module | Invariant and Enforcement Rule |
|---|---|---|
| **Canonical Identity** | `src/lib/evidence-set.ts` | One canonical record per publication. Normalized DOI is primary key; PMID, Crossref, and OpenAlex serve as verified fallbacks. |
| **Claim Filtering** | `src/lib/relevance.ts` | Records provide direct support only when carrying verified identifiers and deterministically matching all required PICO dimensions. |
| **Claim Finalization** | `src/lib/claim-finalization.ts` | Every narrative assertion is audited against retained evidence. Claims lacking direct support are rewritten into uncertainty disclosures. |
| **Narrative Reconciliation** | `src/lib/relevance.ts` | Citations and bibliography lists are driven to strict parity across abstract, introduction, discussion, and conclusion sections via a fixpoint loop. |
| **Deliverable Gate** | `src/lib/deliverable-integrity.ts` | Enforces that export payloads and rendered reference lists match the validated evidence set. Server-side gates reject tampered payloads with HTTP 422. |
| **Methods & Provenance** | `src/lib/provenance.ts` | Embeds retrieval date/time, candidate search queries, engines queried, synthesis mode (AI vs Deterministic), prompt template hash, and runtime build commit into all exports. |
| **API Rate Limiting** | `src/lib/rate-limiter.ts` | In-memory sliding-window rate limiter on public API endpoints enforcing request throttling (HTTP 429) against high-frequency traffic bursts. |
| **Security Headers** | `src/lib/security-headers.ts` | Enforces Content-Security-Policy (CSP), Strict-Transport-Security (HSTS), X-Frame-Options: DENY, X-Content-Type-Options: nosniff, and origin-validated CORS. |

---

## Technical Defect Remediation Summary (DEF-001 to DEF-013)

The application has undergone verification against all 13 defect items from `results/05_defects.csv`:

- **DEF-001 (Metadata Domain Resolution)**: `src/lib/site-config.ts` dynamically resolves canonical URL metadata based on incoming request host headers.
- **DEF-002 (PHI/PII Warning)**: Step 1 intake form renders `src/components/PhiNotice.tsx` warning against patient identifiers.
- **DEF-003 (API Rate Limiting)**: `src/lib/rate-limiter.ts` enforces sliding-window rate limits across `/api/*` endpoints.
- **DEF-004 (Arabic Comma)**: Explicitly withdrawn per clinical protocol; multilingual RTL handling is scheduled for subsequent localized releases.
- **DEF-005 (Security Headers & CORS)**: Custom middleware injects standard security headers and replaces wildcard CORS with strict origin validation.
- **DEF-006 (Trailing Dash Separation)**: Intake parser in `src/lib/clinical-keywords.ts` handles trailing-space dash separators (`X- Y`) without dropping concepts.
- **DEF-007 (Provenance Metadata)**: PDF and Word exports include a dedicated "Methods & Provenance" block recording search queries, model/engine mode, prompt hashes, and build commit.
- **DEF-008 (Vague Query Interception)**: `checkQueryVagueness` flags underspecified queries with HTTP 422 clarification prompts.
- **DEF-009 (Font Symbol Preservation)**: Bundled TrueType DejaVu Sans fonts preserve mathematical and Greek symbols across PDF compilations.
- **DEF-010 (Conjunction Token Splitting)**: `src/lib/pubmed-query.ts` preserves compound display in the UI while splitting conjunctions into boolean `AND`/`OR` operands during PubMed query construction, restoring recall.
- **DEF-011 (NLM Human Clinical Filter)**: Enforces `NOT (animals[mh] NOT humans[mh])` to exclude veterinary and preclinical rodent models from clinical syntheses.
- **DEF-012 (Specialty Boundary Gate)**: `checkQueryScope` intercepts out-of-scope non-OB/GYN queries while preserving maternal cardiology inquiries via precedence.
- **DEF-013 (PDF Blank Page Elimination)**: PDFKit margin triggers are suspended during running footer rendering, enforcing exact page budgeting.

---

## Directory Architecture

```
src/
├── app/
│   ├── page.tsx                  Step 1: Clinical question and keyword intake
│   ├── gap/                      Step 2: Evidence-gap mapping & PICO formulation
│   ├── question/                 Step 3: Outcome definition & citation style selection
│   ├── paper/                    Step 4: Commentary synthesis, quality scores, live style toggling & export
│   └── api/
│       ├── docx/route.ts         Native Microsoft Word export endpoint with deliverable integrity gate
│       ├── engine/route.ts       Evidence synthesis, deterministic gap analysis, and fallback engine
│       ├── pdf/route.ts          Vector PDF generation with server-side parity verification
│       └── pubmed/route.ts       Direct PubMed E-utilities integration with rate limiting and caching
├── components/
│   └── PhiNotice.tsx             Clinical PHI/PII intake disclaimer banner
├── fonts/
│   ├── DejaVuSans.ttf            Unicode TrueType regular font
│   ├── DejaVuSans-Bold.ttf       Unicode TrueType bold font
│   └── DejaVuSans-Oblique.ttf    Unicode TrueType italic font
└── lib/
    ├── citation-formatter.ts     Multi-style citation engine (Vancouver, APA, Harvard)
    ├── clinical-keywords.ts      Intake keyword tokenizer, spelling suggestions, and boundary validation
    ├── deliverable-integrity.ts  Server-side parity validation and tampered payload rejection gate
    ├── docx-generator.ts         Structured Word document layout engine with native XML headers/footers
    ├── pdf-generator.ts          PDFKit vector document compilation and running header/footer engine
    ├── provenance.ts             Reproducibility metadata generator (prompt version, commit, timestamp)
    ├── pubmed-query.ts           Candidate query ladder builder, specialty scope checker, and MeSH mapper
    ├── rate-limiter.ts           Sliding-window request rate limiter
    ├── relevance.ts              PICO claim filtering, multi-section citation reconciliation fixpoint
    ├── security-headers.ts       HTTP security headers and CORS origin validation
    └── site-config.ts            Dynamic canonical domain resolution
```

---

## Verification and Testing

The repository contains **421 unit tests across 22 test suites** executed via Node.js native test runner (`node:test` and `node:assert/strict`):

```bash
# Run all repository unit tests
npm test

# Run type checking
npm run typecheck

# Run production build
npm run build

# Start production server daemon
npm run start
```

### Full Protocol Execution (Suites A to K)

To run the automated 257-record verification protocol against a running server:

```bash
node results/remediation/final/run_full_protocol.mjs
```

The protocol assesses:
- **Suite A (23 records)**: Keyword parsing, dash separators, conjunction phrases, and token bounds.
- **Suite B (6 records)**: Structured PICO form fields.
- **Suite C (147 records)**: Question formulation across 16 clinical gold cases and 3 engine configurations.
- **Suite D (9 records)**: Evidence-gap identification logic.
- **Suite E (6 records)**: Multi-step workflow navigation and state persistence.
- **Suite F (11 records)**: Export deliverables, unpdf page-count checks, DejaVu glyph retention, and provenance blocks.
- **Suite G (10 records)**: Interface accessibility, social metadata, and canonical domain tags.
- **Suite H (9 records)**: Security headers, CORS restrictions, rate-limit burst enforcement, and PHI disclaimer.
- **Suite I (21 records)**: Clinical informatics capability checklist.
- **Suite J (11 records)**: API schema and contract negative tests.
- **Suite K (4 records)**: Tampered payload rejection and deliverable parity gates.

---

## License

All rights reserved. See repository owner for licensing terms.
