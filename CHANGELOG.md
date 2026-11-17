# Changelog

All notable changes to the AIPICO application are documented in this file.

## [3.2.0] — 2026-11-17

### Scientific Integrity (P0)
- **P0-1**: Excluded records are retained strictly in an excluded pool and not promoted into the direct evidence pool. Low-evidence state triggers when fewer than 3 direct records pass claim audit.
- **P0-2**: Retrieval accounting invariant enforced (`retrieved = retained + excluded`). Added deliverable integrity validation gate.
- **P0-3**: Explicit provenance labeling introduced ("AI-assisted" vs "Template (no AI)"). Fabricated certainty claims removed from deterministic templates.
- **P0-4**: Evidence-map candidate references filtered through relevance audit against scenario population and intervention; deduplicated across points by PMID and DOI.
- **P0-5**: Deterministic gap sections labeled "Search themes (template — not verified findings)"; templates calibrated to detected clinical specialty (infertility / obstetrics / gynecology).
- **P0-6**: Blanket citation ranges covering ≥75% of references on generic sentences removed; deliverable integrity gate validates against ungrounded ranges.
- **P0-7**: Study descriptions accurately report when the selected outcome is unobserved in title/abstract based on audit flags.

### Correctness (P1)
- **P1-1**: Markdown section and list structures preserved across claim finalization.
- **P1-2**: Study descriptions treated as cohesive units during uncertainty substitution to avoid orphaned fragments.
- **P1-3**: Commentary retry logic restructured with sequential fallback loop and single lock.
- **P1-4**: Outcome synonyms decoupled into distinct canonical endpoints; user's specified outcome preserved verbatim across Steps 1 to 4.
- **P1-5**: Outcome ontology expanded with IVF-specific endpoints; clinical condition and intervention applicability strictly evaluated.
- **P1-6**: Question variant verb phrases calibrated to outcome direction and specialty.
- **P1-7**: Inline capitalization normalized while preserving medical acronyms (IVF, ICSI, OHSS, PCOS, AMH, GnRH, CoQ10).
- **P1-8**: Reference formatting cleaned (double periods removed, numeric vs non-numeric ID prefixes distinguished, collective authors cited by group name, MeSH-style keywords derived).
- **P1-9**: Evidence map cached in session by input text to avoid redundant network roundtrips, with explicit refresh button.
- **P1-10**: Inferred comparators labeled "(assumed)" with inline editable control; add-on interventions default to standard protocol control.

### Reliability (P2)
- **P2-1**: Per-stage timeout budgets allocated within the 60-second serverless execution ceiling; structured telemetry logging added; `x-aipico-source` header attached.
- **P2-2**: Multi-provider failover implemented across Gemini, Groq, OpenRouter, and OpenAI.
- **P2-3**: Model identifier configurations updated with overridable environment variable support.
- **P2-4**: Sliding-window rate limiting adjusted to 20 req/min per IP with millisecond collision resistance and `x-real-ip` preference.

### Security, Build Hygiene & UX (P3)
- **P3-1**: Dependencies upgraded (`next@16.4.6`, `eslint-config-next@16.4.6`, `zod@^4.6.6`); transitive advisories resolved with `npm audit fix`; 0 production vulnerabilities.
- **P3-2**: ESLint strict compliance achieved (0 errors, 0 warnings); `npm run lint` wired; GitHub Actions CI workflow created.
- **P3-3**: Font fallback configuration added for offline build reproducibility.
- **P3-4**: UI text refined (black hole emoji replaced with map/search icons; Vancouver labeled "Vancouver (superscript numerals)"; outcome guidance clarified).
