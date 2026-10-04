# AIPICO — Clinical Question Assistant (Obstetrics & Gynecology)

Turns a clinical question into a structured PICO, retrieves candidate literature, and
generates a commentary in which **every citation resolves to a source that survived a
deterministic, claim-specific filter**.

Live app: **https://aipico.vercel.app**

The problem this codebase is built around: a language model will happily write a fluent,
well-formatted literature review that cites papers which were never retrieved, mix an
intervention the reader did not ask about into the discussion, or attribute a finding to
the wrong author. Those failures are invisible to the reader and easy to miss in review.
So the rule here is that unsupported content is not allowed to reach a deliverable — it is
removed, rewritten into an explicit limitation, or the export is refused.

---

## The integrity pipeline

Each stage is a pure, independently tested module. The order matters: a stage may only
act on records the previous stage approved.

| Stage | Module | Guarantee |
|---|---|---|
| Canonical identity | `src/lib/evidence-set.ts` | One record per paper. DOI is the canonical key (normalized from bare, `doi:`, and resolver-URL forms); PMID, `crossref:`, `openalex:` and a title/author/year fingerprint are fallbacks only. `cr:123` never becomes a DOI. |
| Claim filtering | `src/lib/relevance.ts` | A record is direct support only if it carries a DOI or PMID, is not low confidence, and deterministically matches **every** required PICO element. Off-topic records are excluded with a stated reason. |
| Claim finalization | `src/lib/claim-finalization.ts` | Each narrative sentence is audited. An assertive claim with no surviving support is **rewritten** into a fixed uncertainty sentence rather than silently deleted, and each decision is reported with a reason. |
| Narrative reconciliation | `src/lib/relevance.ts` | Citations and the reference list are driven to agreement by a fixpoint across `abstract`, `introduction`, `discussion` **and** `conclusion`. Removing a citation can strand a reference and vice versa, so the loop repeats until neither side changes. |
| Deliverable gate | `src/lib/deliverable-integrity.ts` | Asserts the exact payload being published, and the exact reference list every export emits, carries the same validated evidence set. |

### Why the citation parser is slot-based

The original regex `/\(([^()]*?)(\d{4})\)/` backtracked to the **last** year in a bracket,
so `(Berghella 2026; Broad 2009)` parsed as *both* citations dated 2009. The integrity
checker and the orphan stripper then disagreed about the same sentence, which produced
intermittent phantom failures in production. Parsing and stripping now share one
slot-based parser (`parseCitationSlots`), which also handles `(Gen 2012, 2014)`,
`(Gen., 2012)`, square and brace brackets, and name-only slots.

### The deliverable gate is a parity gate, not a stricter judge

It is tempting for a validation layer to re-resolve citations more strictly than the
pipeline it guards. Doing so caused a real outage: requiring the citing surname to be a
record's *first* author rejected valid commentary citing a retained paper by a co-author,
and the API began returning HTTP 500. The gate now uses the **same** resolution semantics
as the reconciliation stage, and adds identifier-grade matching only where the pipeline
needs help — binding reference strings and export payloads back to retained records.

---

## Commands

```bash
npm install

npm run dev        # dev server
npm run build      # production build
npm run start      # serve the production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm test           # node:test — 169 tests
```

Deploy:

```bash
npx vercel --prod --yes
```

### Environment

`.env*` is gitignored; **never commit a key**. Configure the environment through your
host's secret store rather than a file you might later commit.

---

## Tests

169 tests, no test framework beyond `node:test` and `node:assert`. They encode clinical and
editorial rules rather than implementation details:

| File | What it protects |
|---|---|
| `production-fixtures.test.ts` | Real production shapes: relevant short-cervix evidence retained; cancer / PCOS / endometriosis / neonatal / wrong-population / wrong-intervention records excluded; the zero-support case emits the exact published message and fabricates nothing |
| `citation-integrity-regression.test.ts` | T1–T15 citation and reference regressions |
| `citation-slot-parsing.test.ts` | Multi-citation, multi-year, name-only and bracket variants |
| `claim-finalization.test.ts` | Supported, unsupported, off-PICO, contradictory and cross-field claims, plus run-to-run determinism |
| `confidence-gate.test.ts` | Confidence, identifier and PICO eligibility |
| `dedup-crossprovider.test.ts` | PubMed / Crossref / OpenAlex copies of one paper collapse to one record |
| `reconcile.test.ts` | Fixpoint, determinism and idempotence |
| `deliverable-integrity.test.ts` | The export gate, per narrative field |

---

## Architecture

```
src/app/
  page.tsx            question entry
  question/           clarification flow
  paper/              PICO selection, commentary, every export action
  gap/                evidence mapping
  api/engine/         retrieval, claim filtering, commentary, claim audit
  api/pdf/            PDF rendering + server-side integrity refusal (422)
  api/pubmed/         direct PubMed lookup
src/lib/
  evidence-set.ts     canonical identity and cross-provider dedup
  relevance.ts        PICO matching, citation parsing, reconciliation
  claim-finalization.ts
  deliverable-integrity.ts
  clinical-keywords.ts  vocabulary, corrections, no-evidence messaging
```

PDF, Word and clipboard exports are separate code paths that each build a bibliography.
Rather than trusting each to remember the filtered set, each hands its intended references
to `guardDeliverable()` first and is refused when they do not match — and `/api/pdf`
re-checks server-side, because the browser is not a trust boundary.

---

## Known limitations

Stated plainly, because a README that only lists strengths is not documentation.

- **Live output varies.** Retrieval returns a stable pool, but the model cites a different
  subset each run, so the reference count moves between roughly 3 and 8. The *invariants*
  (no orphan citation, no uncited reference, reference/source parity, full audit coverage)
  hold every run; the count does not. Treat the count as provider variability, not a
  regression signal.
- **Retrieval can return an empty pool** when an upstream provider is unavailable, in which
  case the app states that no related literature was found. This is honest but it is also
  indistinguishable from a genuine zero-hit search in the response alone.
- **Fallback coverage is partial.** When the LLM provider is unavailable, a deterministic
  commentary fallback exists, but it is specific to the short-cervix case rather than
  derived from arbitrary submitted PICO elements. Other LLM-dependent stages still require
  a working provider.
- **Strict author matching is deliberately absent.** The gate accepts a citation naming any
  author on a retained record, matching the pipeline's own behaviour. This trades a small
  amount of strictness for not rejecting sound commentary; see the gate section above.
- Two auxiliary audit scripts used during development still report unresolved issues: a
  multi-database coverage expectation that only one provider currently satisfies, and a UI
  selector timeout in the reference-audit flow.

---

## License

See the repository owner for licensing terms.
