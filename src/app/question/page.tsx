"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatedProcessingIndicator } from "@/components/AnimatedProcessingIndicator";
import { picoOutcomes, rationalOutcomes, type Analysis, type Clarification, type Formulation } from "@/lib/kb";
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
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>("intent");
  const analysisRef = useRef<Analysis | null>(null);

  const gapPath = useMemo(() => { try { return !!sget<unknown>(KEYS.gap); } catch { return false; } }, []);

  useEffect(() => { analysisRef.current = analysis; }, [analysis]);

  interface RawClarify {
    done?: unknown;
    field?: unknown;
    questionText?: unknown;
    options?: unknown;
    source?: unknown;
  }

  const normalizeClarify = useCallback((c: RawClarify, a: Analysis): Clarification => {
    const done = c?.done === true || String(c?.done ?? "").toLowerCase() === "true";
    const field = typeof c?.field === "string" && c.field ? c.field : "outcome";
    let options = Array.isArray(c?.options)
      ? c.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0)
      : [];
    // De-duplicate: a repeated option would collide as a React key.
    options = Array.from(new Set(options.map(o => o.trim())));
    const rationale = field === "outcome" ? rationalOutcomes(a.condition, a.specialty).rationale : undefined;
    if (!options.length && !done) {
      const logic = rationalOutcomes(a.condition, a.specialty);
      options = [logic.primary, ...logic.alternatives.filter(o => o !== logic.primary)].slice(0, 6);
    }
    return {
      done,
      field: done ? null : field,
      questionText: typeof c?.questionText === "string" && c.questionText ? c.questionText : "Please specify:",
      options,
      allowFreeText: true,
      source: c?.source === "ai" ? "ai" : "rules",
      rationale
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
      const pico = sget<string>(KEYS.question) || "";
      const knownLogic = picoOutcomes(pico, a.condition, a.specialty);
      nc.done = false;
      nc.field = "outcome";
      nc.questionText = "Which outcomes should the evidence commentary target?";
      nc.options = [knownLogic.primary, ...knownLogic.alternatives.filter(o => o !== knownLogic.primary)].slice(0, 6);
      nc.source = "rules";
      nc.rationale = knownLogic.rationale;
    } else if (log.length >= 1) { nc.done = true; nc.field = null; }
    if (nc.done && log.length === 0) {
      const knownLogic = rationalOutcomes(a.condition, a.specialty);
      nc.done = false;
      nc.field = "outcome";
      nc.questionText = "What is your primary clinical outcome of interest?";
      nc.options = [knownLogic.primary, ...knownLogic.alternatives.filter(o => o !== knownLogic.primary)].slice(0, 6);
      nc.source = "rules";
      nc.rationale = knownLogic.rationale;
    }
    setSelectedOutcomes([]);
    setClarification(nc);
    setBusy(null);
    if (nc.done) {
      await formulate(a, ans);
    } else {
      setChatLog([...log, { q: nc.questionText }]);
    }
  }, [formulate, normalizeClarify, gapPath]);

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

  const submitSelectedOutcomes = useCallback(() => {
    const extra = freeText.trim();
    // The 2-outcome cap must also cover free text, otherwise the button says
    // "2 outcome(s)" while submitting three.
    const vals = Array.from(new Set([...selectedOutcomes, ...(extra ? [extra] : [])])).slice(0, 2);
    if (!vals.length) return;
    sset(KEYS.outcomes, vals);
    setFreeText("");
    setSelectedOutcomes([]);
    answer("outcome", vals.join(" and "));
  }, [selectedOutcomes, freeText, answer]);

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
                      <div className="chips">
                        {clarification.options.map(o => {
                          const sel = selectedOutcomes.includes(o);
                          const full = selectedOutcomes.length >= 2 && !sel;
                          return (
                            <button key={o} className={`chip ${sel ? "chip-on" : ""}`} disabled={full}
                              onClick={() => {
                                setSelectedOutcomes(prev =>
                                  prev.includes(o) ? prev.filter(x => x !== o)
                                    : prev.length >= 2 ? prev : [...prev, o]);
                              }}>{o}</button>
                          );
                        })}
                      </div>
                      {clarification.rationale && (
                        <p className="hint" style={{ marginTop: 10 }}>💡 {clarification.rationale}</p>
                      )}
                      <div className="row" style={{ marginTop: 10 }}>
                        <input
                          className="free-input"
                          value={freeText}
                          onChange={e => setFreeText(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter" && freeText.trim()) submitSelectedOutcomes(); }}
                          placeholder="Or type another outcome…"
                        />
                        <button className="primary" disabled={!selectedOutcomes.length && !freeText.trim()}
                          onClick={submitSelectedOutcomes}>
                          Continue with {Math.min(selectedOutcomes.length + (freeText.trim() ? 1 : 0), 2)} outcome(s) ➜
                        </button>
                      </div>
                      <p className="hint" style={{ marginTop: 6 }}>Pick up to 2 outcomes — the commentary will be written to match them.</p>
                    </>
                  ) : (
                    <>
                      <div className="chips">
                        {clarification.options.map(o => (
                          <button key={o} className="chip" onClick={() => {
                            const field = clarification.field || "outcome";
                            answer(field, o);
                          }}>{o}</button>
                        ))}
                      </div>
                      <div className="row" style={{ marginTop: 10 }}>
                        <input
                          className="free-input"
                          value={freeText}
                          onChange={e => setFreeText(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter" && freeText.trim()) answer(clarification.field || "outcome", freeText.trim()); }}
                          placeholder="Or type your own answer…"
                        />
                        <button className="primary" disabled={!freeText.trim()}
                          onClick={() => answer(clarification.field || "outcome", freeText.trim())}>
                          Answer ➜
                        </button>
                      </div>
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
