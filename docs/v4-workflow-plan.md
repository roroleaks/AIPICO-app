# AIPICO v4 — New Workflow Master Plan

> This document is the single source of truth for the workflow redesign of the AIPICO app
> (https://github.com/roroleaks/AIPICO-app). Every Antigravity prompt (Prompt 01, 02, …)
> refers back to this plan.

---

## 1. The requested new workflow (owner's words, formalized)

| Step | What the researcher does | What the app does |
|---|---|---|
| **Step 1 — PICO word intake** | Submits **3–5 words** they feel are related. Every word must belong to one of the four PICO elements: Population, Intervention, Comparison, Outcome. | Validates the count and PICO roles. Each word gets a role tag (P / I / C / O), auto-suggested, editable by the user. |
| **Step 2 — Screening → 3 PICO phrases** | Clicks "Screen literature". | Searches the literature for records that contain **exactly those words** (AND logic). From the retrieved corpus it produces **exactly 3 main PICO phrases — NOT links** — one per category: **(i) Established knowledge**, **(ii) Conflicting evidence**, **(iii) Research gap**. |
| **Step 3 — Evidence explorer** | Chooses **one** of the three phrases (any category). | Retrieves **all papers related to that chosen phrase**, shows each paper as a link with a **% relevance score**, and lets the researcher **exclude** any paper. |
| **Step 4 — Commentary paper** | Clicks "Generate commentary". | Creates a **commentary paper about the chosen phrase**, using the app's existing mechanism: only retained (non-excluded) evidence can be cited, deterministic integrity gates, citation styles (Vancouver / APA / Harvard), PDF + Word export with provenance. |

Steps 3 and 4 are **identical in behavior for all three categories** — only the source phrase differs.

---

## 2. Current state of the code (verified against the repo)

### Pages / routing
| Route | Role today | Fate in v4 |
|---|---|---|
| `/` (`src/app/page.tsx`) | Step 1: "Quick Tag Words" (4–6 keywords) or "Structured PICO Fields"; mode tabs "Formulate Question" / "Find Gap" | **Reworked** → 3–5 PICO-tagged words; mode tabs removed |
| `/gap` (`src/app/gap/page.tsx`) | Step 2: evidence map with 4 known + 4 uncertain points (each with reference links), 4 gaps, 4 suggested PICO questions | **Replaced by `/screen`** (3 phrases, no links). Old page kept until v4 flow is verified, then removed |
| `/question` (`src/app/question/page.tsx`) | Step 3: outcome selection + citation style | **Absorbed** — outcome comes from the Step 1 words / chosen phrase; citation style moves to `/paper` (live toggle already exists there) |
| `/paper` (`src/app/paper/page.tsx`) | Step 4: commentary + audit + export | **Kept**, entry data changes (comes from `/explore` retained set) |
| — | — | **New `/explore`** page = new Step 3 |

### Engine API (`src/app/api/engine/route.ts`)
Stages today: `intent`, `clarify`, `formulate`, `gap`, `commentary` (zod-validated in `stageSchema`).
- `gap`: AI prompt (or `generateDeterministicGapAnalysis` fallback) → 4 known / 4 uncertain / 4 gaps / 4 suggestedQuestions, then `fetchReferencesForPoints()` attaches up to 4 refs per point (PubMed + Cochrane CENTRAL + Europe PMC + OpenAlex + Crossref + Semantic Scholar, dedup + eligibility filter, 25 s deadline).
- `commentary`: retrieval + `auditRef` claim filtering + AI/deterministic narrative + citation reconciliation + integrity gates.

v4 adds two stages to the same route: **`screen`** and **`explore`**.

### Key libraries to reuse (do NOT rewrite)
- `src/lib/clinical-keywords.ts` — tokenizer, `MIN_KEYWORDS = 4` / `MAX_KEYWORDS = 6`, `validateKeywords`, spelling suggestions.
- `src/lib/clinical-semantics.ts` — `parseClinicalScenario` (free text → P/I/C/O slots, specialty, derived outcomes).
- `src/lib/relevance.ts` — `auditRef(ref, elements): RefAudit` (boolean P/I/C/O matches + `score` 0–4 + metadata confidence), `isDirectSupport`, `curateReferences`, citation reconciliation.
- `src/lib/deterministic-gap.ts` — deterministic fallback pattern for the gap stage.
- `src/lib/evidence-set.ts` — canonical identity, dedup (DOI primary key).
- `src/lib/session.ts` — `sessionStorage` helpers and `KEYS`.
- `src/lib/deliverable-integrity.ts`, `claim-finalization.ts`, `provenance.ts`, `docx-generator.ts`, `pdf-generator.ts`, `citation-formatter.ts` — untouched.

### Session keys
Existing: `cq_input`, `cq_inputText`, `cq_mode`, `cq_gap`, `cq_question`, `cq_formulation`, `cq_commentary`, `cq_outcomes`, `cq_citation_style`.
v4 adds: `cq_pico_words`, `cq_screen`, `cq_choice`, `cq_evidence`.

---

## 3. Target architecture

```
/  ──Step 1──▶  /screen  ──Step 2──▶  /explore  ──Step 3──▶  /paper  ──Step 4──▶  PDF / DOCX
│               │                      │                       │
│ words + roles │ 3 PICO phrases       │ paper list with       │ commentary built ONLY
│ (3–5, PICO)   │ (established /       │ % relevance +         │ from retained evidence
│               │  conflicting /       │ exclude toggles       │ (existing pipeline)
│               │  gap), no links      │                       │
```
