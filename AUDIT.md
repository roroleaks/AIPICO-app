# AIPICO Clinical Question Assistant — Full Audit Report

**Audit date:** 2026-10-04
**Commit audited:** `48701ab60f5f281fe6abee0a1b4430209dc1df68` (local = remote, tree clean)
**Runtime audited:** `https://aipico.vercel.app` (deployment `aipico-82dxzvfhz-raouf12.vercel.app`)
**Method:** source reading, direct function probes, local execution, and live HTTP probes against production.

---

## 1. Status

**FAIL — not releasable in its current state.** (Steps 1–2 of 10 complete.)

The deterministic evidence core is genuinely well built and verified: the claim-filter →
evidence-set → finalization → reconciliation → export chain is fully wired from a single
retained set, all 169 tests pass, and typecheck/lint/build are clean. No secrets are exposed
anywhere in the tree or in the entire Git history, and error handling degrades gracefully
without leaking internals.

**20 open defects** remain, led by:

- **9 MEDIUM** functional defects, including an export gate that throws instead of refusing
  (F-02), bare HTTP 500s from an unguarded fallback (F-03), and a tokenizer that silently
  splits canonical clinical phrases and degrades evidence recall (F-07);
- the desktop build still has **no way to obtain an AI provider key** (F-23), so even with the
  bundle now current, every install produces commentary failures;
- two GitHub PATs that must be revoked before release (F-21).

**Resolved during this audit:**

- **F-22 (was CRITICAL)** — `next` upgraded 16.3.2 → 16.3.8 and `sharp` to 0.35.5.
  `npm audit --omit=dev` now reports **0 vulnerabilities** (was 1 critical + 1 high).
  Full suite re-verified green and every other finding re-confirmed on the new runtime.
- **F-01 (was HIGH)** — the desktop bundle was stale, shipping a 264-line engine route and
  none of the evidence-integrity modules. It has been rebuilt from the current tree: all 42
  files verified identical to the repository by SHA-256, the bundled app installs, builds and
  passes 169/169 tests, and it now resolves `next` 16.3.8. A repeatable generator plus an
  SHA-256 staleness guard (wired into `installer/test-installer.ps1`) prevents recurrence.
  PC now matches GitHub and Vercel at the artifact level.

Two audit criteria could **not** be completed because the production AI provider returned
HTTP 503 throughout the audit window:

- live commentary generation / claim-filtered evidence E2E could not be re-run;
- PDF export end-to-end could not be exercised with real retained evidence.

Per the acceptance rule (no "fully verified" claim while anything material is unchecked),
**full acceptance is not claimed.**

---

## 2. Verification matrix — what actually ran

| Check | Command | Result |
|---|---|---|
| Unit/integration tests | `npm test` | **169 pass, 0 fail** (1.62 s) |
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
| Live commentary E2E | production ×3 | **NOT RUN — provider 503 (F-19)** |
| **Desktop bundle parity** | `build-app-source.ps1` | **42/42 files identical by SHA-256** — F-01 fixed |
| **Desktop bundle install** | `npm install` in extracted zip | 362 packages, exit 0; `next` 16.3.8, `sharp` 0.35.5 |
| **Desktop bundle build** | `npm run build` in extracted zip | exit 0, all 8 routes |
| **Desktop bundle tests** | `npm test` in extracted zip | **169 pass, 0 fail** |
| **Staleness guard** | 2 files edited + 1 added, then `-Check` | correctly reported `STALE BUNDLE`, exit 1 |
| **Line-ending normalization** | `git diff --ignore-cr-at-eol`, `git hash-object` | **empty / blob unchanged** — no content altered |
| Desktop provider-key path | grep all launcher + installer scripts | **absent — F-23** |

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

### F-02 — MEDIUM — Export integrity gate throws on non-string references (500 instead of 422)

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
**Fix:** coerce/validate elements to strings and treat anything unresolvable as
`ok:false`; wrap the gate body in `try/catch` returning a structured failure.

### F-03 — MEDIUM — Unprotected nested fallback produces bare HTTP 500 with an empty body

`src/app/api/engine/route.ts` L1024-1037 catches stage failures and falls back to
`ruleAnalyze` / `ruleClarify` / `ruleFormulate`. The fallback is itself unguarded, so when it
throws a **second** time the exception escapes the `catch` entirely. Live results:

| Payload | Status | Body |
|---|---|---|
| `{"stage":"clarify","analysis":{}}` | **500** | **empty (0 bytes)** |
| `{"stage":"clarify","analysis":[]}` | **500** | empty |
| `{"stage":"clarify","analysis":"x"}` | **500** | empty |
| `{"stage":"clarify","analysis":{"specialty":"nope"}}` | **500** | empty |
| `{"stage":"clarify","analysis":null}` | 503 | proper message |

The `null` vs `{}` difference is pure JS truthiness — an inconsistency, not intent.
**Impact:** users get a blank 500 with no message and no guidance; alerting sees 500s with
no diagnostic body. No secret leakage, but the failure is undiagnosable from the client side.
**Fix:** wrap each fallback call in its own `try/catch` and return the 503 payload.

### F-04 — MEDIUM — Missing required fields return 503 "AI service unavailable" instead of 400

`{"stage":"clarify"}` and `{"stage":"formulate"}` (no `analysis`) both return
**503 `The AI service is temporarily unavailable.`** because the fallback guard at L1028/L1031
requires a truthy `body.analysis`. These are client-side validation errors.
**Impact:** malformed requests are misreported as provider outages, corrupting availability
metrics and sending users down the wrong remediation path.
**Fix:** validate required fields per stage and return 400 with a specific message.

### F-05 — MEDIUM — Empty analysis silently yields a meaningless clinical question

`{"stage":"formulate","analysis":{}}` returns **HTTP 200** with:
`elements: [{label:"P → Population", value:"Women with the population of interest"}]`.

`ruleFormulate({}, {})` does not fail; it fabricates a placeholder PICO.
**Impact:** a content-free question can be presented as a formulated clinical question.
For a clinical decision-support tool this is a quality/safety concern, not just a UX one.
**Fix:** return 400 when `analysis.condition` or `specialty` is absent.

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

### F-10 — LOW — `/api/pubmed` returns every error as HTTP 200

All three error paths (L78 invalid JSON, L100 no search term, L140 search failed) return
`NextResponse.json({ results: [], error: ... })` with the default **200**. Verified: 3/3 error
probes returned 200. **Impact:** monitoring sees 100% success; clients must inspect the body.
The client does handle it, so this is a contract/observability defect, not a user-visible break.

### F-11 — LOW — Configuration failure returns HTTP 200

`src/app/api/engine/route.ts` L523-525: when `GEMINI_API_KEY` is unset, the commentary stage
returns `NextResponse.json({ error: "AI engine required..." })` with **status 200**.
**Impact:** mitigated — `paper/page.tsx` checks `data.title && !data.error` — but the status is
semantically wrong and would break any other consumer or uptime check.

### F-12 — LOW — `/api/pdf` maps invalid JSON to HTTP 500

L29-33 reads `req.text()` then calls `JSON.parse(raw)` with no `try/catch`, so malformed JSON
throws to the outer catch → **500 "PDF generation failed. Please retry."** A client error is
reported as a server error. Verified live.

### F-13 — LOW — Inconsistent empty-reference handling in `/api/pdf`

`{"title":"T","references":[]}` → **400 "No references available to export."** (correct),
but `{"title":"T"}` with the key **absent** bypasses the L41 guard and produces a titled PDF
with no content. The code comment (L38-40) treats an absent key as "evidence-map style export",
which conflates *no references* with *no sections*.

### F-14 — LOW — No type validation on `input`

`{"stage":"intent","input":123}` → HTTP 200 with `intervention: "123"`. `String(body.input)`
coerces a number into a clinical term. An object input is silently coerced too.

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

### F-19 — OPERATIONAL — Production AI provider degraded during the audit; no commentary fallback

Every LLM-dependent production call returned
**503 `The AI service is temporarily unavailable. Please try again.`** throughout the audit
(confirmed across payload sizes 10 B – 20 KB, so it is not a size issue). The deterministic
rule-based fallback covers `intent`/`clarify`/`formulate` but **there is no fallback for
`commentary`**, which is the evidence-critical stage. This is the known free-LLM-fallback gap,
now confirmed to be a live availability risk rather than a theoretical one.

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

**Progress: 2 of 10 complete.**

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
3. **Fix API validation and error-status behavior.** (F-02, F-10, F-11, F-12, F-13, F-14)
   Make the export gate refuse with 422 instead of throwing into 500; stop returning HTTP 200
   for error conditions in `/api/pubmed` and for the missing-engine-config path; map invalid
   JSON to 400; make empty-reference handling consistent; validate payload field types.
4. **Fix nested fallback crashes.** (F-03, F-04) Guard the fallback inside the `catch` so a
   second throw cannot escape as a bare 500 with an empty body, and return 400 rather than 503
   for missing required fields.
5. **Reject meaningless or empty PICO analysis.** (F-05) Do not let `ruleFormulate` return 200
   with placeholder content such as "Women with the population of interest".
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
  the deterministic evidence chain is correctly built, correctly wired, and covered by 169
  passing tests. It is still not cleared: step 1 is mandatory regardless of host, and steps 3-5
  are real functional defects on the commentary and export paths.
- **Not recommended at any point:** treating this system as clinically validated. It is an
  evidence-retrieval and drafting aid with strict citation discipline, not a clinical decision
  tool — and F-05 shows it can still emit content-free questions.

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
