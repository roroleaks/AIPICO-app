"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { sget, resetSession, KEYS } from "@/lib/session";
import { WorkflowStepper } from "@/components/WorkflowStepper";
import type { PicoWord } from "@/lib/pico-roles";
import type { ScreenPayload } from "@/lib/deterministic-screen";
import type { ExcludedState } from "@/lib/session";
import {
  buildSummaryPayload,
  type ExploreSnapshot,
  type ChoiceState
} from "@/lib/summary-payload";

const CATEGORY_META = {
  established: {
    label: "Established knowledge",
    icon: "✅",
    borderColor: "#10b981",
    badgeBg: "#ecfdf5",
    badgeColor: "#047857"
  },
  conflicting: {
    label: "Conflicting evidence",
    icon: "⚖️",
    borderColor: "#f59e0b",
    badgeBg: "#fffbeb",
    badgeColor: "#b45309"
  },
  gap: {
    label: "Literature gap",
    icon: "🔍",
    borderColor: "#8b5cf6",
    badgeBg: "#f5f3ff",
    badgeColor: "#6d28d9"
  }
};

const ROLE_CONFIG: Record<string, { label: string; badge: string; bg: string; border: string; text: string; badgeBg: string }> = {
  population: {
    label: "Population (P)",
    badge: "P",
    bg: "#eff6ff",
    border: "#bfdbfe",
    text: "#1d4ed8",
    badgeBg: "#2563eb"
  },
  intervention: {
    label: "Intervention (I)",
    badge: "I",
    bg: "#f0fdf4",
    border: "#bbf7d0",
    text: "#15803d",
    badgeBg: "#16a34a"
  },
  comparator: {
    label: "Comparator (C)",
    badge: "C",
    bg: "#fefce8",
    border: "#fef08a",
    text: "#a16207",
    badgeBg: "#ca8a04"
  },
  outcome: {
    label: "Outcome (O)",
    badge: "O",
    bg: "#faf5ff",
    border: "#e9d5ff",
    text: "#7e22ce",
    badgeBg: "#9333ea"
  }
};

export default function SummaryPage() {
  const router = useRouter();
  const [words, setWords] = useState<PicoWord[] | null>(null);
  const [choice, setChoice] = useState<ChoiceState | null>(null);
  const [screenSnapshot, setScreenSnapshot] = useState<ScreenPayload | null>(null);
  const [exploreSnapshot, setExploreSnapshot] = useState<ExploreSnapshot | null>(null);
  const [excludedState, setExcludedState] = useState<ExcludedState | null>(null);

  const [exporting, setExporting] = useState<"pdf" | "docx" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const rawWords = sget<PicoWord[]>(KEYS.picoWords);
      if (!rawWords || !Array.isArray(rawWords) || rawWords.length < 3) {
        router.replace("/");
        return;
      }

      const rawChoice = sget<ChoiceState>(KEYS.choice);
      if (!rawChoice || !rawChoice.phrase || !rawChoice.category) {
        router.replace("/screen");
        return;
      }

      setWords(rawWords);
      setChoice(rawChoice);
      setScreenSnapshot(sget<ScreenPayload>(KEYS.screen));
      setExploreSnapshot(sget<ExploreSnapshot>(KEYS.explore));
      setExcludedState(sget<ExcludedState>(KEYS.excluded));
    }, 0);
    return () => clearTimeout(timer);
  }, [router]);

  const summaryData = useMemo(() => {
    if (!words || !choice) return null;
    return buildSummaryPayload(words, choice, screenSnapshot, exploreSnapshot, excludedState);
  }, [words, choice, screenSnapshot, exploreSnapshot, excludedState]);

  if (!words || !choice || !summaryData) {
    return (
      <div className="wrap">
        <header className="hdr">
          <h1>🧾 Step 4 · Workflow Summary</h1>
          <p>Consolidated clinical question, screening metrics, and prioritized evidence</p>
        </header>
        <WorkflowStepper currentStep={4} />
        <main id="main" className="solo">
          <section className="card">
            <p className="hint">Loading workflow summary…</p>
          </section>
        </main>
        <footer>Version 3.1 · Copyright©RaoufRoshdy2026</footer>
      </div>
    );
  }

  const meta = CATEGORY_META[choice.category] || CATEGORY_META.established;
  const papers = summaryData.papers;
  const excludedCount = excludedState?.userExcluded?.length ?? 0;

  // Screening stats availability
  const hasScreenStats = !!(screenSnapshot?.corpusStats || exploreSnapshot?.corpusStats);
  const retrievedDisplay = hasScreenStats ? String(summaryData.screeningStats.retrieved) : "not available";
  const screenedDisplay = hasScreenStats ? String(summaryData.screeningStats.screened) : "not available";

  const handleExport = async (format: "pdf" | "docx") => {
    if (papers.length === 0) return;
    setExporting(format);
    setExportError(null);

    try {
      const endpoint = format === "pdf" ? "/api/pdf" : "/api/docx";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: choice.phrase,
          workflow: summaryData
        })
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => null as { error?: string } | null);
        throw new Error(errorBody?.error || `Export failed with status ${res.status}`);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const safeTitle = choice.phrase
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "workflow-summary";

      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeTitle}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Document export failed. Please try again.";
      setExportError(msg);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="wrap">
      <header className="hdr">
        <h1>🧾 Step 4 · Workflow Summary</h1>
        <p>Consolidated clinical question, screening metrics, and prioritized evidence</p>
      </header>

      <WorkflowStepper currentStep={4} />

      <main id="main" className="solo">
        {/* Step 1 Card: Clinical Words (PICO) */}
        <section className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontSize: "0.84rem", fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              📝 Step 1 · Clinical Input Words
            </span>
            <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
              {words.length} terms role-tagged
            </span>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {words.map((w, idx) => {
              const conf = ROLE_CONFIG[w.role] || ROLE_CONFIG.population;
              return (
                <div
                  key={`${w.word}-${idx}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: conf.bg,
                    border: `1px solid ${conf.border}`,
                    padding: "5px 10px",
                    borderRadius: 6,
                    fontSize: "0.84rem"
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
                  <span style={{ fontWeight: 600, color: conf.text }}>{w.word}</span>
                  <span style={{ fontSize: "0.75rem", color: "#64748b" }}>({conf.label.split(" ")[0]})</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Step 2 Card: Chosen Phrase */}
        <section className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: "0.84rem", fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              🧭 Step 2 · Selected Clinical Focus
            </span>
            <span
              className="pill"
              style={{
                background: meta.badgeBg,
                color: meta.badgeColor,
                fontWeight: 700,
                fontSize: "0.84rem",
                padding: "4px 10px"
              }}
            >
              {meta.icon} {meta.label}
            </span>
          </div>

          <div
            style={{
              padding: "12px 16px",
              borderLeft: `4px solid ${meta.borderColor}`,
              backgroundColor: "#f8fafc",
              borderRadius: "0 8px 8px 0"
            }}
          >
            <p style={{ margin: 0, fontWeight: 700, fontSize: "1.05rem", color: "#0f172a", lineHeight: 1.45 }}>
              {choice.phrase}
            </p>
          </div>
        </section>

        {/* Step 3 Card: Screening and Exploration Metrics */}
        <section className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: "0.84rem", fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              📊 Step 3 · Screening & Exploration Metrics
            </span>
          </div>

          <p style={{ margin: 0, fontSize: "0.92rem", color: "#334155", lineHeight: 1.5 }}>
            Screened <strong>{screenedDisplay}</strong> of <strong>{retrievedDisplay}</strong> retrieved records · Excluded: <strong>{excludedCount}</strong>
          </p>
        </section>

        {/* Papers Under Consideration Section */}
        <section className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="pill" style={{ fontWeight: 700 }}>
                Papers under consideration ({papers.length})
              </span>
            </div>
            {papers.length > 0 && (
              <span style={{ fontSize: "0.78rem", color: "#64748b" }}>
                Ranked by computed relevance
              </span>
            )}
          </div>

          {papers.length === 0 ? (
            <div className="empty-state" role="alert" style={{ textAlign: "center", padding: "24px 16px" }}>
              <p className="empty-title">No papers currently under consideration</p>
              <p className="hint">Explore literature related to your chosen phrase or reset previous exclusions.</p>
              <div style={{ marginTop: 14 }}>
                <button className="primary" onClick={() => router.push("/explore")}>
                  ← Go to Step 3 Explorer
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {papers.map((p) => {
                const elementsStr = p.matchedElements.length > 0
                  ? `Matches: ${p.matchedElements.join(", ")}`
                  : "Broad clinical match";

                return (
                  <div
                    key={`paper-${p.rank}`}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      padding: "14px 16px",
                      background: "#ffffff"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            background: "#0f766e",
                            color: "#ffffff",
                            fontWeight: 700,
                            fontSize: "0.82rem",
                            padding: "3px 8px",
                            borderRadius: 6
                          }}
                        >
                          #{p.rank} · {p.relevancePct}% related
                        </span>
                        {p.design && (
                          <span
                            style={{
                              background: "#f1f5f9",
                              color: "#475569",
                              fontSize: "0.76rem",
                              fontWeight: 600,
                              padding: "2px 8px",
                              borderRadius: 4
                            }}
                          >
                            {p.design}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Paper Title (strictly without hyperlinks) */}
                    <h3 style={{ fontSize: "1rem", fontWeight: 700, margin: "4px 0 6px 0", color: "#0f172a", lineHeight: 1.4 }}>
                      {p.title}
                    </h3>

                    {/* Authors and Journal */}
                    <p style={{ margin: "0 0 6px 0", fontSize: "0.84rem", color: "#475569", lineHeight: 1.4 }}>
                      {p.authors ? `${p.authors}. ` : ""}
                      {p.journal ? <em>{p.journal}</em> : ""}
                      {p.year ? ` (${p.year})` : ""}
                    </p>

                    {/* Matched Elements basis */}
                    <div style={{ fontSize: "0.8rem", color: "#0d9488", fontWeight: 600 }}>
                      ✓ {elementsStr}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Excluded Papers Section */}
        <section className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: "0.84rem", fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              🚫 Excluded During Exploration
            </span>
          </div>

          <p style={{ margin: 0, fontSize: "0.92rem", color: "#475569" }}>
            {excludedCount === 0
              ? "Zero papers were excluded during exploration."
              : `${excludedCount} paper(s) excluded by researcher during exploration.`}
          </p>
        </section>

        {/* Error notification if export failed */}
        {exportError && (
          <section className="card" style={{ marginBottom: 16 }}>
            <div className="advisory">⚠️ {exportError}</div>
          </section>
        )}

        {/* Action Controls */}
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className="primary"
                onClick={() => void handleExport("pdf")}
                disabled={papers.length === 0 || exporting !== null}
                title={papers.length === 0 ? "Cannot export with empty papers list" : "Download PDF summary"}
              >
                {exporting === "pdf" ? "⏳ Exporting PDF…" : "⬇️ Export PDF"}
              </button>
              <button
                className="primary"
                onClick={() => void handleExport("docx")}
                disabled={papers.length === 0 || exporting !== null}
                title={papers.length === 0 ? "Cannot export with empty papers list" : "Download Word (.docx) summary"}
              >
                {exporting === "docx" ? "⏳ Exporting DOCX…" : "⬇️ Export DOCX"}
              </button>
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button className="secondary" onClick={() => router.push("/explore")}>
                ← Back to Step 3
              </button>
              <button
                className="link"
                onClick={() => {
                  resetSession();
                  router.replace("/");
                }}
              >
                Start over
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer>Version 3.1 · Copyright©RaoufRoshdy2026</footer>
    </div>
  );
}
