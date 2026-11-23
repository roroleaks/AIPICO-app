"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatedProcessingIndicator } from "@/components/AnimatedProcessingIndicator";
import { sget, sset, resetSession, KEYS, isMatchingScreenCache } from "@/lib/session";
import { NO_LITERATURE_MESSAGE, NO_LITERATURE_HINT } from "@/lib/clinical-keywords";
import { WorkflowStepper } from "@/components/WorkflowStepper";
import type { PicoWord } from "@/lib/pico-roles";
import type { ScreenCategory, ScreenPhrase, ScreenPayload } from "@/lib/deterministic-screen";

export default function ScreenPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [screenData, setScreenData] = useState<ScreenPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<ScreenCategory | null>(null);

  const fetchScreen = useCallback(async (force = false) => {
    const rawWords = sget<PicoWord[]>(KEYS.picoWords);
    if (!rawWords || !Array.isArray(rawWords) || rawWords.length < 3) {
      router.replace("/");
      return;
    }

    if (!force) {
      const cached = sget<ScreenPayload>(KEYS.screen);
      if (isMatchingScreenCache(cached, rawWords)) {
        setScreenData(cached);
        // Pre-select established knowledge if not already selected
        setSelectedCategory("established");
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "screen", words: rawWords })
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null as { error?: string } | null);
        setError(body?.error || `The screening service returned an error (${res.status}). Please try again.`);
        return;
      }

      const data: ScreenPayload = await res.json();
      setScreenData(data);
      sset(KEYS.screen, data);
      setSelectedCategory("established");
    } catch {
      setError("Network or server error during literature screening. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchScreen();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchScreen]);

  const handleContinue = () => {
    if (!screenData || !selectedCategory) return;
    const chosen = screenData.phrases[selectedCategory];
    if (!chosen) return;
    sset(KEYS.choice, {
      category: selectedCategory,
      phrase: chosen.phrase
    });
    router.push("/explore");
  };

  const isEmptyCorpus = screenData && screenData.corpusStats.retrieved === 0;

  return (
    <div className="wrap">
      <header className="hdr">
        <h1>🧭 Step 2 · Literature Screening</h1>
        <p>Three PICO question framings from the screened literature — established, conflicting, or a gap</p>
      </header>

      <WorkflowStepper currentStep={2} />

      <main id="main" className="solo">
        {(!screenData || loading) && !error && (
          <section className="card">
            <AnimatedProcessingIndicator
              message="Screening the literature for your words…"
              secondaryMessage="PubMed · Europe PMC · Cochrane CENTRAL · OpenAlex · Crossref · Semantic Scholar (~15–25 s)"
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 20 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ padding: "12px 14px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff" }}>
                  <div className="skeleton-box" style={{ height: 20, width: i % 2 === 0 ? "88%" : "95%", marginBottom: 8 }} />
                  <div className="skeleton-box" style={{ height: 14, width: i % 2 === 0 ? "55%" : "65%" }} />
                </div>
              ))}
            </div>
          </section>
        )}

        {error && (
          <section className="card">
            <div className="advisory">⚠️ {error}</div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="primary" onClick={() => { resetSession(); router.replace("/"); }}>← Back to start</button>
              <button className="secondary" onClick={() => fetchScreen(true)}>🔄 Try again</button>
            </div>
          </section>
        )}

        {isEmptyCorpus && (
          <section className="card">
            <div className="empty-state" role="alert" aria-live="polite">
              <p className="empty-title">{NO_LITERATURE_MESSAGE}</p>
              <p className="hint">{NO_LITERATURE_HINT}</p>
            </div>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="secondary" disabled={loading} onClick={() => fetchScreen(true)}>
                {loading ? "⏳ Screening…" : "🔄 Refresh screening"}
              </button>
              <button className="primary" onClick={() => { router.replace("/"); }}>
                ← Revise your words
              </button>
            </div>
          </section>
        )}

        {screenData && !isEmptyCorpus && (
          <section className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="pill" style={{ fontSize: "0.88rem", fontWeight: 600 }}>
                  Screened {screenData.corpusStats.screened} of {screenData.corpusStats.retrieved} retrieved records containing your words
                </span>
                <span className="pill" style={{ background: screenData.source === "ai" ? "#ecfdf5" : "#f1f5f9", color: screenData.source === "ai" ? "#065f46" : "#475569", fontWeight: 600 }}>
                  {screenData.source === "ai" ? "🤖 AI-assisted" : "📋 Deterministic"}
                </span>
              </div>
              <div className="row">
                <button className="secondary" disabled={loading} onClick={() => fetchScreen(true)}>
                  {loading ? "⏳ Refreshing…" : "🔄 Refresh screening"}
                </button>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Card 1: Established Knowledge */}
              {(() => {
                const item: ScreenPhrase = screenData.phrases.established;
                const isSel = selectedCategory === "established";
                return (
                  <div
                    className={`variant-card${isSel ? " selected" : ""}`}
                    role="radio"
                    aria-checked={isSel}
                    tabIndex={0}
                    onClick={() => setSelectedCategory("established")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedCategory("established");
                      }
                    }}
                    style={{
                      borderLeft: isSel ? "4px solid #059669" : "4px solid #10b981",
                      backgroundColor: isSel ? "#f0fdf4" : undefined
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 700, color: "#065f46", fontSize: "0.95rem" }}>
                          ✅ i — Established knowledge framing
                        </span>
                        <span className="pill" style={{ fontSize: "0.75rem", fontWeight: 600, background: item.signalStrength === "none" ? "#f1f5f9" : "#dcfce7", color: item.signalStrength === "none" ? "#64748b" : "#166534" }}>
                          Signal: {item.signalStrength || "none"}
                        </span>
                      </div>
                      <span className={`v-sel${isSel ? "" : " muted"}`}>
                        {isSel ? "✓ Selected" : "○ Select this framing"}
                      </span>
                    </div>
                    <p style={{ fontWeight: 700, fontSize: "1.05rem", lineHeight: 1.45, margin: "4px 0 8px 0", color: "#0f172a" }}>
                      {item.phrase}
                    </p>
                    <p style={{ fontSize: "0.88rem", color: "#64748b", margin: 0, lineHeight: 1.4 }}>
                      {item.basis}
                    </p>
                    {item.supportingRecordKeys && item.supportingRecordKeys.length > 0 && (
                      <p style={{ fontSize: "0.8rem", color: "#047857", margin: "6px 0 0 0", fontWeight: 500 }}>
                        Supporting records ({item.supportingRecordKeys.length}): {item.supportingRecordKeys.slice(0, 4).join(", ")}{item.supportingRecordKeys.length > 4 ? "…" : ""}
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Card 2: Conflicting Evidence */}
              {(() => {
                const item: ScreenPhrase = screenData.phrases.conflicting;
                const isSel = selectedCategory === "conflicting";
                return (
                  <div
                    className={`variant-card${isSel ? " selected" : ""}`}
                    role="radio"
                    aria-checked={isSel}
                    tabIndex={0}
                    onClick={() => setSelectedCategory("conflicting")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedCategory("conflicting");
                      }
                    }}
                    style={{
                      borderLeft: isSel ? "4px solid #d97706" : "4px solid #f59e0b",
                      backgroundColor: isSel ? "#fffbeb" : undefined
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 700, color: "#92400e", fontSize: "0.95rem" }}>
                          ⚖️ ii — Conflicting evidence framing
                        </span>
                        <span className="pill" style={{ fontSize: "0.75rem", fontWeight: 600, background: item.signalStrength === "none" ? "#f1f5f9" : "#fef3c7", color: item.signalStrength === "none" ? "#64748b" : "#92400e" }}>
                          Signal: {item.signalStrength || "none"}
                        </span>
                      </div>
                      <span className={`v-sel${isSel ? "" : " muted"}`}>
                        {isSel ? "✓ Selected" : "○ Select this framing"}
                      </span>
                    </div>
                    <p style={{ fontWeight: 700, fontSize: "1.05rem", lineHeight: 1.45, margin: "4px 0 8px 0", color: "#0f172a" }}>
                      {item.phrase}
                    </p>
                    <p style={{ fontSize: "0.88rem", color: "#64748b", margin: 0, lineHeight: 1.4 }}>
                      {item.basis}
                    </p>
                    {item.supportingRecordKeys && item.supportingRecordKeys.length > 0 && (
                      <p style={{ fontSize: "0.8rem", color: "#b45309", margin: "6px 0 0 0", fontWeight: 500 }}>
                        Supporting records ({item.supportingRecordKeys.length}): {item.supportingRecordKeys.slice(0, 4).join(", ")}{item.supportingRecordKeys.length > 4 ? "…" : ""}
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Card 3: Research Gap */}
              {(() => {
                const item: ScreenPhrase = screenData.phrases.gap;
                const isSel = selectedCategory === "gap";
                return (
                  <div
                    className={`variant-card${isSel ? " selected" : ""}`}
                    role="radio"
                    aria-checked={isSel}
                    tabIndex={0}
                    onClick={() => setSelectedCategory("gap")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedCategory("gap");
                      }
                    }}
                    style={{
                      borderLeft: isSel ? "4px solid #7c3aed" : "4px solid #8b5cf6",
                      backgroundColor: isSel ? "#faf5ff" : undefined
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 700, color: "#5b21b6", fontSize: "0.95rem" }}>
                          🔍 iii — Research gap framing
                        </span>
                        <span className="pill" style={{ fontSize: "0.75rem", fontWeight: 600, background: item.signalStrength === "none" ? "#f1f5f9" : "#f3e8ff", color: item.signalStrength === "none" ? "#64748b" : "#6b21a8" }}>
                          Signal: {item.signalStrength || "none"}
                        </span>
                      </div>
                      <span className={`v-sel${isSel ? "" : " muted"}`}>
                        {isSel ? "✓ Selected" : "○ Select this framing"}
                      </span>
                    </div>
                    <p style={{ fontWeight: 700, fontSize: "1.05rem", lineHeight: 1.45, margin: "4px 0 8px 0", color: "#0f172a" }}>
                      {item.phrase}
                    </p>
                    <p style={{ fontSize: "0.88rem", color: "#64748b", margin: 0, lineHeight: 1.4 }}>
                      {item.basis}
                    </p>
                    {item.supportingRecordKeys && item.supportingRecordKeys.length > 0 && (
                      <p style={{ fontSize: "0.8rem", color: "#7e22ce", margin: "6px 0 0 0", fontWeight: 500 }}>
                        Supporting records ({item.supportingRecordKeys.length}): {item.supportingRecordKeys.slice(0, 4).join(", ")}{item.supportingRecordKeys.length > 4 ? "…" : ""}
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="row" style={{ marginTop: 20 }}>
              <button
                className="primary"
                disabled={!selectedCategory}
                onClick={handleContinue}
              >
                Continue to Explorer →
              </button>
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="link"
                onClick={() => {
                  resetSession();
                  router.replace("/");
                }}
              >
                ← Start over
              </button>
            </div>
          </section>
        )}
      </main>
      <footer>Version 3.1 · Copyright©RaoufRoshdy2026</footer>
    </div>
  );
}
