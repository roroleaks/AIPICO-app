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
import { classifyWordRole, type PicoRole, type PicoWord } from "@/lib/pico-roles";
import { PhiNotice } from "@/components/PhiNotice";
import { WorkflowStepper } from "@/components/WorkflowStepper";
import { AppDeployQrCode } from "@/components/AppDeployQrCode";

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
    try {
      cachedValue = raw ? readSessionInput(JSON.parse(raw)) : null;
    } catch {
      cachedValue = raw ? readSessionInput(raw) : null;
    }
  }
  return cachedValue;
}
const serverSnapshot = (): null => null;
const subscribeToNothing = () => () => {};
const EMPTY_DECISIONS: CorrectionRecord[] = [];

const ROLE_CONFIG: Record<PicoRole, { label: string; badge: string; bg: string; border: string; text: string; badgeBg: string }> = {
  population: {
    label: "Population (P)",
    badge: "P",
    bg: "#eff6ff",
    border: "#bfdbfe",
    text: "#1e40af",
    badgeBg: "#3b82f6"
  },
  intervention: {
    label: "Intervention (I)",
    badge: "I",
    bg: "#f0fdf4",
    border: "#bbf7d0",
    text: "#166534",
    badgeBg: "#22c55e"
  },
  comparator: {
    label: "Comparator (C)",
    badge: "C",
    bg: "#fffbeb",
    border: "#fde68a",
    text: "#92400e",
    badgeBg: "#f59e0b"
  },
  outcome: {
    label: "Outcome (O)",
    badge: "O",
    bg: "#faf5ff",
    border: "#e9d5ff",
    text: "#6b21a8",
    badgeBg: "#a855f7"
  }
};

export default function Home() {
  const router = useRouter();
  const restored = useSyncExternalStore(subscribeToNothing, sessionInputSnapshot, serverSnapshot);

  const [draft, setDraft] = useState<string | null>(null);
  const input = draft ?? restored?.rawInput ?? "";
  const setInput = useCallback((v: string) => setDraft(v), []);
  const [tagError, setTagError] = useState<string | null>(null);

  // Manual PICO role overrides decided by the user, keyed by normalized word
  const [userRoles, setUserRoles] = useState<Record<string, PicoRole>>({});

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

  // Split input into real keyword tokens on commas, semicolons, hyphens, and newlines
  const tokens = useMemo(
    () => input.split(/[,;\-\n]/).map(t => t.trim()).filter(Boolean),
    [input]
  );

  const structuredValidationError = useMemo(() => {
    if (entryStyle !== "structured") return null;
    if (!structP.trim()) return "Please enter the Population / Clinical Problem (P).";
    if (!structI.trim()) return "Please enter the Intervention / Therapy (I).";
    if (!structC.trim() && !structO.trim()) {
      return "Please specify a Comparator / Control (C) or a Target Outcome (O) (or both).";
    }
    if (parsed.logicalCount > 5) {
      return `${parsed.logicalCount} keywords detected — maximum is 5.`;
    }
    return null;
  }, [entryStyle, structP, structI, structC, structO, parsed.logicalCount]);

  const validationMessage = entryStyle === "structured" ? structuredValidationError : validateKeywords(parsed);

  const canSubmit = useMemo(() => {
    if (entryStyle === "structured") {
      const filled = [structP, structI, structC, structO].filter(s => s.trim().length > 0).length;
      return structuredValidationError === null && filled >= 3;
    }
    return tokens.length >= 3 && validationMessage === null;
  }, [entryStyle, structP, structI, structC, structO, structuredValidationError, tokens.length, validationMessage]);

  const countHint = useMemo(() => {
    if (entryStyle === "structured") {
      const filled = [structP, structI, structC, structO].filter(s => s.trim().length > 0).length;
      if (filled === 0) return "";
      if (!structP.trim() || !structI.trim()) {
        return `${filled} structured field${filled === 1 ? "" : "s"} entered — Population (P) and Intervention (I) are required.`;
      }
      return `${filled} structured PICO field${filled === 1 ? "" : "s"} entered.`;
    }
    if (tokens.length === 0) return "";
    if (tokens.length < 3) {
      const needed = 3 - tokens.length;
      return `${tokens.length} keyword${tokens.length === 1 ? "" : "s"} detected — add ${needed} more keyword${needed > 1 ? "s" : ""} (3 required minimum).`;
    }
    return keywordCountHint(parsed);
  }, [entryStyle, structP, structI, structC, structO, tokens.length, parsed]);

  // Dynamic PICO words list reflecting user overrides over auto-classification
  const picoWordsList = useMemo(() => {
    return parsed.normalizedTokens.map(w => {
      const key = w.toLowerCase().trim();
      const autoRole = classifyWordRole(w).role;
      const role = userRoles[key] ?? autoRole;
      return { word: w, role };
    });
  }, [parsed.normalizedTokens, userRoles]);

  // One-line summary and soft advisory
  const { summaryLine, showMissingAdvisory } = useMemo(() => {
    if (picoWordsList.length === 0) return { summaryLine: "", showMissingAdvisory: false };
    const p = picoWordsList.filter(item => item.role === "population").map(item => item.word);
    const i = picoWordsList.filter(item => item.role === "intervention").map(item => item.word);
    const c = picoWordsList.filter(item => item.role === "comparator").map(item => item.word);
    const o = picoWordsList.filter(item => item.role === "outcome").map(item => item.word);

    const parts: string[] = [];
    if (p.length) parts.push(`P: ${p.join(", ")}`);
    if (i.length) parts.push(`I: ${i.join(", ")}`);
    if (c.length) parts.push(`C: ${c.join(", ")}`);
    if (o.length) parts.push(`O: ${o.join(", ")}`);

    return {
      summaryLine: parts.join(" · "),
      showMissingAdvisory: (p.length === 0 || i.length === 0) && picoWordsList.length >= 3
    };
  }, [picoWordsList]);

  const handleRoleChange = useCallback((term: string, newRole: PicoRole) => {
    setUserRoles(prev => ({
      ...prev,
      [term.toLowerCase().trim()]: newRole
    }));
  }, []);

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
    setUserRoles({});
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
    const err = entryStyle === "structured" ? structuredValidationError : validateKeywords(current);
    if (err) { setTagError(err); return; }
    setTagError(null);
    sset(KEYS.input, toSessionInput(current, input));
    sset(KEYS.inputText, sessionSearchText(toSessionInput(current, input)));
    const finalWords: PicoWord[] = entryStyle === "structured"
      ? [
          structP.trim() ? { word: structP.trim(), role: "population" as const } : null,
          structI.trim() ? { word: structI.trim(), role: "intervention" as const } : null,
          structC.trim() ? { word: structC.trim(), role: "comparator" as const } : null,
          structO.trim() ? { word: structO.trim(), role: "outcome" as const } : null,
        ].filter((x): x is PicoWord => x !== null)
      : current.normalizedTokens.map(w => ({
          word: w,
          role: userRoles[w.toLowerCase().trim()] ?? classifyWordRole(w).role
        }));
    sset(KEYS.picoWords, finalWords);

    router.push("/screen");
  };

  return (
    <div className="wrap">
      <header className="hdr">
        <div className="hdr-inner">
          <div className="hdr-left">
            <Image
              src="/icon-192.png"
              alt="AI PICO Logo"
              width={36}
              height={36}
              style={{ borderRadius: 8, marginRight: 8, boxShadow: "0 2px 8px rgba(15, 118, 110, 0.25)" }}
              priority
            />
            <span className="title-main">
              AI PICO <span className="version-badge">v3.1</span>
            </span>
          </div>
          <div className="hdr-center">
            <h1>AI PICO — From Clinical Uncertainty to Answerable Questions</h1>
            <p>AI-Assisted Clinical Question Formulation · Obs/Gyn & Reproductive Medicine</p>
          </div>
          <div className="hdr-right" style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span className="author-name">
              <Image src="/dr-raouf.jpg" alt="Dr Raouf Roshdy" className="author-photo" width={72} height={72} />
              Dr Raouf Roshdy
            </span>
            <AppDeployQrCode size={56} />
          </div>
        </div>
      </header>

      <WorkflowStepper currentStep={1} />

      <main id="main" className="solo">
        <section className="card">
          <form onSubmit={(e) => { e.preventDefault(); start(); }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
              <span className="pill">📝 Step 1 · Clinical Input</span>
              <div style={{ display: "flex", gap: 6, background: "#f1f5f9", padding: 3, borderRadius: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  aria-pressed={entryStyle === "tags"}
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
                  aria-pressed={entryStyle === "structured"}
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
                  Enter 3–5 clinically meaningful keywords or phrases. Multi-word phrases count as one keyword. Separate terms with commas, dashes, semicolons, or new lines.
                </p>
                <label htmlFor="clinicalKeywords" className="sr-only">Clinical keywords</label>
                <textarea
                  id="clinicalKeywords"
                  aria-label="Clinical keywords"
                  value={input}
                  onChange={(e) => { setInput(e.target.value); setTagError(null); }}
                  onInput={(e) => { setInput((e.target as HTMLTextAreaElement).value); setTagError(null); }}
                  placeholder="e.g., poor responders, ivf, growth hormone, pregnancy rate"
                  rows={4}
                />

                {/* PICO Role Tags Strip */}
                {parsed.normalizedTokens.length > 0 && (
                  <fieldset
                    aria-label="PICO role assignments"
                    style={{
                      marginTop: 12,
                      padding: "12px 14px",
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8
                    }}
                  >
                    <legend className="sr-only">PICO role assignments</legend>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                      <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        🏷️ PICO Roles (Auto-suggested · Editable)
                      </span>
                      <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                        {parsed.normalizedTokens.length} term{parsed.normalizedTokens.length === 1 ? "" : "s"}
                      </span>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {parsed.normalizedTokens.map(term => {
                        const key = term.toLowerCase().trim();
                        const autoRole = classifyWordRole(term).role;
                        const currentRole = userRoles[key] ?? autoRole;
                        const conf = ROLE_CONFIG[currentRole];

                        return (
                          <div
                            key={term}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              background: conf.bg,
                              border: `1px solid ${conf.border}`,
                              padding: "4px 8px",
                              borderRadius: 6,
                              fontSize: "0.82rem"
                            }}
                          >
                            <span
                              style={{
                                background: conf.badgeBg,
                                color: "#fff",
                                fontWeight: 700,
                                fontSize: "0.7rem",
                                padding: "2px 6px",
                                borderRadius: 4
                              }}
                            >
                              {conf.badge}
                            </span>
                            <span style={{ fontWeight: 600, color: conf.text }}>{term}</span>
                            <select
                              aria-label={`Role for keyword "${term}"`}
                              value={currentRole}
                              onChange={(e) => handleRoleChange(term, e.target.value as PicoRole)}
                              style={{
                                fontSize: "0.75rem",
                                padding: "2px 4px",
                                borderRadius: 4,
                                border: "1px solid #cbd5e1",
                                background: "#fff",
                                color: "#334155",
                                cursor: "pointer"
                              }}
                            >
                              <option value="population">Population (P)</option>
                              <option value="intervention">Intervention (I)</option>
                              <option value="comparator">Comparator (C)</option>
                              <option value="outcome">Outcome (O)</option>
                            </select>
                          </div>
                        );
                      })}
                    </div>

                    {summaryLine && (
                      <div style={{ marginTop: 10, fontSize: "0.8rem", color: "#334155", fontWeight: 500 }}>
                        📋 <b>PICO Summary:</b> {summaryLine}
                      </div>
                    )}

                    {showMissingAdvisory && (
                      <div style={{ marginTop: 6, fontSize: "0.78rem", color: "#b45309", background: "#fef3c7", padding: "4px 8px", borderRadius: 4, display: "inline-block" }}>
                        ⚠️ At least one Population and one Intervention word are recommended for screening.
                      </div>
                    )}
                  </fieldset>
                )}
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 12 }}>
                <p className="hint" style={{ marginBottom: 4 }}>
                  Enter explicit clinical terms for each PICO element. The system will map literature across PubMed and European databases.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                  <div>
                    <label htmlFor="pico-p" style={{ fontSize: "0.82rem", fontWeight: 700, color: "#1e293b", display: "block", marginBottom: 4 }}>
                      👥 Population / Clinical Problem (P):
                    </label>
                    <input
                      id="pico-p"
                      type="text"
                      className="free-input"
                      value={structP}
                      onChange={(e) => handleStructuredChange("p", e.target.value)}
                      onInput={(e) => handleStructuredChange("p", (e.target as HTMLInputElement).value)}
                      placeholder="e.g., poor responders, IVF"
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div>
                    <label htmlFor="pico-i" style={{ fontSize: "0.82rem", fontWeight: 700, color: "#1e293b", display: "block", marginBottom: 4 }}>
                      💊 Intervention / Therapy (I):
                    </label>
                    <input
                      id="pico-i"
                      type="text"
                      className="free-input"
                      value={structI}
                      onChange={(e) => handleStructuredChange("i", e.target.value)}
                      onInput={(e) => handleStructuredChange("i", (e.target as HTMLInputElement).value)}
                      placeholder="e.g., growth hormone"
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div>
                    <label htmlFor="pico-c" style={{ fontSize: "0.82rem", fontWeight: 700, color: "#1e293b", display: "block", marginBottom: 4 }}>
                      ⚖️ Comparator / Control (C):
                    </label>
                    <input
                      id="pico-c"
                      type="text"
                      className="free-input"
                      value={structC}
                      onChange={(e) => handleStructuredChange("c", e.target.value)}
                      onInput={(e) => handleStructuredChange("c", (e.target as HTMLInputElement).value)}
                      placeholder="e.g., co enzyme q10"
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div>
                    <label htmlFor="pico-o" style={{ fontSize: "0.82rem", fontWeight: 700, color: "#1e293b", display: "block", marginBottom: 4 }}>
                      🎯 Target Outcome (O):
                    </label>
                    <input
                      id="pico-o"
                      type="text"
                      className="free-input"
                      value={structO}
                      onChange={(e) => handleStructuredChange("o", e.target.value)}
                      onInput={(e) => handleStructuredChange("o", (e.target as HTMLInputElement).value)}
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
                      <button type="button" className="mini-btn" onClick={() => decide(c, "applied")}>Apply</button>
                      <button type="button" className="mini-btn" onClick={() => decide(c, "kept")}>Keep “{c.from}”</button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {alertMessage && (
              <div className="advisory" role="alert" aria-live="polite" style={{ marginTop: 10 }}>⚠️ {alertMessage}</div>
            )}

            <PhiNotice />

            <div className="row" style={{ marginTop: 16 }}>
              <button className="primary" onClick={start} type="submit" disabled={!canSubmit} aria-disabled={!canSubmit} style={{ padding: "12px 28px", fontSize: "1rem" }}>
                🔍 Screen literature & Map evidence →
              </button>
            </div>
          </form>
        </section>
      </main>

      <footer>Version 3.1 — modular steps · Educational tool: always verify formulated questions clinically.<br />Copyright©RaoufRoshdy2026</footer>
    </div>
  );
}