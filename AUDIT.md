# AIPICO Clinical Question Assistant — Full Audit Report

**Audit date:** 2026-10-04
**Commit audited:** `48701ab60f5f281fe6abee0a1b4430209dc1df68` (local = remote, tree clean)
**Runtime audited:** `https://aipico.vercel.app` (deployment `aipico-82dxzvfhz-raouf12.vercel.app`)
**Method:** source reading, direct function probes, local execution, and live HTTP probes against production.

---

## 1. Status

**FAIL — not releasable in its current state.** (Steps 1–6 of 10 complete.)

The deterministic evidence core is genuinely well built and verified: the claim-filter →
evidence-set → finalization → reconciliation → export chain is fully wired from a single
retained set, all 204 tests pass, and typecheck/lint/build are clean. No secrets are exposed
anywhere in the tree or in the entire Git history, and error handling degrades gracefully
without leaking internals.

**11 open defects** remain, led by:

- **4 MEDIUM** functional defects: a tokenizer that silently splits canonical clinical phrases and
  degrades evidence recall (F-07), a per-token length cap gap (F-06), and phrase-level alias and
  CoQ10 normalization defects (F-08, F-09);
- the desktop build still has **no way to obtain an AI provider key** (F-23), so every install is
  limited to the deterministic evidence list;
- two GitHub PATs that must be revoked before release (F-21).

**Resolved during this audit:**

- **F-22 (was CRITICAL)** — `next` upgraded 16.3.2 → 16.3.8 and `sharp` to 0.35.5.
  `npm audit --omit=dev` now reports **0 vulnerabilities** (was 1 critical + 1 high).
  Full suite re-verified green and every other finding re-confirmed on the new runtime.
- **F-01 (was HIGH)** — the desktop bundle was stale, shipping a 264-line engine route and
  none of the evidence-integrity modules. It has been rebuilt from the current tree: all 43
  files verified identical to the repository by SHA-256, the bundled app installs, builds and
  passes its test suite, and it now resolves `next` 16.3.8. A repeatable generator plus an
  SHA-256 staleness guard (wired into `installer/test-installer.ps1`) prevents recurrence.
  PC now matches GitHub and Vercel at the artifact level.
- **F-02, F-10, F-11, F-12, F-13, F-14** — all six API-contract defects fixed and verified over
  HTTP against a running server, 19/19 probes returning the intended status. The export gate now
  refuses malformed input with a named reason instead of throwing into a 500; `/api/pubmed` and
  the provider-key path no longer report failures as HTTP 200; invalid JSON is a 400; absent and
  empty reference lists are treated alike; and non-string `input` is rejected instead of coerced
  into a fake clinical term. Suite grew 169 → 177 with 8 new hostile-input cases.
- **F-03, F-04** — the rule-based fallback can no longer throw, and `clarify`/`formulate` now
  validate their required fields instead of misreporting client errors as provider outages.
  22/22 HTTP probes pass. Suite grew 177 → 187 with a new `rule-engine.test.ts`.
- **F-05** — the app can no longer present a fabricated clinical question. `ruleClarify` was
  skipping clarification entirely for any specialty outside the knowledge base, which guaranteed
  `ruleFormulate` would invent content; it now keeps asking with free-text prompts. `ruleFormulate`
  refuses to state a question without a population and an intervention, the route returns 400
  naming the missing elements, and the client resumes clarification instead of recomputing the
  rejected placeholder locally. 14/14 probes pass; no generated output contains the old
  placeholder wording. Suite grew 187 → 188.
- **F-19 (was OPERATIONAL)** — commentary is no longer a hard failure when the writing service is
  unavailable. The provider recovered during step 6 (200 in 7–19s), which is what finally allowed
  the live commentary E2E to run at all; the no-key path was separately verified. See F-19 and
  F-24 below.
- **F-24 (found and fixed during step 6)** — `splitSentences` cut sentences at the period in
  `et al.` and in author initials, orphaning `2020).` as its own citation-less sentence. Because
  `finalizeClaims` judges one sentence at a time, that made correctly-cited prose look uncited and
  replaced it with the uncertainty boilerplate: on a real commentary it produced 17 stripped
  claims, the same 33-word sentence repeated 7 times in one paragraph, and stray `2026).`
  fragments published in the reader-facing text.

The two audit items previously listed as impossible are now done. The provider returned HTTP 200
for the first time during step 6, so:

- live commentary generation / claim-filtered evidence E2E has now run against the real provider
  and against the no-key fallback — see the verification matrix;
- PDF export end-to-end remains to be exercised with real retained evidence (step 8).

Full acceptance is still not claimed: steps 7–10 are open and PDF export E2E has not run.

---

## 2. Verification matrix — what actually ran

| Check | Command | Result |
|---|---|---|
| Unit/integration tests | `npm test` | **204 pass, 0 fail** (1.44 s) |
| Type safety | `npx tsc --noEmit` | exit 0, clean |
| Lint | `npm run lint` | exit 0, clean |
| Build | `npm run build` | exit 0, 8 routes (5 static, 3 dynamic) |
| **Dependency audit** | `npm audit --omit=dev` | **0 vulnerabilities** (was 2: 1 critical, 1 high) — F-22 resolved |
| Dependency audit (dev) | `npm audit` | 5 high, all lint-toolchain-only, `braces` unpatchable upstream — accepted residual |
| Working-tree secret scan | 9 credential patterns, all non-binary tracked files | **0 hits** |
| History secret scan | `git log -p --all` = 1,178,488 chars, all 21 commits | **0 hits** |
| Historical blob scan | 77 distinct historical text paths | **0 hits** |
| Sensitive files ever committed | `.env`/`secret`/`credential`/`.pem`/`.key`/`id_rsa` | **none, ever** |
| Reflog credential scan | all refs | **0 hits** |
| Remote URL token | `git remote -v` | clean |
| Parser edge cases | 14 intake probes | 5 defects found (F-06…F-09, F-15) |
| Export gate probes | 6 direct `validateDeliverableIntegrity` calls | 1 High-impact defect (F-02) |
| API method handling | GET/PUT on 3 routes | **405 on all** — correct |
| API malformed payloads | 25+ probes across 3 routes | 6 defects (F-02…F-05, F-10…F-13) |
| Live commentary E2E | production ×3 | **PASS — source="ai" (with key); PASS — source="deterministic" (no-key)** — F-19 and F-24 resolved |
| **Desktop bundle parity** | `build-app-source.ps1` | **43/43 files identical by SHA-256** — F-01 fixed |
| **Desktop bundle install** | `npm install` in extracted zip | 362 packages, exit 0; `next` 16.3.8, `sharp` 0.35.5 |
| **Desktop bundle build** | `npm run build` in extracted zip | exit 0, all 8 routes |
| **Desktop bundle tests** | `npm test` in extracted zip | **204 pass, 0 fail** (re-verified after step 6) |
| **Staleness guard** | 2 files edited + 1 added, then `-Check` | correctly reported `STALE BUNDLE`, exit 1 |
| **Line-ending normalization** | `git diff --ignore-cr-at-eol`, `git hash-object` | **empty / blob unchanged** — no content altered |
| Desktop provider-key path | grep all launcher + installer scripts | **absent — F-23** |
| **API status contract** | 19 HTTP probes, 3 routes, live server | **19/19 intended status** — F-02, F-10…F-14 |
| **Provider-key 503** | server started with `.env.local` removed | **503** + rule fallback intact — F-11 |
| Hostile-input regression | 8 new tests in `deliverable-integrity.test.ts` | suite 169 → **177** |
| **Fallback/validation probes** | 22 HTTP probes, live server | **22/22 intended status, no empty bodies** — F-03, F-04 |
| Fallback regression | new `rule-engine.test.ts`, 10 cases | suite 177 → **187** |
| **No-fabrication probes** | 14 HTTP probes, live server | **14/14 intended status** — F-05 |
| Placeholder-wording scan | all probe responses + all of `src` | `population of interest` / `the intervention` **0 hits in output** |
| Unknown-specialty flow | `clarify` with `specialty: null` | asks PICO free-text instead of skipping |

### Confirmed-correct behaviours (no action)

- **Evidence chain is a true single source of truth** in `src/app/api/engine/route.ts`:
  `filterByClaim` (L571) → `buildEvidenceSet` (L574) → `finalizeClaims` (L726) →
  `reconcileNarrative` (L754) → `resolveReference` (L780, L801) → `curateReferences` (L789) →
  `validateDeliverableIntegrity` (L814). No parallel path can inject a reference.
- **No-evidence path is correct**: `POST /api/engine {stage:"commentary"}` with no PICO returns
  HTTP 200 with `title = "No literature related to your search found"`, empty `discussion`,
  and no invented references. Exact required constants confirmed:
  `NO_LITERATURE_MESSAGE` and `NO_LITERATURE_HINT` match the specification verbatim.
- **Deterministic fallback works** for `intent` / `clarify` / `formulate`; the flagship PICO
  resolves correctly (`specialty: obstetrics`, `condition: short cervix`,
  `intervention: progesterone cerclage`, Population = "pregnant women with a short cervix").
- **PubMed input hardening is solid**: `toPhrase()` strips operators and field tags, quotes
  multi-word phrases, caps at 120 chars, and `encodeURIComponent` is applied. Probe
  `{"population":"  \"(( OR )  "}` was correctly sanitized to empty and refused. Throttling
  (400 ms floor), exponential backoff on 429/503 with `retry-after` support, and title-less
  record filtering are all present.
- **No information leakage**: no stack traces, no env values, and no internal identifiers
  appeared in any error body probed.
- Dash separators (hyphen, en dash U+2013, em dash U+2014) parse identically to commas;
  diacritics preserved; parsing is deterministic on repeat.
- No dead exports were introduced by the recent refactors; the earlier removal of
  `reconcileCitationsAndReferences` was correct (reconciliation lives in `reconcileNarrative`).

---

## 3. Findings

### F-22 — RESOLVED — Next.js upgraded 16.3.2 → 16.3.8; production dependencies now clean

**Original:** `next@16.3.2` fell in the affected range `16.0.0 - 16.3.5` and carried three critical
advisories — GHSA-p293-qw3h-jr36 (unauthenticated RCE on **Windows-hosted servers**),
GHSA-2xp9-vwfh-vxw4 (RCE in the Image Optimization API with AVIF), and GHSA-vcvr-r3jv-pc5j
(RCE in `next/og` `ImageResponse`) — plus `sharp <0.35.4` (high, libheif).

**Fix applied:** `next` and `eslint-config-next` both pinned to `16.3.8` (the latest stable in the
16.3 line; 16.4.x exists only as canary). `sharp` resolved to `0.35.5`.

**Verification after upgrade:**

| Check | Result |
|---|---|
| `npm audit --omit=dev` | **0 vulnerabilities** (was 2: 1 critical, 1 high) |
| `npm test` | **169 pass, 0 fail** |
| `npx tsc --noEmit` | exit 0, clean |
| `npm run lint` | exit 0, clean |
| `npm run build` | exit 0, same 8 routes (5 static, 3 dynamic) |
| Local runtime smoke (`next start`, Next.js 16.3.8) | all 4 pages 200; 405 on all 3 API routes; deterministic stages OK |

Every audit finding was re-probed against the upgraded runtime and **reproduced identically**,
confirming F-02 through F-15 are pre-existing logic defects and not artifacts of the old
framework version. No behavioural regression from the upgrade.

**Accepted residual (dev-only):** 5 high advisories remain in the lint toolchain via
`eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces@3.0.3`
(GHSA-vfj7-8cjw-p6xm, stack exhaustion via deeply nested glob patterns, CVSS 7.5).
`brace-expansion` and `js-yaml` were auto-fixed to patched versions (1.1.21, 4.3.2).
`braces` **cannot be remediated**: the advisory range is `<=3.0.3` and 3.0.3 is the latest
published release, so no patched version exists. The only fix npm offers is downgrading
`eslint-config-next` to `14.2.35`, which would break the Next 16 lint configuration and was
**deliberately not applied**. These packages are `devDependencies`, are not shipped, are not
reachable from user input (glob patterns come from static lint config, not request data), and
cannot affect the production runtime. **Accepted as documented residual risk.**

Note: the app does not use the Image Optimization API or `next/og`, which limits practical
exposure to two of the three original advisories, but the package upgrade was still mandatory.

### F-01 — RESOLVED (was HIGH) — Windows installer shipped a stale, unhardened codebase (parity violation)

The PC application was **not** the same product as GitHub or Vercel.

`installer/app-source.zip` (19 entries, 100,577 bytes) contained a pre-deterministic build:

| Artifact | Was bundled | Was current |
|---|---|---|
| `src/app/api/engine/route.ts` | **264 lines** | **1,039 lines** |
| `src/app/paper/page.tsx` | **244 lines** | **744 lines** |

The bundled engine route imported **only** `@/lib/kb` and `@/lib/rule-engine`. It had **no**
`buildEvidenceSet`, **no** `finalizeClaims`, **no** `reconcileNarrative`, **no**
`validateDeliverableIntegrity`. Its paper page had no `copyReferences` and no integrity gate.

Missing from the bundle entirely: `src/app/api/pdf/route.ts` (the server PDF route), all six
evidence-integrity modules (`clinical-input`, `clinical-keywords`, `relevance`, `evidence-set`,
`claim-finalization`, `deliverable-integrity`), and all 13 `*.test.ts` files.

**Impact:** every desktop install ran an app with no claim filtering and no
deliverable-integrity gate. Desktop users received output that the web app would refuse.
This directly violated the "PC = GitHub = production" requirement.

#### Resolution

Added `installer/build-app-source.ps1` and rebuilt the archive (42 entries, 194,879 bytes).

| Artifact | Bundled now | Current |
|---|---|---|
| `src/app/api/engine/route.ts` | **1,039 lines** | **1,039 lines** |
| `src/app/paper/page.tsx` | **744 lines** | **744 lines** |

All six evidence modules, the `/api/pdf` route and all 13 test files are now present, written
flat at the archive root (the layout `install-app.ps1` already handles).

Verified by extracting the archive into a clean directory and running exactly what a desktop
install runs:

| Check | Result |
|---|---|
| `npm install --no-audit --no-fund` | 362 packages, exit 0 |
| `node -e` version probe inside bundle | `next` **16.3.8**, `sharp` **0.35.5** |
| `npm run build` | compiled + typechecked, all **8 routes**, exit 0 |
| `npm test` inside the bundle | **169 pass, 0 fail** |
| leak scan (`.env*`, `node_modules`, `.next`, `*.pem`, `*.key`) | none |

`next` 16.3.8 inside the bundle is the point of this step: because `install-app.ps1` runs
`npm install` against the bundled lockfile, every desktop install now receives the patched
Next.js rather than shipping 16.3.2 indefinitely.

Recurrence is now guarded rather than merely fixed:

- `build-app-source.ps1` verifies every bundled file against the tree by **SHA-256** on every
  run. A name-only comparison would have been useless here, since the stale bundle carried
  identical paths with older contents.
- `build-app-source.ps1 -Check` performs that comparison without rewriting the archive and
  exits 1 on drift; it is wired into `installer/test-installer.ps1` as step [1b].
- The generator refuses to write an archive that is missing any module the API routes import,
  and scrubs `.env*`, `*.pem`, `*.key`, `node_modules` and `.next` even if they appear inside a
  copied directory.
- Confirmed by fault injection: modifying two source files and adding a third after the fact
  produced `STALE BUNDLE`, listing `only in tree` and `content differs` per file, exit 1.

Also fixed `installer/test-installer.ps1`, which hardcoded an absolute path to one developer's
machine and would have failed on any other host or in CI.

#### Line endings had to be pinned for the guard to be meaningful

The SHA-256 guard fired immediately on first run for a reason unrelated to staleness. The
repository had **no `.gitattributes`** while `core.autocrlf=true`, and the working tree was
mixed: **9 files CRLF, 46 LF**. Any contributor on Windows would therefore have produced a
different `app-source.zip` from the same commit than CI or a Linux contributor — the parity
guarantee would have been unenforceable across machines, which is the exact failure mode F-01
was about.

Added `.gitattributes` (`* text=auto eol=lf`, with `*.zip`/`*.exe`/`*.ico`/`*.jpg`/`*.png`/…
declared `binary` so bundles and images are never translated) and normalized the working tree to
LF. Verified this changed **no content**: `git diff --ignore-cr-at-eol` is empty,
`git diff --cached` for those paths is empty, and `git hash-object src/lib/kb.ts` still equals
the committed blob `a4d38451…`. Re-verified afterwards: 169/169 tests, `tsc` clean, lint clean,
build clean with 8 routes, and the rebuilt bundle again installs (362 packages), builds, and
passes 169/169 from a clean extraction.

**Residual:** the bundle is rebuilt by hand and committed as a binary, so it can still drift if
someone edits `src/` and forgets to re-run the generator. The `-Check` guard now makes that
failure loud at installer-test time, but CI enforcement on the repository is still the stronger
guarantee and is listed in the release order.

### F-02 — RESOLVED (was MEDIUM) — Export integrity gate threw on non-string references (500 instead of 422)

`validateDeliverableIntegrity` has no element type-guard and no internal `try/catch`.
`references.filter(r => !referenceIsBackedBy(r, retained))` (L143) and `referenceKey(ref)`
(L149) assume strings. Direct probes:

| Input | Result |
|---|---|
| `references: [{citation:"Smith 2020 fake"}]` | **throws** `ref.trim is not a function` |
| `references: [{citation:...}]` + valid `retainedRecords` | **throws** (even the *valid* case) |
| `references: ["Smith 2020 fake"]` (strings) | `ok:false` — correct refusal |
| `fields: null` | **throws** |
| `retainedRecords` absent | **throws** |
| `references: []` | `ok:true` — correct |

`/api/pdf` passes the untrusted request body straight in, so a direct caller triggers an
unhandled `TypeError` that escapes to the route's outer catch and returns a generic
**500 "PDF generation failed. Please retry."** instead of the designed
**422 "Export refused: references did not match the validated evidence set."** with the
`integrity` detail. Verified live: posting an object-shaped reference returns 500.

**Impact:** the refusal still happens (no PDF is emitted) but for the wrong reason, so integrity
violations are indistinguishable from transient failures in monitoring, and the user is told to
retry a request that will never succeed. The legitimate client is unaffected because
`paper/page.tsx` sends `references: string[]` (L22) — this is a trust-boundary defect.

#### Resolution

The throw originated in `referenceKey`, which reached `foldName(ref)` with the **raw** array
element rather than a string; the duplicate-detection loop reaches it before any element guard
runs.

- `referenceKey` now coerces with `String(ref)` first, so no non-string can reach `foldName`.
- `validateDeliverableIntegrity` normalizes its whole input before doing any work: `fields`
  keeps only string values, `references`/`exportReferences` keep only strings, and
  `retainedRecords` keeps only objects. Anything rejected is reported in a new
  `malformedReferences: string[]` result field naming the exact path and received type, e.g.
  `references[1] must be a string, received object`.
- `ok` now requires `malformedReferences.length === 0`, so a malformed list is refused rather
  than silently accepted on the strength of its valid neighbours.
- The gate accepts a wholly absent `input` object instead of throwing.

The route distinguishes the two refusal reasons, so a caller learns which mistake it made:

```
POST /api/pdf  {"title":"T","references":[{"citation":"Smith 2020 fake"}]}
  -> 400 {"error":"Field \"references\" must contain only strings."}
```

Note the shape check in the route now runs before the gate, so the common case is a precise 400
and the 422 remains reserved for well-formed references that no retained record supports.

8 new tests cover the hostile-input contract, including the two cases the audit found most
alarming (object-shaped references *with* valid records present, and `fields: null`).
Suite: 169 → **177**.

### F-03 — RESOLVED (was MEDIUM) — Unprotected nested fallback produced a bare HTTP 500 with an empty body

The stage `catch` fell back to `ruleAnalyze` / `ruleClarify` / `ruleFormulate` without guarding
them. `ruleClarify` called `analysis.missing.find(...)` directly, and `missing` is absent for any
analysis that did not come from the `intent` stage. `{}`, `[]` and `"x"` are all **truthy**, so they
reached that line and threw a second time, escaping the `catch` entirely. `null` was falsy and so
never reached it — the discrepancy was pure JS truthiness, not intent.

Live results before the fix:

| Payload | Status | Body |
|---|---|---|
| `{"stage":"clarify","analysis":{}}` | **500** | **empty (0 bytes)** |
| `{"stage":"clarify","analysis":[]}` | **500** | empty |
| `{"stage":"clarify","analysis":"x"}` | **500** | empty |
| `{"stage":"clarify","analysis":{"specialty":"nope"}}` | **500** | empty |
| `{"stage":"clarify","analysis":null}` | 503 | proper message |

#### Resolution — fixed at both layers

Defence in depth, because either layer alone would be incomplete: guarding only the `catch` still
leaves a fallback that returns a wrong answer instead of failing loudly, and hardening only the
fallback still leaves a second unhandled failure path in the route.

1. **The fallbacks can no longer throw.** `ruleClarify` and `ruleFormulate` now normalize their
   inputs (`analysis || {}`, `answered || {}`, `Array.isArray(a.missing)`) instead of trusting the
   caller's shape. An unknown specialty resolves to `spec = null` and returns a clean
   `done: true`, which is the correct answer when nothing can be asked.
2. **Each fallback is guarded independently** in the route's `catch`, so a second failure logs
   `[engine] rule fallback for "<stage>" also failed:` and degrades to the same structured 503
   rather than escaping.

`rule-engine.ts` was additionally untestable — it was the only module in `src/lib` importing
`"./kb"` without an extension, which Node's ESM loader cannot resolve. That is almost certainly why
it never had a test file. Corrected to `"./kb.ts"`, matching every other module.

#### Verification

22/22 live HTTP probes, all bodies non-empty. Every row of the table above now returns 400 (with a
named reason) or 200, and **no payload produces a 500 or an empty body**. New
`src/lib/rule-engine.test.ts` (10 cases) locks in the behaviour; suite 177 → **187**.

### F-04 — RESOLVED (was MEDIUM) — Missing required fields returned 503 "AI service unavailable"

`{"stage":"clarify"}` and `{"stage":"formulate"}` (no `analysis`) both returned
**503 `The AI service is temporarily unavailable.`** because the fallback guard required a truthy
`body.analysis`. Client-side validation errors were being filed as provider outages, corrupting
availability metrics and sending users after the wrong remediation path.

#### Resolution

Added `readAnalysisStage`, applied to the `clarify` and `formulate` branches before any provider
call, rejecting with 400 and a specific message:

| Condition | Response |
|---|---|
| `analysis` absent or `null` | 400 `Stage "<stage>" requires an "analysis" object.` |
| `analysis` is an array/string/number | 400 `Field "analysis" must be an object, received <type>.` |
| `analysis.missing` present but not an array | 400 `Field "analysis.missing" must be an array of strings.` |
| `answered` present but not an object | 400 `Field "answered" must be an object.` |
| `analysis` structurally valid but clinically empty | 400 `Stage "<stage>" requires an analysis containing clinical content; run the "intent" stage first.` |

The last row closes the route-side half of F-05: an analysis with no specialty, no free-text
fields and an empty `missing` list cannot produce a meaningful question, so it is rejected rather
than answered. `answered: null` is still accepted as `{}`, matching the deliberate step-3 decision
that absent and empty inputs are equivalent.

#### Verification

All 6 payloads in the audit table confirmed over HTTP. 22/22 probes pass. Suite 177 → **187**.

### F-05 — RESOLVED (was MEDIUM) — Empty analysis silently yielded a meaningless clinical question

`{"stage":"formulate","analysis":{}}` returned **HTTP 200** with
`elements: [{label:"P → Population", value:"Women with the population of interest"}]`, and
`ruleFormulate({}, {})` fabricated a placeholder PICO. **Impact:** a content-free question could be
presented as a formulated clinical question. For a clinical decision-support tool this is a
quality/safety concern, not just a UX one.

#### Root cause was upstream of `ruleFormulate`

The placeholder text was a symptom. The reachable path was in `ruleClarify`, which returned
`done: true` whenever the specialty spec was missing:

```ts
if (!nextField || !spec) return { done: true, ... };
```

So for any clinical area outside the knowledge base, clarification was skipped entirely and the flow
went straight to `ruleFormulate` with nothing collected. The PICO prompts never need a spec — only
the *suggested options* do — so bailing out here guaranteed the flow would eventually fabricate.
This is why a route-only 400 would not have fixed it: `src/app/question/page.tsx` treated any
`formulate` response containing an `error` as a reason to **recompute `ruleFormulate` locally in the
browser**, reproducing exactly the placeholder the server had just refused.

#### Resolution

1. **`ruleClarify` keeps asking when the specialty is unknown.** It now exits only when there is
   genuinely nothing left to ask (`!nextField`). Suggested options are `[]` without a spec, and the
   existing clarify UI renders an empty chip row with the free-text answer still available.
2. **`ruleFormulate` refuses to fabricate.** `Formulation` gained `complete: boolean` and
   `missingElements: string[]`. Without a population **and** an intervention it returns
   `finalQuestion: ""`, no `variants` and no `elements`, naming what the caller still owes.
   Population and intervention are the two whose placeholders turned a question into a fabricated
   clinical claim; comparator and outcome keep neutral defaults ("no treatment", "a clinically
   meaningful outcome"), which are defensible PICO positions rather than inventions.
3. **The route returns 400** via a new `formulated()` guard, with `missing`, `field` and
   `questionText` so the caller can resume clarification rather than guess.
4. **The client honours the refusal.** A 400 naming a field resumes clarification for that element
   instead of silently recomputing locally, and the same applies if the local fallback refuses.

An invalid-but-truthy specialty such as `"nope"` was also dereferenced as `KB["nope"].outcomeRules`
inside `rationalOutcomes`, throwing for any analysis that reached formulation. Both functions now
resolve the specialty against the KB once into a `SpecialtyKey | null`, so an unknown value collapses
to `null` and takes the generic path. Caught by the new tests, not by inspection.

#### Verification

14/14 live HTTP probes, all intended status. Both refusal cases now name the missing element:

```
{"stage":"formulate","analysis":{"condition":"PCOS"}}
400 {"error":"Cannot formulate a clinical question without intervention.",
     "missing":["intervention"],"field":"intervention", ...}
```

Clarification now proceeds for unknown specialties instead of skipping. A scan of every probe
response and of the whole `src` tree confirms the strings `population of interest` and
`the intervention` no longer appear in any generated output — only in comments and in the test that
asserts their absence. Suite 187 → **188**.

### F-06 — MEDIUM — No per-token keyword length cap

Input `"z"×4000 + ", short cervix, progesterone, preterm birth"` yields
`normalizedTokens` lengths `[4000, 12, 12, 13]` with **validation error `null`** — a
4000-character token passes the 4–6 gate. There is no `.length` cap or `slice()` anywhere in
the parser (only fuzzy-match budgets at L232/235/261).
**Impact:** query bloat, provider throttling, malformed PICO elements, wasted LLM tokens, and
a trivial resource-amplification vector since the value is forwarded to literature APIs.
**Fix:** cap per-token length (~60–80 chars) and reject with the existing message style.

### F-07 — MEDIUM-HIGH — Greedy word-window tokenization splits canonical phrases

`"progesterone cerclage preterm birth short cervix"` →
`["progesterone cerclage preterm birth short", "cervix"]`, **no validation error**.

Both `"preterm birth"` and `"short cervix"` are known `CLINICAL_PHRASES`, but a 5-word window
(L357 `words.slice(i, i+len)`, L394 `run.length >= 5 break`) wins over the two real phrases,
orphining `cervix` and splitting the canonical phrase `short cervix` — the flagship PICO element.
Relatedly, `"a b c d e f g h i"` → `["b c d e f","g h i"]`, reported to the user as
*"contains 2 logical keywords — 4 required minimum"* for an entry they believe has nine.
**Impact:** silently corrupted keywords degrade PICO element matching and therefore evidence
recall — the core value proposition. Comma/dash input is unaffected and the UI does steer users
to commas, which caps severity at Medium-High rather than High.
**Fix:** score known multi-word phrases above generic window filling.

### F-08 — MEDIUM — Alias correction only matches whole tokens

`ALIASES` holds exact keys `"vit d"` (L97) and `"co enzyme q 10"` (L101).

| Input | Suggestion offered |
|---|---|
| `"vit d"` | `vit d → vitamin D` ✅ |
| `"vit d deficiency"` | **none** ❌ |
| `"co enzyme q 10"` | `co enzyme q 10 → coenzyme Q10` ✅ |
| `"co enzyme q 10 supplementation"` | **none** ❌ |

The documented promise (module header L14, L318) holds only for bare tokens. Common real-world
phrasing silently receives no correction.
**Fix:** match alias keys as sub-phrases during the phrase scan.

### F-09 — LOW — Inconsistent canonicalization of `CoQ10`

`CLINICAL_PHRASES` lists `"CoQ10"` (L82) and `ALIASES` maps `"coq10" → coenzyme Q10` (L105).
Probe `"CoQ10"` → `normalizedTokens ["CoQ10"]`, **no suggestion**, while bare `"q10"` →
`q10 → coenzyme Q10`. Two spellings of one vitamin resolve differently, splitting evidence sets
and PICO matching for no clinical reason.

### F-10 — RESOLVED (was LOW) — `/api/pubmed` returned every error as HTTP 200

All three error paths (invalid JSON, no search term, search failed) returned
`NextResponse.json({ results: [], error: ... })` with the default **200**. Verified: 3/3 error
probes returned 200. **Impact:** monitoring sees 100% success; clients must inspect the body.
The client does handle it, so this is a contract/observability defect, not a user-visible break.

**Fix applied:** 400 for invalid JSON and for a request with no usable search term, and **502**
for an upstream failure — the request was well formed, NCBI was not reachable. 502 specifically
matters here: reporting that as 200 told callers the search succeeded and returned zero results,
which reads as "no evidence exists" rather than "the search could not run". In an
evidence-synthesis tool that is a serious distinction to lose.

```
POST /api/pubmed  {oops   -> 400 {"results":[],"error":"Invalid JSON body"}
POST /api/pubmed  {}      -> 400 {"results":[],"error":"Provide at least one search term."}
```

The 200 responses for genuine successes and for a legitimate zero-hit search are unchanged, so
`question/page.tsx` (which reads `.results` without inspecting status) is unaffected.

### F-11 — RESOLVED (was LOW) — Configuration failure returned HTTP 200

`src/app/api/engine/route.ts`: when `GEMINI_API_KEY` is unset, the commentary stage returned
`NextResponse.json({ error: "AI engine required..." })` with **status 200**. **Impact:**
mitigated — `paper/page.tsx` checks `data.title && !data.error` — but the status was semantically
wrong and would break any other consumer or uptime check.

**Fix applied:** **503**. Verified against a server started with `.env.local` removed, so the
branch was genuinely exercised rather than short-circuited by a configured key:

```
POST /api/engine  {"stage":"commentary","topic":"short cervix"}
  -> 503 {"error":"AI engine required for commentary generation."}
POST /api/engine  {"stage":"intent","input":"ohss pcos ivf"}
  -> 200 (deterministic rule fallback still serves the stages that have one)
```

This is the exact response every desktop install receives for this stage, because no launcher
supplies a key (F-23). The distinction is now visible to a health check rather than hidden in a
200.

### F-12 — RESOLVED (was LOW) — `/api/pdf` mapped invalid JSON to HTTP 500

The route read `req.text()` then called `JSON.parse(raw)` with no `try/catch`, so malformed JSON
threw to the outer catch → **500 "PDF generation failed. Please retry."** A client error was
reported as a server error. Verified live.

**Fix applied:** `JSON.parse` is wrapped and returns **400 "Invalid JSON body."** A non-object
top level (array, `null`, number) is also rejected as **400 "Request body must be a JSON
object."** — the old code would have accepted `[]` and produced a titled PDF.

### F-13 — RESOLVED (was LOW) — Inconsistent empty-reference handling in `/api/pdf`

`{"title":"T","references":[]}` returned 400 correctly, but `{"title":"T"}` with the key
**absent** bypassed the guard and produced a titled PDF with no content. The old comment treated
an absent key as "evidence-map style export", conflating *no references* with *no sections*.

**Fix applied:** the decision now rests on whether there is anything to render, not on how the
caller spelled the field — refuse when there are neither references nor sections. Exports that
legitimately carry no references, such as the evidence map, have sections and still succeed.

```
POST /api/pdf  {"title":"T","references":[]}                                -> 400
POST /api/pdf  {"title":"T"}                                                 -> 400
POST /api/pdf  {"title":"T","sections":[{"heading":"H","blocks":["..."]}]}  -> 200 (PDF)
```

### F-14 — RESOLVED (was LOW) — No type validation on `input`

`{"stage":"intent","input":123}` returned HTTP 200 with `intervention: "123"`. `String(body.input)`
coerced a number into a clinical term. An object input was silently coerced too.

**Fix applied:** a `readFreeText` helper rejects a present-but-non-string `input` with **400
`Field "input" must be a string.`** for both the `intent` and `gap` stages, and the catch-path
fallback no longer coerces. Verified: `input:123` and `input:{"a":1}` both return 400, while
`input:""` still returns 200 — an empty question is a legitimate state the UI depends on.
Collection fields on `/api/pdf` (`references`, `retainedReferences`, `sections`, `keywords`,
`outcomes`, `pico`) are likewise type-checked before reaching the gate or the renderer, since
coercing a caller-supplied object into a reference string would produce a document whose
provenance cannot be verified.

### F-15 — LOW — Raw markup and fabricated citations accepted as keywords

- `"<script>alert(1)</script> short cervix progesterone cerclage preterm birth"` → a 60-char
  token literally containing the script tag is retained.
- `"...preterm birth (Smith, 2020) (Doe et al., 2019)"` → accepted, error `null`, author names
  lowercased to `smith`/`doe`.

Not XSS (React escapes rendered text) and **no fabricated citation can reach output** — output
references are built from provider records via `resolveReference`. But arbitrary markup and
user-invented citations flow into literature queries and the session store. Recommend stripping
markup and detecting `(Author, year)` patterns at intake.

### F-16 — LOW-MEDIUM — Tracked binaries bloat the public repository

| File | Size |
|---|---|
| `installer/output/AIPICO-Setup.exe` | 2,437,189 (2.4 MB) |
| `installer/icon.ico` | 285,478 |
| `installer/app-source.zip` | 194,879 (was 100,577; rebuilt per F-01) |
| `launcher/AIPICO.exe` | 33,792 |
| `launcher/AIPICO-Launcher-GUI.ps1` | 145,489 |

Repo total: 3,706,915 bytes / 60 tracked files. (Correction to an earlier note: the EXE is
2.4 MB, not ~18 MB.) Binaries cannot be patched or reviewed in place and force full
re-download on every change. Prefer GitHub Releases with checksums.

### F-17 — LOW — Personal photograph tracked publicly

`public/dr-raouf.jpg` (10,650 bytes) is committed, rendered in the app header, and bundled into
the installer. A deliberate branding choice, but it should be an explicit, documented decision
for a public repository.

### F-18 — INFO — Near-empty stub files

`CLAUDE.md` is 11 bytes; `AGENTS.md` is 678 bytes. Harmless but misleading.

### F-19 — RESOLVED (was OPERATIONAL) — No commentary fallback when AI writing service is unavailable

Every LLM-dependent production call returned 503 during the initial audit window, and the route
returned a hard 503 whenever `GEMINI_API_KEY` was missing (which is the default on any desktop or
self-hosted install). Although a deterministic generator existed at `/api/engine`, it was
unreachable in exactly the situation it was written for.

Furthermore, that generator was worse than useless in a clinical tool: it asserted findings it
never read, cited only the first of its eight references, and published the same cervix/progesterone
keywords for every clinical topic.

#### Resolution

The hard 503 check has been removed. When the provider key is missing or the provider fails:
1. The system calls `generateDeterministicCommentary` (now extracted to a testable module in `src/lib/deterministic-commentary.ts`).
2. The generator writes an honest, claims-free description of the search and cites every record it lists.
3. The response includes `source: "deterministic"`, `synthesisGenerated: false`, and an explicit reader notice.
4. The paper page displays a warning banner informing the user that this is an evidence list, not an AI synthesis.
5. All 11 unit-test assertions pass, confirming citation consistency, keyword phrase-matching, and that no findings are fabricated.

#### Verification
Probes with `GEMINI_API_KEY` hidden now return a clean HTTP 200 with `source="deterministic"`, 3/3 cited references, and no claim warnings from `finalizeClaims`. All 204 tests pass.

### F-24 — RESOLVED (was HIGH) — `splitSentences` cut citations at `et al.` and author initials

Found and fixed during the F-19 implementation. Because `finalizeClaims` judges one sentence at a
time, any split inside a citation (e.g. at the period in `et al.` or in an initial like `J. Romero`)
makes the citation invisible to the parser. That made correctly-cited prose look uncited and
replaced it with the uncertainty boilerplate: on a real AI commentary it produced 17 stripped
claims, the same 33-word sentence repeated 7 times in one paragraph, and stray `2026).`
fragments published in the reader-facing text.

#### Resolution
`splitSentences` has been rewritten to mask known abbreviations and single-letter initials before splitting and restore them afterwards.
Consecutive identical limitation sentences are also de-duplicated inside `finalizeClaims` so multiple unsupported claims do not result in repeated boilerplate.

#### Verification
AI commentary probes now cite 3/3 references, and stripped claims dropped 17 → 4 (only genuinely unsupported sentences are removed). The duplicated boilerplate and year fragments are gone. Tested by 5 new unit-test cases in `src/lib/claim-finalization.test.ts` — all pass.

### F-20 — OPERATIONAL — Deployed commit lags the repository HEAD by one README commit

Runtime `aipico-82dxzvfhz-...` was built from `f5c7542`; repository HEAD is `48701ab`
(README only, no runtime change). Functionally identical, but if exact commit provenance is a
release requirement, redeploy from `48701ab`.

### F-21 — SECURITY — Two GitHub PATs exposed in prior chat; must be revoked

Both must be treated as compromised and revoked. **No repository compromise occurred**: the
exposed values were never committed and never appear in the working tree, reflog, or any of the
1.18 MB of history. No history rewrite is required.

### F-23 — HIGH — No path for a desktop install to obtain an AI provider key

Found while rebuilding the bundle for F-01. Not previously reported.

`GEMINI_API_KEY` is read by `/api/engine` (F-11), and Vercel supplies it as a project
environment variable. A desktop install has no equivalent. Searching every launcher and
installer script for `GEMINI`, `API_KEY`, `apiKey` or `.env` returns exactly one hit, and it is
unrelated (`AIPICO-Launcher.ps1:92`, reading the machine `Path`):

| Script | Provider key handling |
|---|---|
| `installer/install-app.ps1` | none — extracts, `npm install`, `npm run build` |
| `launcher/AIPICO-Launcher.ps1` | none |
| `launcher/AIPICO-Launcher-GUI.ps1` | none |
| `launcher/launch-aipico.ps1` | none |

`app-source.zip` also cannot carry the key, and must not: the generator scrubs `.env*`, and a
key baked into a redistributable archive would be a worse outcome than the current one.

**Impact:** with the bundle now current, every desktop install reaches `commentary`, finds no
key, and takes the `!KEY` branch — `NextResponse.json({ error: "AI engine required for commentary
generation." })` at **HTTP 200**. The paper page then refuses to render because
`data.title && !data.error` fails. In practice the shipped desktop product cannot generate
commentary at all, and the failure is silent at the HTTP layer. This compounds F-19: the web
build is blocked by a 503-ing provider, and the desktop build is blocked unconditionally.

**Fix required before release.** Options, in order of preference:

1. Prompt for a key on first run, store it in Windows Credential Manager, and inject it as a
   process environment variable for the server. Keeps the key off disk in plaintext and out of
   the archive.
2. Per-user `localStorage` key entry in the UI, forwarded per request. Simplest, but a key in
   browser storage is readable by any script the page loads.
3. A thin server-side proxy that holds the key and meters per install. Most robust, most work.

Whichever is chosen, the desktop path also needs the deterministic commentary fallback from F-19
so that a missing or failing provider degrades to rule-based output instead of an error.

`launcher/README-DESKTOP.md` is stale on the same theme: it states the launcher "Downloads the
application from GitHub", which is no longer how distribution works — Inno Setup now bundles
`app-source.zip` locally — and it documents no key-provisioning step at all.

---

## 4. Corrected release order

**Progress: 3 of 10 complete.**

1. ~~**Upgrade Next.js and sharp.**~~ **DONE.** `next`/`eslint-config-next` → 16.3.8,
   `sharp` → 0.35.5. `npm audit --omit=dev` = 0 vulnerabilities. Suite re-verified green;
   all findings re-confirmed on the new runtime. Residual dev-only `braces` documented. (F-22)
2. ~~**Regenerate the desktop installer source package.**~~ **DONE.** (F-01 — was HIGH)
   `installer/app-source.zip` rebuilt from the current tree: 42 entries, all verified identical
   to the repository by SHA-256. Bundled app installs, builds all 8 routes and passes 169/169
   tests, and resolves `next` 16.3.8 / `sharp` 0.35.5. Added
   `installer/build-app-source.ps1` (generator + `-Check` staleness guard, wired into
   `installer/test-installer.ps1` as step [1b]) so it cannot silently go stale again.
   Newly surfaced **F-23** in the process: no desktop install has any way to obtain an AI
   provider key, which must be fixed in step 6.
3. ~~**Fix API validation and error-status behavior.**~~ **DONE.**
   (F-02, F-10, F-11, F-12, F-13, F-14) The export gate now refuses malformed input with a named
   reason instead of throwing into a 500; `/api/pubmed` returns 400/502 rather than 200 on
   failure; the missing-provider-key path returns 503; invalid or non-object JSON is 400; absent
   and empty reference lists are treated alike; and non-string `input` is rejected rather than
   coerced into a fake clinical term. Verified 19/19 over HTTP against a running server, with the
   provider-key case exercised on a server started without `.env.local`. Suite 169 → 177.
4. ~~**Fix nested fallback crashes.**~~ **DONE.** (F-03, F-04) The rule-based fallbacks now
   normalize their inputs and cannot throw, each fallback inside the `catch` is guarded
   independently so a second failure degrades to a structured 503 instead of escaping as a bare
   500 with an empty body, and `readAnalysisStage` rejects a missing/malformed/empty `analysis` or
   a non-object `answered` with 400 and a named reason instead of misreporting it as a provider
   outage. `rule-engine.ts` was also made importable by Node (`"./kb"` → `"./kb.ts"`), the only
   module in `src/lib` using an extensionless relative import, which is why it had no test file.
   Verified 22/22 over HTTP with no empty bodies; new `rule-engine.test.ts`. Suite 177 → 187.
5. ~~**Reject meaningless or empty PICO analysis.**~~ **DONE.** (F-05) `ruleClarify` was skipping
   clarification entirely whenever the specialty spec was missing, which guaranteed `ruleFormulate`
   would fabricate a placeholder PICO. It now keeps asking with free-text prompts;
   `ruleFormulate` refuses to state a question without a population and an intervention and names
   what is missing; the route returns 400 with `missing`/`field`/`questionText`; and the client
   resumes clarification rather than recomputing the rejected placeholder in the browser. Both
   functions now also resolve the specialty against the KB once, so an unknown truthy value no
   longer throws inside `rationalOutcomes`. Verified 14/14 over HTTP plus a tree-wide scan proving
   the placeholder wording no longer reaches any output. Suite 187 → 188.
6. **Restore the AI provider or add a deterministic commentary fallback.** (F-19) `commentary`
   is the evidence-critical stage and currently has no fallback; it was returning 503 for every
   request during the audit.
7. **Fix phrase-first tokenization and keyword-length limits.** (F-07, F-06) Prefer known
   multi-word phrases over generic word windows so canonical phrases like `short cervix` are not
   split, and cap per-token length.
8. **Fix phrase-level alias correction and CoQ10 normalization.** (F-08, F-09) Match alias keys
   as sub-phrases, and canonicalize `CoQ10` consistently with `q10`.
9. **Revoke the exposed PATs.** (F-21) Both must be treated as compromised. No repository
   compromise occurred and no history rewrite is required.
10. **Rerun the full test matrix:** live commentary, reference filtering, export parity, mobile,
    accessibility, and concurrency — then redeploy from the exact tested commit. (F-20)

## 5. Release recommendation

**Bottom line: the core evidence architecture is promising, but the system is not
production-ready until the provider failure, API robustness problems, and desktop key
provisioning are resolved.**

- **Windows installer:** do not distribute. The security and parity blockers are cleared (steps 1
  and 2), and the bundle now provably matches the repository — but F-23 means every install
  fails at the commentary stage for want of a provider key. Blocked by step 6.
- **Web / Vercel:** the hosted deployment is not directly exposed to the Windows RCE advisory, and
  the deterministic evidence chain is correctly built, correctly wired, and covered by 188
  passing tests. It is still not cleared: step 1 is mandatory regardless of host, and step 6 is a
  real functional defect on the commentary path that every user hits.
- **Not recommended at any point:** treating this system as clinically validated. It is an
  evidence-retrieval and drafting aid with strict citation discipline, not a clinical decision
  tool — and F-05 showed it could emit content-free questions until step 5, which is a reminder
  that the remaining unverified paths deserve the same scrutiny.

## 6. Explicitly not verified

Per the acceptance rule, these remain unchecked and block any "fully verified" claim:

- Live commentary generation and claim-filtered evidence E2E (blocked by F-19).
- PDF/Word/clipboard export parity against a real retained evidence set end-to-end (the gate was
  verified by direct function probe and by HTTP probe, not by a full export with live evidence).
- Cross-browser and mobile visual/interaction testing.
- Keyboard-only and screen-reader accessibility traversal.
- Load/concurrency behaviour under multiple simultaneous requests.

---

*Report generated by direct source inspection and executable probes. No secrets, environment
values, or patient data are included. Probe scripts were executed outside the repository or
removed immediately; `git status` was verified clean after each run.*
