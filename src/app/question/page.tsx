"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatedProcessingIndicator } from "@/components/AnimatedProcessingIndicator";
import { rationalOutcomes, type Analysis, type Clarification, type Formulation } from "@/lib/kb";
import {
  buildOutcomeContext,
  parseOutcomeSelectionResponse,
  selectOutcomes,
  validateFreeTextOutcome,
  type OutcomeSelectionResponse
} from "@/lib/outcome-selection";
import { sget, sset, KEYS } from "@/lib/session";
import { readSessionInput, sessionSearchText } from "@/lib/clinical-input";

export default function QuestionPage() {
  const router = useRouter();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [answered, setAnswered] = useState<Record<string, string>>({});
  const [clarification, setClarification] = useState<Clarification | null>(null);
  const [chatLog, setChatLog] = useState<{ q?: string; a?: string }[]>([]);
  const [freeText, setFreeText] = useState("");
  const [selectedOutcomes, setSelectedOutcomes] = useState<string[]>([]);
  const [freeTextError, setFreeTextError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>("intent");
  const analysisRef = useRef<Analysis | null>(null);

  const gapPath = useMemo(() => { try { return !!sget<unknown>(KEYS.gap); } catch { return false; } }, []);

  /**
   * What the clinician actually typed, for the outcome selector.
   *
   * The landing page stores the entry under `KEYS.inputText`; only the gap flow writes
   * `KEYS.question`. Reading `KEYS.question` alone therefore handed the selector an empty string on
   * the main path, so the keywords the clinician typed were dropped before scoring and the
   * recommendation fell back to whichever generic patient-important outcome matched the condition
   * alone. On "fibroids, hysterectomy, menstrual blood loss, haemoglobin" that surfaced
   * "Patient-reported pain reduction" instead of "Menstrual blood loss reduction".
   */
  function getLiteratureKeywords(): string[] {
    const gapSnapshot = sget<{
      topic?: string;
      known?: Array<{ point?: string; references?: Array<{ title?: string }> }>;
      uncertain?: Array<{ point?: string; references?: Array<{ title?: string }> }>;
      gaps?: Array<{ gap?: string }>;
    }>(KEYS.gap);
    const kw: string[] = [];
    if (gapSnapshot) {
      if (gapSnapshot.topic) kw.push(gapSnapshot.topic);
      if (Array.isArray(gapSnapshot.known)) {
        gapSnapshot.known.forEach(k => {
          if (k?.point) kw.push(k.point);
          if (Array.isArray(k?.references)) {
            k.references.forEach(r => { if (r?.title) kw.push(r.title); });
          }
        });
      }
      if (Array.isArray(gapSnapshot.uncertain)) {
        gapSnapshot.uncertain.forEach(u => {
          if (u?.point) kw.push(u.point);
          if (Array.isArray(u?.references)) {
            u.references.forEach(r => { if (r?.title) kw.push(r.title); });
          }
        });
      }
      if (Array.isArray(gapSnapshot.gaps)) {
        gapSnapshot.gaps.forEach(g => { if (g?.gap) kw.push(g.gap); });
      }
    }
    return kw;
  }

  function originalQuestionText(): string {
    return sget<string>(KEYS.inputText) || sget<string>(KEYS.question) || "";
  }

  useEffect(() => { analysisRef.current = analysis; }, [analysis]);

  interface RawClarify {
    done?: unknown;
    field?: unknown;
    questionText?: unknown;
    options?: unknown;
    source?: unknown;
    outcomeSelection?: unknown;
  }

  const normalizeClarify = useCallback((c: RawClarify, a: Analysis): Clarification => {
    const done = c?.done === true || String(c?.done ?? "").toLowerCase() === "true";
    const field = typeof c?.field === "string" && c.field ? c.field : "outcome";
    const rawOptions = Array.isArray(c?.options)
      ? c.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0)
      : [];
    // De-duplicate: a repeated option would collide as a React key.
    let options = Array.from(new Set(rawOptions.map(o => o.trim())));
    let rationale: string | undefined;
    let outcomeSelection: OutcomeSelectionResponse | undefined;

    if (!done && field === "outcome") {
      const literatureKw = getLiteratureKeywords();
      const selection = parseOutcomeSelectionResponse(c?.outcomeSelection, buildOutcomeContext(
        {
          specialty: a.specialty,
          condition: a.condition,
          intervention: a.intervention,
          comparator: a.comparator,
          questionType: a.questionType
        },
        {},
        { originalInput: originalQuestionText(), population: a.condition, keywords: literatureKw }
      ));
      outcomeSelection = selection.response;
      options = outcomeSelection.options.map(o => o.label);
      rationale = outcomeSelection.recommendedOutcome.rationale;
    } else if (!options.length && !done) {
      const logic = rationalOutcomes(a.condition, a.specialty);
      options = [logic.primary, ...logic.alternatives.filter(o => o !== logic.primary)].slice(0, 6);
      rationale = logic.rationale;
    }

    return {
      done,
      field: done ? null : field,
      questionText: typeof c?.questionText === "string" && c.questionText ? c.questionText : "Please specify:",
      options,
      allowFreeText: false,
      source: c?.source === "ai" ? "ai" : c?.source === "hybrid" ? "hybrid" : "rules",
      rationale,
      outcomeSelection
    };
  }, []);

  const outcomeClarify = useCallback((a: Analysis, questionText: string): Clarification => {
    const literatureKw = getLiteratureKeywords();
    const selection = selectOutcomes(buildOutcomeContext(
      {
        specialty: a.specialty,
        condition: a.condition,
        intervention: a.intervention,
        comparator: a.comparator,
        questionType: a.questionType
      },
      {},
      { originalInput: originalQuestionText(), population: a.condition, keywords: literatureKw }
    ));
    return {
      done: false,
      field: "outcome",
      questionText,
      options: selection.options.map(o => o.label),
      allowFreeText: false,
      source: selection.source,
      rationale: selection.recommendedOutcome.rationale,
      outcomeSelection: selection
    };
  }, []);

  const finishAndGo = useCallback((f: Formulation, ans: Record<string, string>) => {
    const str = (v: unknown): string => (typeof v === "string" ? v : "");
    const normElement = (v: unknown): { label: string; value: string } | null => {
      const o = v as { label?: unknown; value?: unknown };
      if (!o || typeof o !== "object") return null;
      const label = str(o.label) || "Element";
      const value = str(o.value);
      return value ? { label, value } : null;
    };
    const normScore = (v: unknown): { name: string; value: number } | null => {
      const o = v as { name?: unknown; value?: unknown };
      const name = str(o?.name);
      const value = typeof o?.value === "number" ? o.value : Number(str(o.value)) || 0;
      return name ? { name, value } : null;
    };
    const normVariant = (v: unknown): { question: string; rationale: string } | null => {
      const o = v as { question?: unknown; rationale?: unknown };
      const question = str(o?.question);
      return question ? { question, rationale: str(o?.rationale) } : null;
    };
    const normAdvisory = (v: unknown): string => {
      if (typeof v === "string" && v.trim()) return v;
      const o = v as { warning?: unknown; recommendation?: unknown; rationale?: unknown };
      if (o && typeof o === "object") {
        const bits = [
          str(o.warning),
          o.recommendation ? `Recommended: ${str(o.recommendation)}` : "",
          str(o.rationale)
        ].filter(Boolean);
        return bits.join(" ");
      }
      return "";
    };
    f.scores = Array.isArray(f.scores)
      ? f.scores.map(normScore).filter((s): s is { name: string; value: number } => !!s) : [];
    if (!f.scores.length) f.scores = [{ name: "Overall", value: 15 }];
    f.elements = Array.isArray(f.elements)
      ? f.elements.map(normElement).filter((e): e is { label: string; value: string } => !!e) : [];
    f.advisories = Array.isArray(f.advisories)
      ? f.advisories.map(normAdvisory).filter(Boolean) : [];
    f.variants = Array.isArray(f.variants)
      ? f.variants.map(normVariant).filter((v): v is { question: string; rationale: string } => !!v) : [];
    sset(KEYS.formulation, f);
    sset("cq_outcome", ans.outcome || "");
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(KEYS.commentary);
    }
    router.push("/paper");
  }, [router]);

  const formulate = useCallback(async (a: Analysis, ans: Record<string, string>) => {
    setBusy("formulate");
    let f: Formulation | null = null;
    // A 400 that names missing PICO elements is the server refusing to fabricate a clinical
    // question (F-05). Falling through to a local ruleFormulate would recompute exactly the
    // placeholder we just rejected, so resume clarification for the element it names instead.
    let resume: { field: string; questionText: string } | null = null;
    try {
      try {
        const res = await fetch("/api/engine", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: "formulate", analysis: a, answered: ans })
        });
        const parsed = await res.json();
        if (parsed && parsed.finalQuestion && !parsed.error) f = parsed;
        else if (parsed && parsed.error && parsed.field) {
          resume = { field: parsed.field, questionText: parsed.questionText || "Please clarify." };
        }
      } catch {}
      if (resume) {
        setSelectedOutcomes([]);
        setClarification({
          done: false, field: resume.field, questionText: resume.questionText,
          options: [], allowFreeText: true, source: "rules"
        });
        setChatLog(prev => [...prev, { q: resume!.questionText }]);
        setBusy(null);
        return;
      }
      if (!f) {
        const { ruleFormulate } = await import("@/lib/rule-engine");
        f = ruleFormulate(a, ans);
      }
      if (!f.finalQuestion) {
        // The local fallback refused too. Ask for whatever it says is missing rather than
        // rendering an empty question card.
        const field = f.missingElements?.[0] || "condition";
        const questionText = field === "intervention"
          ? "What intervention are you considering?"
          : "What is the clinical problem or population?";
        setSelectedOutcomes([]);
        setClarification({ done: false, field, questionText, options: [], allowFreeText: true, source: "rules" });
        setChatLog(prev => [...prev, { q: questionText }]);
        setBusy(null);
        return;
      }
      finishAndGo(f, ans);
    } catch {
      const { ruleFormulate } = await import("@/lib/rule-engine");
      finishAndGo(ruleFormulate(a, ans), ans);
    }
  }, [finishAndGo]);

  const runClarifyLoop = useCallback(async (a: Analysis, ans: Record<string, string>, log: { q?: string; a?: string }[]) => {
    setBusy("clarify");
    let raw: RawClarify | null = null;
    try {
      const res = await fetch("/api/engine", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "clarify", analysis: a, answered: ans })
      });
      raw = await res.json();
    } catch {}
    if (!raw) {
      const { ruleClarify } = await import("@/lib/rule-engine");
      raw = ruleClarify(a, ans);
      setNotice("AI is busy — continuing in offline mode.");
    }
    const nc = normalizeClarify(raw, a);
    if (gapPath && log.length === 0) {
      Object.assign(nc, outcomeClarify(a, "Which outcomes should the evidence commentary target?"));
    } else if (log.length >= 1) { nc.done = true; nc.field = null; }
    if (nc.done && log.length === 0) {
      Object.assign(nc, outcomeClarify(a, "What is your primary clinical outcome of interest?"));
    }
    setSelectedOutcomes([]);
    setFreeTextError(null);
    setClarification(nc);
    setBusy(null);
    if (nc.done) {
      await formulate(a, ans);
    } else {
      setChatLog([...log, { q: nc.questionText }]);
    }
  }, [formulate, normalizeClarify, outcomeClarify, gapPath]);

  const answer = useCallback(async (field: string, value: string) => {
    try {
      if (!field || !value) return;
      const base = analysisRef.current;
      if (!base) { setNotice("Session lost — please go back to Step 1."); return; }
      const ans = { ...answered, [field]: value };
      setAnswered(ans);
      // Build the log once and pass that same value onward. Passing the stale
      // `chatLog` closure made runClarifyLoop overwrite the just-recorded answer.
      const nextLog = chatLog.length
        ? [...chatLog.slice(0, -1), { ...chatLog[chatLog.length - 1], a: value }]
        : chatLog;
      setChatLog(nextLog);
      await runClarifyLoop(base, ans, nextLog);
    } catch (e) {
      setNotice(`Answer failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [answered, runClarifyLoop, chatLog]);

  const submitSelectedOutcomes = useCallback((overrideVals?: string[]) => {
    const vals = (overrideVals && overrideVals.length ? overrideVals : selectedOutcomes).slice(0, 2);
    if (!vals.length) return;
    sset(KEYS.outcomes, vals);
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(KEYS.commentary);
    }
    setFreeText("");
    setFreeTextError(null);
    setSelectedOutcomes([]);
    answer("outcome", vals.join(" and "));
  }, [selectedOutcomes, answer]);

  useEffect(() => {
    const question = sget<string>(KEYS.question);
    // Prefer the normalized keyword string written at Step 1; fall back to the structured
    // payload (and finally to a legacy raw string) so older sessions still resolve.
    const normalized = sget<string>(KEYS.inputText);
    const stored = readSessionInput(sget<unknown>(KEYS.input));
    const text = question || normalized || (stored ? sessionSearchText(stored) : "");
    if (!text) { router.replace("/"); return; }
    (async () => {
      let a: Analysis | null = null;
      try {
        const res = await fetch("/api/engine", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: "intent", input: text })
        });
        a = await res.json();
      } catch {}
      if (!a || !a.specialty) {
        const { ruleAnalyze } = await import("@/lib/rule-engine");
        a = ruleAnalyze(text);
        if (!a.specialty) {
          setNotice("This could not be mapped to an Obstetrics & Gynecology context. Go back and rephrase.");
          setBusy(null);
          return;
        }
        setNotice("AI busy — offline mode.");
      }
      setAnalysis(a);
      analysisRef.current = a;
      await runClarifyLoop(a, {}, []);
    })();
  }, [router, runClarifyLoop]);

  return (
    <div className="wrap">
      <header className="hdr">
        <h1>{gapPath ? "🎯 Step 3 · Choose Your Outcomes" : "💬 Step 3 · Interactive Clarification"}</h1>
        <p>{gapPath ? "Pick the 1–2 outcomes the evidence commentary should target" : "A few targeted questions turn uncertainty into an answerable PICO"}</p>
      </header>

      <main className="solo">
        {analysis && (
          <section className="card">
            <span className="pill">🧠 Intent Recognition {analysis.source === "ai" ? "(AI)" : "(offline)"}</span>
            <p><b>Specialty:</b> <span className="tag">{analysis.specialtyLabel}</span>
              &nbsp;<b>Type:</b> <span className="tag">{analysis.questionType}</span> → <span className="tag">{analysis.framework}</span></p>
            <p style={{ marginTop: 4 }}><b>Reading:</b> {analysis.interpretation}</p>
          </section>
        )}

        {notice && (
          <section className="card"><div className="advisory">⚠️ {notice}</div></section>
        )}

        {chatLog.length > 0 && (
          <section className="card">
            {chatLog.map((m, i) => (
              <div key={i} className="turn">
                {m.q && <div className="bubble ai">{m.q}</div>}
                {m.a && <div className="bubble user">{m.a}</div>}
              </div>
            ))}
{clarification && !clarification.done && busy !== "clarify" && (
                <>
                  {clarification.field === "outcome" ? (
                    <>
                      <p className="hint">{clarification.questionText}</p>
                      {(() => {
                        const selection = clarification.outcomeSelection;
                        const maxPick = selection?.maxSelections ?? 2;
                        const recommendedId = selection?.recommendedOutcome.id;
                        const chosen = selectedOutcomes.length;
                        const atMax = chosen >= maxPick;
                        const byLabel = new Map((selection?.options ?? []).map(o => [o.label, o]));
                        return (
                          <>
                            <p className="hint" style={{ marginTop: 4 }}>
                              {selection
                                ? `These ${selection.options.length} options were selected for this question.`
                                : "Suggested outcomes."}
                            </p>
                            <div className="chips outcome-chips" role="group" aria-label="Outcome options">
                              {clarification.options.map(o => {
                                const detail = byLabel.get(o);
                                const sel = selectedOutcomes.includes(o);
                                const full = atMax && !sel;
                                const recommended = !!detail && detail.id === recommendedId;
                                return (
                                  <button
                                    key={o}
                                    type="button"
                                    className={`chip outcome-chip ${sel ? "chip-on" : ""} ${recommended ? "chip-recommended" : ""}`}
                                    aria-pressed={sel}
                                    aria-label={`${o}${recommended ? ", recommended primary outcome" : ""}${detail ? `, ${detail.category} outcome` : ""}`}
                                    disabled={full}
                                    title={full ? `You can select up to ${maxPick} outcomes.` : detail?.rationale}
                                    onClick={() => {
                                      setSelectedOutcomes(prev =>
                                        prev.includes(o) ? prev.filter(x => x !== o)
                                          : prev.length >= maxPick ? [o] : [...prev, o]);
                                    }}
                                  >
                                    <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                                      <span className="outcome-chip-label">{o}</span>
                                      {sel && <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "inherit" }}>✓ Selected</span>}
                                    </div>
                                    <span className="outcome-chip-meta">
                                      {recommended && <span className="outcome-badge">Recommended</span>}
                                      {detail && <span className="outcome-category">{detail.category.replace(/-/g, " ")}</span>}
                                    </span>
                                    {detail && <span className="outcome-why">{detail.rationale}</span>}
                                  </button>
                                );
                              })}
                            </div>
                            {selection && (
                              <p className="hint" style={{ marginTop: 12 }}>
                                💡 <b>Evidence Grounding:</b> {selection.recommendedOutcome.rationale}
                              </p>
                            )}
                            <div className="row" style={{ marginTop: 14 }}>
                              <button
                                className="primary"
                                style={{ padding: "12px 28px", fontSize: "1rem" }}
                                disabled={!selectedOutcomes.length}
                                onClick={() => submitSelectedOutcomes()}
                              >
                                {selectedOutcomes.length
                                  ? `Continue to Scientific Commentary with "${selectedOutcomes[0]}" ➜`
                                  : "Choose an outcome above to continue ➜"}
                              </button>
                            </div>
                            <p className="hint" style={{ marginTop: 8 }} aria-live="polite">
                              {selectedOutcomes.length
                                ? `Selected: ${selectedOutcomes.join(", ")}. Click above to proceed to Step 4.`
                                : `Select one of the ${clarification.options.length} literature-derived outcomes above to generate your scientific commentary.`}
                            </p>
                          </>
                        );
                      })()}
                    </>
                  ) : (
                    <>
                      <p className="hint">{clarification.questionText}</p>
                      <div className="chips">
                        {clarification.options.map(o => (
                          <button key={o} className="chip" onClick={() => {
                            const field = clarification.field || "outcome";
                            answer(field, o);
                          }}>{o}</button>
                        ))}
                      </div>
                      {(!clarification.options || clarification.options.length === 0) && (
                        <div className="row" style={{ marginTop: 10 }}>
                          <input
                            className="free-input"
                            value={freeText}
                            onChange={e => setFreeText(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter" && freeText.trim()) answer(clarification.field || "outcome", freeText.trim()); }}
                            placeholder="Type your answer…"
                          />
                          <button className="primary" disabled={!freeText.trim()}
                            onClick={() => answer(clarification.field || "outcome", freeText.trim())}>
                            Answer ➜
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
             {busy === "clarify" && <AnimatedProcessingIndicator message="Thinking…" />}
          </section>
        )}

        {busy === "intent" && (
          <section className="card">
            <AnimatedProcessingIndicator
              message="Analyzing your clinical scenario…"
              secondaryMessage="This should take just a moment."
            />
          </section>
        )}
        {busy === "formulate" && (
          <section className="card">
            <AnimatedProcessingIndicator
              message="Formulating your clinical questions…"
              secondaryMessage="Refining the PICO parameters against clinical guidelines."
            />
          </section>
        )}

        <div className="row"><button className="link" onClick={() => router.push("/")}>← Start over</button></div>
      </main>
      <footer>Version 3.0 · Copyright©RaoufRoshdy2026</footer>
    </div>
  );
}
