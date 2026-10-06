"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatedProcessingIndicator } from "@/components/AnimatedProcessingIndicator";
import { KB, type Analysis, type Formulation, type SpecialtyKey } from "@/lib/kb";
import {
  buildOutcomeContext,
  selectOutcomes
} from "@/lib/outcome-selection";
import { sget, sset, KEYS } from "@/lib/session";
import { readSessionInput, sessionSearchText } from "@/lib/clinical-input";
import { extractPicoFromQuestion, type ExtractedPico } from "@/lib/pico-parser";

interface GapSnapshot {
  topic?: string;
  specialty?: string;
  known?: Array<{ point?: string; references?: Array<{ title?: string }> }>;
  uncertain?: Array<{ point?: string; references?: Array<{ title?: string }> }>;
  gaps?: Array<{ gap?: string }>;
  suggestedQuestions?: Array<{ question: string; rationale: string }>;
}

interface RenderedOutcome {
  id: string;
  label: string;
  category: string;
  rationale: string;
}

export default function QuestionPage() {
  const router = useRouter();
  const [extractedPico, setExtractedPico] = useState<ExtractedPico | null>(null);
  const [outcomeOptions, setOutcomeOptions] = useState<RenderedOutcome[]>([]);
  const [recommendedId, setRecommendedId] = useState<string>("");
  const [recommendedRationale, setRecommendedRationale] = useState<string>("");
  const [selectedOutcome, setSelectedOutcome] = useState<string>("");
  const [customOutcome, setCustomOutcome] = useState<string>("");
  const [busy, setBusy] = useState<"loading" | "formulate" | null>("loading");
  const [notice, setNotice] = useState<string | null>(null);

  // Collect literature keywords from Step 2 evidence map
  const getLiteratureKeywords = useCallback((): string[] => {
    const gapSnapshot = sget<GapSnapshot>(KEYS.gap);
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
  }, []);

  const finishAndGo = useCallback((f: Formulation, chosenOutcome: string) => {
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
    sset(KEYS.outcomes, [chosenOutcome]);
    sset("cq_outcome", chosenOutcome);
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(KEYS.commentary);
    }
    router.push("/paper");
  }, [router]);

  // Formulate PICO and navigate immediately to Step 4
  const proceedToCommentary = useCallback(async (chosenOutcome: string) => {
    if (!extractedPico || !chosenOutcome) return;
    setBusy("formulate");

    const a: Analysis = {
      specialty: extractedPico.specialty,
      specialtyLabel: KB[extractedPico.specialty].label,
      condition: extractedPico.condition,
      intervention: extractedPico.intervention,
      comparator: extractedPico.comparator,
      questionType: "Therapy / Prevention",
      framework: "PICO",
      missing: [],
      interpretation: `PICO targeting ${extractedPico.condition} with ${extractedPico.intervention} vs ${extractedPico.comparator}`,
      source: "rules"
    };

    const ans: Record<string, string> = {
      condition: extractedPico.condition,
      intervention: extractedPico.intervention,
      comparator: extractedPico.comparator,
      outcome: chosenOutcome
    };

    const { ruleFormulate } = await import("@/lib/rule-engine");
    let f: Formulation = ruleFormulate(a, ans);

    try {
      const res = await fetch("/api/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "formulate",
          analysis: a,
          answered: ans,
          selectedQuestion: extractedPico.cleanQuestion
        }),
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const parsed = await res.json();
        if (parsed && parsed.finalQuestion && !parsed.error) {
          f = parsed;
        }
      }
    } catch {
      // ruleFormulate fallback is already complete and verified
    }

    finishAndGo(f, chosenOutcome);
  }, [extractedPico, finishAndGo]);

  useEffect(() => {
    let isCancelled = false;
    const timer = setTimeout(() => {
      if (isCancelled) return;
      try {
        const question = sget<string>(KEYS.question);
        const gapSnapshot = sget<GapSnapshot>(KEYS.gap);
        const normalized = sget<string>(KEYS.inputText);
        const stored = readSessionInput(sget<unknown>(KEYS.input));
        const fallbackText = question
          || gapSnapshot?.suggestedQuestions?.[0]?.question
          || normalized
          || (stored ? sessionSearchText(stored) : "");

        if (!fallbackText) {
          router.replace("/");
          return;
        }

        // Extract guaranteed P, I, C, O elements from selected PICO question and evidence map
        const pico = extractPicoFromQuestion(
          fallbackText,
          gapSnapshot?.topic || normalized || "",
          gapSnapshot?.specialty as SpecialtyKey | undefined
        );
        setExtractedPico(pico);

        // Build literature-grounded outcome options
        const literatureKw = getLiteratureKeywords();
        const context = buildOutcomeContext(
          {
            specialty: pico.specialty,
            condition: pico.condition,
            intervention: pico.intervention,
            comparator: pico.comparator,
            questionType: "Therapy / Prevention"
          },
          {},
          {
            originalInput: normalized || gapSnapshot?.topic || fallbackText,
            population: pico.condition,
            keywords: literatureKw
          }
        );

        const selection = selectOutcomes(context);
        let options: RenderedOutcome[] = selection.options.map(o => ({
          id: o.id,
          label: o.label,
          category: o.category,
          rationale: o.rationale
        }));

        // Ensure 4 to 6 options are present
        if (options.length < 4) {
          const ranked = KB[pico.specialty].outcomesRanked;
          for (const r of ranked) {
            if (!options.some(o => o.label.toLowerCase() === r.toLowerCase())) {
              options.push({
                id: r.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
                label: r,
                category: "clinical",
                rationale: `Standard outcome for ${KB[pico.specialty].label} clinical questions.`
              });
            }
            if (options.length >= 6) break;
          }
        }
        options = options.slice(0, 6);

        setOutcomeOptions(options);
        setRecommendedId(selection.recommendedOutcome.id);
        setRecommendedRationale(selection.recommendedOutcome.rationale);

        // Pre-select the recommended primary outcome so the clinician can proceed in 1 click
        const initialPick = options.find(o => o.id === selection.recommendedOutcome.id)?.label || options[0]?.label || "";
        setSelectedOutcome(initialPick);

        setBusy(null);
      } catch (err: unknown) {
        setNotice(err instanceof Error ? err.message : "Error extracting clinical outcomes.");
        setBusy(null);
      }
    }, 0);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [getLiteratureKeywords, router]);

  return (
    <div className="wrap">
      <header className="hdr">
        <h1>🎯 Step 3 · Select Clinical Outcome</h1>
        <p>Selected PICO question loaded from Evidence Map — choose 1 outcome to generate your commentary paper</p>
      </header>

      <main className="solo">
        {extractedPico && (
          <section className="card">
            <span className="pill">💡 Target PICO Question · {KB[extractedPico.specialty]?.label || "Obstetrics & Gynecology"}</span>
            <div className="final-q" style={{ marginTop: 10, marginBottom: 12 }}>
              <b>{extractedPico.cleanQuestion}</b>
            </div>
            <div className="row" style={{ gap: 8, marginTop: 4 }}>
              <span className="tag" title="Population">👥 <b>P:</b> {extractedPico.condition}</span>
              <span className="tag" title="Intervention">💊 <b>I:</b> {extractedPico.intervention}</span>
              <span className="tag" title="Comparator">⚖️ <b>C:</b> {extractedPico.comparator}</span>
            </div>
          </section>
        )}

        {notice && (
          <section className="card"><div className="advisory">⚠️ {notice}</div></section>
        )}

        {outcomeOptions.length > 0 && busy !== "formulate" && (
          <section className="card">
            <h3 className="sec-h" style={{ marginTop: 0 }}>
              📋 Literature-Derived Outcomes — Click 1 to continue (No manual typing needed)
            </h3>
            <p className="hint">
              These 4–6 outcomes are ranked by clinical importance and grounded in current PubMed evidence. Click an outcome card below to select it.
            </p>

            <div className="chips outcome-chips" role="group" aria-label="Outcome options" style={{ marginTop: 14 }}>
              {outcomeOptions.map(opt => {
                const isSel = selectedOutcome === opt.label;
                const isRec = opt.id === recommendedId;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`chip outcome-chip ${isSel ? "chip-on" : ""} ${isRec ? "chip-recommended" : ""}`}
                    aria-pressed={isSel}
                    aria-label={`${opt.label}${isRec ? ", recommended primary outcome" : ""}`}
                    onClick={() => setSelectedOutcome(opt.label)}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                      <span className="outcome-chip-label">{opt.label}</span>
                      {isSel && (
                        <span style={{ fontWeight: 700, fontSize: "0.85rem", color: isSel ? "#fff" : "inherit" }}>
                          ✓ Selected
                        </span>
                      )}
                    </div>
                    <span className="outcome-chip-meta">
                      {isRec && <span className="outcome-badge">Recommended</span>}
                      <span className="outcome-category">{opt.category.replace(/-/g, " ")}</span>
                    </span>
                    <span className="outcome-why">{opt.rationale}</span>
                  </button>
                );
              })}
            </div>

            {recommendedRationale && (
              <p className="hint" style={{ marginTop: 14 }}>
                💡 <b>Evidence Grounding:</b> {recommendedRationale}
              </p>
            )}

            <div className="row" style={{ marginTop: 16 }}>
              <button
                className="primary"
                style={{ padding: "12px 28px", fontSize: "1rem" }}
                disabled={!selectedOutcome || !!busy}
                onClick={() => selectedOutcome && proceedToCommentary(selectedOutcome)}
              >
                {selectedOutcome
                  ? `Continue to Scientific Commentary with "${selectedOutcome}" ➜`
                  : "Click an outcome card above to continue ➜"}
              </button>
            </div>

            <p className="hint" style={{ marginTop: 8 }} aria-live="polite">
              {selectedOutcome
                ? `Selected outcome: "${selectedOutcome}". Click above to immediately generate your Step 4 Scientific Commentary Paper.`
                : "Select one outcome card above to proceed."}
            </p>

            <div style={{ marginTop: 24, paddingTop: 18, borderTop: "1px solid var(--border, #e2e8f0)" }}>
              <h4 style={{ margin: "0 0 8px 0", fontSize: "0.95rem", color: "var(--text-muted, #64748b)" }}>
                ✏️ Or Enter a Custom Outcome (Optional)
              </h4>
              <p className="hint" style={{ marginBottom: 10 }}>
                If you prefer an endpoint not listed in the cards above, type it below and click Continue.
              </p>
              <div className="row" style={{ gap: 10, alignItems: "center" }}>
                <input
                  className="free-input"
                  type="text"
                  aria-label="Custom clinical outcome"
                  value={customOutcome}
                  onChange={(e) => setCustomOutcome(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customOutcome.trim()) {
                      e.preventDefault();
                      proceedToCommentary(customOutcome.trim());
                    }
                  }}
                  placeholder="e.g., spontaneous preterm birth before 32 weeks, neonatal ICU stay..."
                  style={{ flex: 1, padding: "10px 14px" }}
                />
                <button
                  className="secondary"
                  style={{ whiteSpace: "nowrap", padding: "10px 18px" }}
                  disabled={!customOutcome.trim() || !!busy}
                  onClick={() => customOutcome.trim() && proceedToCommentary(customOutcome.trim())}
                >
                  Continue with Custom Outcome ➜
                </button>
              </div>
            </div>
          </section>
        )}

        {busy === "loading" && (
          <section className="card">
            <AnimatedProcessingIndicator
              message="Extracting PICO parameters & literature outcomes…"
              secondaryMessage="Analyzing PubMed evidence to curate relevant clinical endpoints."
            />
          </section>
        )}

        {busy === "formulate" && (
          <section className="card">
            <AnimatedProcessingIndicator
              message="Formulating clinical question & evidence parameters…"
              secondaryMessage="Preparing Vancouver-style commentary generation."
            />
          </section>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          <button className="link" onClick={() => router.push("/gap")}>← Back to Evidence Map</button>
          <button className="link" onClick={() => router.push("/")}>← Start over</button>
        </div>
      </main>

      <footer>Version 3.1 · Copyright©RaoufRoshdy2026</footer>
    </div>
  );
}
