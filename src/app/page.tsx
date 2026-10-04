"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { sset, KEYS } from "@/lib/session";
import {
  parseInput,
  toSessionInput,
  sessionSearchText,
  validateKeywords,
  keywordCountHint,
  resolveCorrections,
  correctionKey,
  readSessionInput
} from "@/lib/clinical-input";
import type { KeywordCorrection, CorrectionRecord } from "@/lib/clinical-input";
import type { ClinicalInput } from "@/lib/clinical-input";

// sessionStorage is browser-only, so it cannot be read while rendering on the server.
// useSyncExternalStore is the one way to read it without either a hydration mismatch or a
// setState-in-effect: React renders the server snapshot during hydration and the stored
// snapshot immediately after, so the first paint matches the server HTML exactly.
//
// The cache is keyed on the raw JSON string, not the parsed value. `sget` parses on every
// call, so keying on its result returned a fresh object each time and React saw an unstable
// snapshot; keying on the string keeps the identity stable until the stored value changes.
let cachedRaw: string | null = null;
let cachedValue: ClinicalInput | null = null;
function sessionInputSnapshot(): ClinicalInput | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(KEYS.input);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = raw ? readSessionInput(JSON.parse(raw)) : null;
  }
  return cachedValue;
}
const serverSnapshot = (): null => null;
const serverModeSnapshot = (): "formulate" => "formulate";
const subscribeToNothing = () => () => {};
// Stable empty array so the memoized parse is not recomputed on every render.
const EMPTY_DECISIONS: CorrectionRecord[] = [];
// Same stability requirement as the input: the restored mode must keep one identity, and it
// must be read through the same snapshot path or the first client render differs from the
// server HTML when the stored mode is "gap".
let cachedModeRaw: string | null = null;
let cachedModeValue: "formulate" | "gap" = "formulate";
function sessionModeSnapshot(): "formulate" | "gap" {
  if (typeof window === "undefined") return "formulate";
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(KEYS.mode);
  } catch {
    raw = null;
  }
  if (raw !== cachedModeRaw) {
    cachedModeRaw = raw;
    cachedModeValue = raw === "gap" ? "gap" : "formulate";
  }
  return cachedModeValue;
}

export default function Home() {
  const router = useRouter();
  const restored = useSyncExternalStore(subscribeToNothing, sessionInputSnapshot, serverSnapshot);
  const restoredMode = useSyncExternalStore(subscribeToNothing, sessionModeSnapshot, serverModeSnapshot);
  // Until the user types, the field shows the restored text; `draft` takes over afterwards so
  // editing never gets overwritten by the stored value.
  const [draft, setDraft] = useState<string | null>(null);
  const input = draft ?? restored?.rawInput ?? "";
  const setInput = useCallback((v: string) => setDraft(v), []);
  const [modeDraft, setModeDraft] = useState<"formulate" | "gap" | null>(null);
  const mode = modeDraft ?? restoredMode;
  const setMode = useCallback((v: "formulate" | "gap") => setModeDraft(v), []);
  const [tagError, setTagError] = useState<string | null>(null);
  // Every suggestion the user has decided, applied or kept. Keyed decisions are what stop a
  // suggestion reappearing when the input is reparsed, the component rerenders, or the page is
  // reloaded. Restored decisions come from the session audit trail.
  const [decided, setDecided] = useState<CorrectionRecord[] | null>(null);
  const decisions = useMemo(
    () => decided ?? restored?.corrections ?? EMPTY_DECISIONS,
    [decided, restored]
  );

  // Validate as the user types so the count and message stay live, but never block typing.
  const parsed = useMemo(
    () => resolveCorrections(parseInput(input), decisions),
    [input, decisions]
  );
  const countHint = keywordCountHint(parsed);
  const validationMessage = validateKeywords(parsed);
  const canSubmit = validationMessage === null;

  // The professional message must be reachable even though navigation is blocked, so it is
  // shown live while typing rather than only after a submit the disabled button prevents.
  const liveMessage = input.trim() ? validationMessage : null;
  const alertMessage = tagError || liveMessage;

  const decide = (c: KeywordCorrection, decision: CorrectionRecord["decision"]) => {
    const key = correctionKey(c);
    const record: CorrectionRecord = { ...c, decision };
    const at = decisions.findIndex(p => correctionKey(p) === key);
    const next = at >= 0 ? decisions.map(p => (correctionKey(p) === key ? record : p)) : [...decisions, record];
    setDecided(next);
    // Persist immediately: a decision the user cannot see they made until they start the
    // search would otherwise be lost on reload.
    const current = resolveCorrections(parseInput(input), next);
    sset(KEYS.input, toSessionInput(current, input));
    sset(KEYS.inputText, sessionSearchText(toSessionInput(current, input)));
    setTagError(null);
  };

  const start = () => {
    const current = resolveCorrections(parseInput(input), decisions);
    const err = validateKeywords(current);
    if (err) { setTagError(err); return; }
    setTagError(null);
    sset(KEYS.input, toSessionInput(current, input));
    sset(KEYS.inputText, sessionSearchText(toSessionInput(current, input)));
    sset(KEYS.mode, mode);
    router.push(mode === "gap" ? "/gap" : "/question");
  };

  return (
    <div className="wrap">
      <header className="hdr">
        <div className="hdr-inner">
          <div className="hdr-left">
            <svg className="lens-icon" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <span className="title-main">AI PICO</span>
          </div>
          <div className="hdr-center">
            <h1>From Clinical Uncertainty to Answerable Questions</h1>
            <p>AI-Assisted Clinical Question Formulation · Obs/Gyn</p>
          </div>
          <div className="hdr-right">
            <span className="author-name">
              <Image src="/dr-raouf.jpg" alt="Dr Raouf Roshdy" className="author-photo" width={72} height={72} />
              Dr Raouf Roshdy
            </span>
          </div>
        </div>
      </header>

      <main className="solo">
        <section className="card">
          <div className="modes">
            <button className={`mode-tab ${mode === "formulate" ? "active" : ""}`} onClick={() => setMode("formulate")}>
              <svg className="mode-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 17v4" />
                <path d="M9 20h6" />
                <path d="M14 11V3" />
                <path d="M11 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
                <path d="M16 8h-5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h5a1 1 0 0 1 1 1v3" />
              </svg>
              <span>Formulate Question</span>
            </button>
            <button className={`mode-tab ${mode === "gap" ? "active" : ""}`} onClick={() => setMode("gap")}>
              <svg className="mode-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.3-4.3" />
                <path d="M11 8v6" />
                <path d="M11 16h.01" />
              </svg>
              <span>Find Gap</span>
            </button>
          </div>

          {mode === "formulate" ? (
            <>
              <span className="pill">📝 Step 1 · Clinical Input</span>
              <p className="hint">Enter 4–6 clinically meaningful keywords or phrases. Multi-word phrases count as one keyword. Separate terms with commas, dashes, semicolons, or new lines.</p>
              <textarea
                aria-label="Clinical keywords"
                value={input}
                onChange={(e) => { setInput(e.target.value); setTagError(null); }}
                placeholder="e.g., short cervix, progesterone, cerclage, preterm birth, cervical length"
                rows={4}
              />
            </>
          ) : (
            <>
              <span className="pill">🕳️ Find Gap · Evidence Mapping</span>
              <p className="hint">Enter 4–6 clinically meaningful keywords or phrases. Multi-word phrases count as one keyword. The system searches the OB/GYN literature and maps 4 established, 4 conflicting and 4 evidence-gap areas.</p>
              <textarea
                aria-label="Clinical keywords"
                value={input}
                onChange={(e) => { setInput(e.target.value); setTagError(null); }}
                placeholder="e.g., endometriosis, live birth rate, IVF, aspirin, recurrent implantation failure"
                rows={4}
              />
            </>
          )}

          {countHint && (
            <p className={`count-hint${!canSubmit ? " count-bad" : " count-ok"}`} aria-live="polite">{countHint}</p>
          )}

          {parsed.corrections.length > 0 && (
            <div className="advisory" role="status" aria-live="polite" style={{ marginTop: 10 }}>
              {parsed.corrections.map(c => (
                <div key={`${c.from}-${c.to}`} className="correction-row">
                  <span>Suggested correction: “{c.from}” → “{c.to}”. Apply correction?</span>
                  <span className="row" style={{ marginTop: 6 }}>
                    <button className="mini-btn" onClick={() => decide(c, "applied")}>Apply</button>
                    <button className="mini-btn" onClick={() => decide(c, "kept")}>Keep “{c.from}”</button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {alertMessage && (
            <div className="advisory" role="alert" aria-live="polite" style={{ marginTop: 10 }}>⚠️ {alertMessage}</div>
          )}

          <div className="row">
            <button className="primary" onClick={start} disabled={!input.trim() || !canSubmit}>
              {mode === "formulate" ? "🔍 Start formulation →" : "🗺 Map the evidence →"}
            </button>
          </div>
        </section>
      </main>

      <footer>Version 3.0 — modular steps · Educational tool: always verify formulated questions clinically.<br />Copyright©RaoufRoshdy2026</footer>
    </div>
  );
}