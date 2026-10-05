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
import { parseClinicalScenario } from "@/lib/clinical-semantics";

// sessionStorage is browser-only, so it cannot be read while rendering on the server.
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
const serverModeSnapshot = (): "gap" => "gap";
const subscribeToNothing = () => () => {};
const EMPTY_DECISIONS: CorrectionRecord[] = [];

let cachedModeRaw: string | null = null;
let cachedModeValue: "formulate" | "gap" = "gap";
function sessionModeSnapshot(): "formulate" | "gap" {
  if (typeof window === "undefined") return "gap";
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(KEYS.mode);
  } catch {
    raw = null;
  }
  if (raw !== cachedModeRaw) {
    cachedModeRaw = raw;
    cachedModeValue = raw === "formulate" ? "formulate" : "gap";
  }
  return cachedModeValue;
}

export default function Home() {
  const router = useRouter();
  const restored = useSyncExternalStore(subscribeToNothing, sessionInputSnapshot, serverSnapshot);
  const restoredMode = useSyncExternalStore(subscribeToNothing, sessionModeSnapshot, serverModeSnapshot);

  const [draft, setDraft] = useState<string | null>(null);
  const input = draft ?? restored?.rawInput ?? "";
  const setInput = useCallback((v: string) => setDraft(v), []);
  const [modeDraft, setModeDraft] = useState<"formulate" | "gap" | null>(null);
  const mode = modeDraft ?? restoredMode;
  const setMode = useCallback((v: "formulate" | "gap") => setModeDraft(v), []);
  const [tagError, setTagError] = useState<string | null>(null);

  // Input style: Quick tag words (free-text) vs Structured labeled fields (P, I, C, O)
  const [entryStyle, setEntryStyle] = useState<"tags" | "structured">("tags");

  // Structured fields state
  const [structP, setStructP] = useState("");
  const [structI, setStructI] = useState("");
  const [structC, setStructC] = useState("");
  const [structO, setStructO] = useState("");

  const [decided, setDecided] = useState<CorrectionRecord[] | null>(null);
  const decisions = useMemo(
    () => decided ?? restored?.corrections ?? EMPTY_DECISIONS,
    [decided, restored]
  );

  // Validate as the user types
  const parsed = useMemo(
    () => resolveCorrections(parseInput(input), decisions),
    [input, decisions]
  );
  const countHint = keywordCountHint(parsed);
  const validationMessage = validateKeywords(parsed);
  const canSubmit = validationMessage === null;

  const liveMessage = input.trim() ? validationMessage : null;
  const alertMessage = tagError || liveMessage;

  // Real-time clinical semantic parsing
  const liveScenario = useMemo(() => {
    if (!input.trim() || input.trim().length < 4) return null;
    try {
      return parseClinicalScenario(input);
    } catch {
      return null;
    }
  }, [input]);

  const applyPreset = (preset: { p: string; i: string; c: string; o: string; raw: string }) => {
    setStructP(preset.p);
    setStructI(preset.i);
    setStructC(preset.c);
    setStructO(preset.o);
    setInput(preset.raw);
    setTagError(null);
  };

  const handleStructuredChange = (field: "p" | "i" | "c" | "o", val: string) => {
    const nextP = field === "p" ? val : structP;
    const nextI = field === "i" ? val : structI;
    const nextC = field === "c" ? val : structC;
    const nextO = field === "o" ? val : structO;

    if (field === "p") setStructP(val);
    if (field === "i") setStructI(val);
    if (field === "c") setStructC(val);
    if (field === "o") setStructO(val);

    const parts = [nextP, nextI, nextC, nextO].map(s => s.trim()).filter(Boolean);
    setInput(parts.join(", "));
    setTagError(null);
  };

  const switchToStructured = () => {
    if (liveScenario && (!structP && !structI)) {
      setStructP(liveScenario.population);
      setStructI(liveScenario.intervention);
      setStructC(liveScenario.comparator);
      setStructO(liveScenario.outcomes[0] || "");
    }
    setEntryStyle("structured");
  };

  const decide = (c: KeywordCorrection, decision: CorrectionRecord["decision"]) => {
    const key = correctionKey(c);
    const record: CorrectionRecord = { ...c, decision };
    const at = decisions.findIndex(p => correctionKey(p) === key);
    const next = at >= 0 ? decisions.map(p => (correctionKey(p) === key ? record : p)) : [...decisions, record];
    setDecided(next);
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
    router.push("/gap");
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
            <p>AI-Assisted Clinical Question Formulation · Obs/Gyn & Reproductive Medicine</p>
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

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <span className="pill">📝 Step 1 · Clinical Input</span>
            <div style={{ display: "flex", gap: 6, background: "#f1f5f9", padding: 3, borderRadius: 8 }}>
              <button
                type="button"
                onClick={() => setEntryStyle("tags")}
                style={{
                  border: "none",
                  padding: "5px 12px",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  borderRadius: 6,
                  cursor: "pointer",
                  background: entryStyle === "tags" ? "var(--accent)" : "transparent",
                  color: entryStyle === "tags" ? "#fff" : "var(--muted)"
                }}
              >
                ⚡ Quick Tag Words
              </button>
              <button
                type="button"
                onClick={switchToStructured}
                style={{
                  border: "none",
                  padding: "5px 12px",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  borderRadius: 6,
                  cursor: "pointer",
                  background: entryStyle === "structured" ? "var(--accent)" : "transparent",
                  color: entryStyle === "structured" ? "#fff" : "var(--muted)"
                }}
              >
                🏷️ Structured PICO Fields
              </button>
            </div>
          </div>

          {entryStyle === "tags" ? (
            <>
              <p className="hint">
                Enter 4–6 clinically meaningful keywords or phrases. Multi-word phrases count as one keyword. Separate terms with commas, dashes, semicolons, or new lines.
              </p>
              <textarea
                aria-label="Clinical keywords"
                value={input}
                onChange={(e) => { setInput(e.target.value); setTagError(null); }}
                placeholder="e.g., poor responders, ivf, growth hormone, co enzyme q10, pregnancy rate"
                rows={4}
              />
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 12 }}>
              <p className="hint" style={{ marginBottom: 4 }}>
                Enter explicit clinical terms for each PICO element. The system will map literature across PubMed and European databases.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                <div>
                  <label style={{ fontSize: "0.82rem", fontWeight: 700, color: "#1e293b", display: "block", marginBottom: 4 }}>
                    👥 Population / Clinical Problem (P):
                  </label>
                  <input
                    type="text"
                    className="free-input"
                    value={structP}
                    onChange={(e) => handleStructuredChange("p", e.target.value)}
                    placeholder="e.g., poor responders, IVF"
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "0.82rem", fontWeight: 700, color: "#1e293b", display: "block", marginBottom: 4 }}>
                    💊 Intervention / Therapy (I):
                  </label>
                  <input
                    type="text"
                    className="free-input"
                    value={structI}
                    onChange={(e) => handleStructuredChange("i", e.target.value)}
                    placeholder="e.g., growth hormone"
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "0.82rem", fontWeight: 700, color: "#1e293b", display: "block", marginBottom: 4 }}>
                    ⚖️ Comparator / Control (C):
                  </label>
                  <input
                    type="text"
                    className="free-input"
                    value={structC}
                    onChange={(e) => handleStructuredChange("c", e.target.value)}
                    placeholder="e.g., co enzyme q10"
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "0.82rem", fontWeight: 700, color: "#1e293b", display: "block", marginBottom: 4 }}>
                    🎯 Target Outcome (O):
                  </label>
                  <input
                    type="text"
                    className="free-input"
                    value={structO}
                    onChange={(e) => handleStructuredChange("o", e.target.value)}
                    placeholder="e.g., clinical pregnancy rate"
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              <div style={{ marginTop: 4 }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                  💡 Quick Presets:
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  <button
                    type="button"
                    className="mini-btn"
                    style={{ background: "#f8fafc", color: "var(--ink)", border: "1px solid var(--border)" }}
                    onClick={() => applyPreset({
                      p: "poor responders, ivf",
                      i: "growth hormone",
                      c: "co enzyme q10",
                      o: "clinical pregnancy rate",
                      raw: "poor responders, ivf, growth hormone, co enzyme q10, pregnancy rate"
                    })}
                  >
                    Poor Responders (GH vs CoQ10)
                  </button>
                  <button
                    type="button"
                    className="mini-btn"
                    style={{ background: "#f8fafc", color: "var(--ink)", border: "1px solid var(--border)" }}
                    onClick={() => applyPreset({
                      p: "short cervix",
                      i: "vaginal progesterone",
                      c: "cervical cerclage",
                      o: "spontaneous preterm birth",
                      raw: "short cervix, vaginal progesterone, cerclage, preterm birth, cervical length"
                    })}
                  >
                    Short Cervix (Progesterone vs Cerclage)
                  </button>
                  <button
                    type="button"
                    className="mini-btn"
                    style={{ background: "#f8fafc", color: "var(--ink)", border: "1px solid var(--border)" }}
                    onClick={() => applyPreset({
                      p: "polycystic ovary syndrome",
                      i: "letrozole",
                      c: "clomiphene citrate",
                      o: "cumulative live birth rate",
                      raw: "PCOS, letrozole, clomiphene, live birth rate, ovulation"
                    })}
                  >
                    PCOS (Letrozole vs Clomiphene)
                  </button>
                  <button
                    type="button"
                    className="mini-btn"
                    style={{ background: "#f8fafc", color: "var(--ink)", border: "1px solid var(--border)" }}
                    onClick={() => applyPreset({
                      p: "endometriosis",
                      i: "laparoscopic surgery",
                      c: "dienogest",
                      o: "pelvic pain reduction",
                      raw: "endometriosis, laparoscopy, dienogest, pelvic pain, ovarian reserve"
                    })}
                  >
                    Endometriosis (Surgery vs Dienogest)
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Real-time PICO Classification Badge Card */}
          {liveScenario && (
            <div style={{ marginTop: 12, padding: "12px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  ✓ Live PICO Classification Detected
                </span>
                <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                  Specialty: <b style={{ textTransform: "capitalize" }}>{liveScenario.specialty}</b>
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
                <div style={{ background: "#fff", padding: "8px 10px", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#1e293b", display: "block" }}>👥 Population (P):</span>
                  <span style={{ fontSize: "0.85rem", color: "#0f766e", fontWeight: 600 }}>{liveScenario.population}</span>
                </div>
                <div style={{ background: "#fff", padding: "8px 10px", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#1e293b", display: "block" }}>💊 Intervention (I):</span>
                  <span style={{ fontSize: "0.85rem", color: "#0f766e", fontWeight: 600 }}>{liveScenario.intervention}</span>
                </div>
                <div style={{ background: "#fff", padding: "8px 10px", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#1e293b", display: "block" }}>⚖️ Comparator (C):</span>
                  <span style={{ fontSize: "0.85rem", color: "#0f766e", fontWeight: 600 }}>{liveScenario.comparator}</span>
                </div>
                <div style={{ background: "#fff", padding: "8px 10px", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#1e293b", display: "block" }}>🎯 Target Outcome (O):</span>
                  <span style={{ fontSize: "0.85rem", color: "#0f766e", fontWeight: 600 }}>{liveScenario.outcomes[0] || "clinical outcome"}</span>
                </div>
              </div>
            </div>
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

          <div className="row" style={{ marginTop: 16 }}>
            <button className="primary" onClick={start} disabled={!input.trim() || !canSubmit} style={{ padding: "12px 28px", fontSize: "1rem" }}>
              {mode === "formulate" ? "🔍 Map Evidence & Formulate PICO →" : "🗺 Map the evidence →"}
            </button>
          </div>
        </section>
      </main>

      <footer>Version 3.0 — modular steps · Educational tool: always verify formulated questions clinically.<br />Copyright©RaoufRoshdy2026</footer>
    </div>
  );
}