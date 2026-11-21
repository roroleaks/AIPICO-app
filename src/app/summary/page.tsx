"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { sget, sset, resetSession, KEYS } from "@/lib/session";
import { WorkflowStepper } from "@/components/WorkflowStepper";
import type { PicoWord } from "@/lib/pico-roles";
import type { ScreenPayload } from "@/lib/deterministic-screen";
import type { ExcludedState } from "@/lib/session";
import type { CitationStyle } from "@/lib/citation-formatter";
import {
  composeManuscript,
  type ManuscriptData
} from "@/lib/manuscript-composer";
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

  const [style, setStyle] = useState<CitationStyle>("vancouver");
  const [aiManuscript, setAiManuscript] = useState<ManuscriptData | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichNotice, setEnrichNotice] = useState<string | null>(null);

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

      const savedStyle = sget<CitationStyle>(KEYS.style) || "vancouver";
      setStyle(savedStyle);

      setWords(rawWords);
      setChoice(rawChoice);
      setScreenSnapshot(sget<ScreenPayload>(KEYS.screen));
      setExploreSnapshot(sget<ExploreSnapshot>(KEYS.explore));
      setExcludedState(sget<ExcludedState>(KEYS.excluded));
    }, 0);
    return () => clearTimeout(timer);
  }, [router]);

  // Derive deterministic manuscript directly via useMemo without cascading effects
  const deterministicManuscript = useMemo(() => {
    if (!words || !choice) return null;
    const stats = {
      retrieved: screenSnapshot?.corpusStats?.retrieved ?? exploreSnapshot?.corpusStats?.retrieved ?? 0,
      screened: screenSnapshot?.corpusStats?.screened ?? exploreSnapshot?.corpusStats?.screened ?? 0,
      relaxationLevel: screenSnapshot?.corpusStats?.relaxationLevel ?? 0,
      excludedCount: excludedState?.userExcluded?.length ?? 0
    };
    return composeManuscript({
      words,
      category: choice.category,
      phrase: choice.phrase,
      screeningStats: stats,
      records: exploreSnapshot?.records || [],
      userExcluded: excludedState?.userExcluded || [],
      style
    });
  }, [words, choice, screenSnapshot, exploreSnapshot, excludedState, style]);

  const manuscript = aiManuscript && aiManuscript.citationStyle === style
    ? aiManuscript
    : deterministicManuscript;

  const handleStyleChange = (newStyle: CitationStyle) => {
    if (newStyle === style) return;
    setStyle(newStyle);
    sset(KEYS.style, newStyle);
    setEnrichNotice(null);
  };

  const handleAiEnrich = async () => {
    if (!words || !choice || enriching) return;
    setEnriching(true);
    setEnrichNotice(null);

    try {
      const stats = {
        retrieved: screenSnapshot?.corpusStats?.retrieved ?? exploreSnapshot?.corpusStats?.retrieved ?? 0,
        screened: screenSnapshot?.corpusStats?.screened ?? exploreSnapshot?.corpusStats?.screened ?? 0,
        relaxationLevel: screenSnapshot?.corpusStats?.relaxationLevel ?? 0,
        excludedCount: excludedState?.userExcluded?.length ?? 0
      };

      const res = await fetch("/api/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "compose",
          words,
          category: choice.category,
          phrase: choice.phrase,
          screeningStats: stats,
          records: exploreSnapshot?.records || [],
          userExcluded: excludedState?.userExcluded || [],
          style
        })
      });

      if (!res.ok) {
        throw new Error(`Enrichment service responded with status ${res.status}`);
      }

      const data = (await res.json()) as ManuscriptData;
      if (data && data.sections) {
        setAiManuscript(data);
        if (data.aiEnriched) {
          setEnrichNotice("✨ Narrative prose successfully enriched by scientific editor model.");
        } else {
          setEnrichNotice("Deterministic draft preserved (enrichment unavailable or rejected by verification gates).");
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "AI enrichment service unavailable.";
      setEnrichNotice(`⚠️ AI enrichment failed: ${msg}. Retained verified deterministic draft.`);
    } finally {
      setEnriching(false);
    }
  };

  const summaryData = useMemo(() => {
    if (!words || !choice) return null;
    return buildSummaryPayload(words, choice, screenSnapshot, exploreSnapshot, excludedState, manuscript);
  }, [words, choice, screenSnapshot, exploreSnapshot, excludedState, manuscript]);

  if (!words || !choice || !summaryData || !manuscript) {
    return (
      <div className="wrap">
        <header className="hdr">
          <h1>🧾 Step 4 · Scientific Manuscript</h1>
          <p>Publication-grade narrative evidence synthesis draft with multi-style citations</p>
        </header>
        <WorkflowStepper currentStep={4} />
        <main id="main" className="solo">
          <section className="card">
            <p className="hint">Loading manuscript draft…</p>
          </section>
        </main>
        <footer>Version 3.1 · Copyright©RaoufRoshdy2026</footer>
      </div>
    );
  }

  const meta = CATEGORY_META[choice.category] || CATEGORY_META.established;
  const papers = summaryData.papers;
  const excludedCount = excludedState?.userExcluded?.length ?? 0;

  const hasScreenStats = !!(screenSnapshot?.corpusStats || exploreSnapshot?.corpusStats);
  const retrievedDisplay = hasScreenStats ? String(summaryData.screeningStats.retrieved) : "not available";
  const screenedDisplay = hasScreenStats ? String(summaryData.screeningStats.screened) : "not available";

  const handleExport = async (format: "pdf" | "docx") => {
    if (papers.length === 0 && (!manuscript.sections || manuscript.sections.length === 0)) return;
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
        .slice(0, 60) || "scientific-manuscript";

      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeTitle}-${style}.${format}`;
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
        <h1>🧾 Step 4 · Scientific Manuscript</h1>
        <p>Publication-grade narrative evidence synthesis draft with multi-style citations</p>
      </header>

      <WorkflowStepper currentStep={4} />

      <main id="main" className="solo">
        {/* Compact Workflow Summary Strip */}
        <section className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              🔍 Workflow Context Snapshot
            </span>
            <span
              className="pill"
              style={{
                background: meta.badgeBg,
                color: meta.badgeColor,
                fontWeight: 700,
                fontSize: "0.82rem",
                padding: "3px 8px"
              }}
            >
              {meta.icon} {meta.label}
            </span>
          </div>

          {/* PICO Chips */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {words.map((w, idx) => {
              const conf = ROLE_CONFIG[w.role] || ROLE_CONFIG.population;
              return (
                <div
                  key={`${w.word}-${idx}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    background: conf.bg,
                    border: `1px solid ${conf.border}`,
                    padding: "3px 8px",
                    borderRadius: 5,
                    fontSize: "0.8rem"
                  }}
                >
                  <span
                    style={{
                      background: conf.badgeBg,
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: "0.68rem",
                      padding: "1px 5px",
                      borderRadius: 3
                    }}
                  >
                    {conf.badge}
                  </span>
                  <span style={{ fontWeight: 600, color: conf.text }}>{w.word}</span>
                </div>
              );
            })}
          </div>

          {/* Phrase & Screening Stats */}
          <div style={{ fontSize: "0.88rem", color: "#334155", lineHeight: 1.45 }}>
            <strong>Inquiry Focus:</strong> {choice.phrase}
          </div>
          <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: 4 }}>
            Screened <strong>{screenedDisplay}</strong> of <strong>{retrievedDisplay}</strong> records · Excluded: <strong>{excludedCount}</strong> · Prioritized for synthesis: <strong>{papers.length}</strong>
          </div>
        </section>

        {/* Style Selector & AI Enrichment Action Bar */}
        <section className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            {/* Citation Style Selector */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.84rem", fontWeight: 700, color: "#1e293b" }}>
                Citation Style:
              </span>
              <div style={{ display: "inline-flex", borderRadius: 6, border: "1px solid #cbd5e1", overflow: "hidden" }}>
                {(["vancouver", "apa", "harvard"] as const).map(s => {
                  const active = style === s;
                  const label = s === "vancouver" ? "Vancouver" : s === "apa" ? "APA 7th" : "Harvard";
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleStyleChange(s)}
                      style={{
                        padding: "6px 14px",
                        fontSize: "0.82rem",
                        fontWeight: active ? 700 : 500,
                        background: active ? "#0f766e" : "#f8fafc",
                        color: active ? "#ffffff" : "#475569",
                        border: "none",
                        borderRight: s !== "harvard" ? "1px solid #cbd5e1" : "none",
                        cursor: "pointer",
                        transition: "background 0.15s ease"
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* AI Enrichment Trigger */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {manuscript.aiEnriched && (
                <span
                  style={{
                    background: "#ecfdf5",
                    color: "#047857",
                    border: "1px solid #a7f3d0",
                    padding: "4px 8px",
                    borderRadius: 4,
                    fontSize: "0.78rem",
                    fontWeight: 600
                  }}
                >
                  ✨ AI-Enriched Prose
                </span>
              )}
              <button
                type="button"
                className="secondary"
                onClick={handleAiEnrich}
                disabled={enriching}
                style={{ fontSize: "0.82rem", padding: "6px 12px" }}
              >
                {enriching ? "⏳ Refining prose…" : "✨ Enrich narrative (AI)"}
              </button>
            </div>
          </div>

          {enrichNotice && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 12px",
                borderRadius: 6,
                fontSize: "0.82rem",
                background: enrichNotice.includes("⚠️") ? "#fffbeb" : "#f0fdf4",
                color: enrichNotice.includes("⚠️") ? "#92400e" : "#166534",
                border: `1px solid ${enrichNotice.includes("⚠️") ? "#fef3c7" : "#bbf7d0"}`
              }}
            >
              {enrichNotice}
            </div>
          )}
        </section>

        {/* Narrative Manuscript Card */}
        <article className="card" style={{ marginBottom: 16, padding: "28px 32px" }}>
          {/* Manuscript Title */}
          <h2 style={{ fontSize: "1.45rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.35, marginBottom: 16 }}>
            {manuscript.title}
          </h2>

          {/* Abstract Block */}
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderLeft: "4px solid #0f766e",
              borderRadius: "0 8px 8px 0",
              padding: "16px 20px",
              marginBottom: 24
            }}
          >
            <h3 style={{ fontSize: "0.92rem", fontWeight: 700, color: "#0f766e", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 10px 0" }}>
              Abstract
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: "0.9rem", color: "#334155", lineHeight: 1.55 }}>
              {manuscript.abstract.map((sent, idx) => (
                <p key={`abs-${idx}`} style={{ margin: 0 }}>
                  {sent}
                </p>
              ))}
            </div>
          </div>

          {/* Manuscript Sections */}
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            {manuscript.sections.map((sec, sIdx) => (
              <section key={`sec-${sIdx}`} style={{ borderBottom: sIdx < manuscript.sections.length - 1 ? "1px solid #f1f5f9" : "none", paddingBottom: 18 }}>
                <h3 style={{ fontSize: "1.12rem", fontWeight: 700, color: "#0f766e", marginBottom: 10, letterSpacing: "-0.01em" }}>
                  {sec.heading}
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {sec.paragraphs.map((p, pIdx) => {
                    const isAuthorNote = p.includes("[Author note:");
                    if (isAuthorNote) {
                      return (
                        <div
                          key={`p-${sIdx}-${pIdx}`}
                          style={{
                            background: "#fffbeb",
                            border: "1px dashed #f59e0b",
                            borderRadius: 6,
                            padding: "10px 14px",
                            fontSize: "0.85rem",
                            color: "#92400e",
                            fontStyle: "italic",
                            lineHeight: 1.45
                          }}
                        >
                          ✍️ {p}
                        </div>
                      );
                    }
                    return (
                      <p key={`p-${sIdx}-${pIdx}`} style={{ margin: 0, fontSize: "0.93rem", color: "#1e293b", lineHeight: 1.65 }}>
                        {p}
                      </p>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          {/* References Section */}
          <section style={{ marginTop: 28, paddingTop: 20, borderTop: "2px solid #e2e8f0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ fontSize: "1.12rem", fontWeight: 700, color: "#0f766e", margin: 0 }}>
                References ({style.toUpperCase()})
              </h3>
              <span style={{ fontSize: "0.78rem", color: "#64748b" }}>
                {manuscript.references.length} prioritized source(s)
              </span>
            </div>

            {manuscript.references.length === 0 ? (
              <p style={{ fontSize: "0.88rem", color: "#64748b", fontStyle: "italic", margin: 0 }}>
                Zero references retained for synthesis.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: "0.84rem", color: "#1e293b", lineHeight: 1.5 }}>
                {manuscript.references.map((refText, rIdx) => (
                  <div key={`ref-${rIdx}`} style={{ padding: "4px 0" }}>
                    {refText}
                  </div>
                ))}
              </div>
            )}
          </section>
        </article>

        {/* Error notification if export failed */}
        {exportError && (
          <section className="card" style={{ marginBottom: 16 }}>
            <div className="advisory">⚠️ {exportError}</div>
          </section>
        )}

        {/* Export & Navigation Controls */}
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className="primary"
                onClick={() => void handleExport("pdf")}
                disabled={papers.length === 0 || exporting !== null}
                title={papers.length === 0 ? "Cannot export with empty papers list" : `Download PDF manuscript (${style.toUpperCase()})`}
              >
                {exporting === "pdf" ? "⏳ Exporting PDF…" : `⬇️ Export PDF (${style.toUpperCase()})`}
              </button>
              <button
                className="primary"
                onClick={() => void handleExport("docx")}
                disabled={papers.length === 0 || exporting !== null}
                title={papers.length === 0 ? "Cannot export with empty papers list" : `Download Word (.docx) manuscript (${style.toUpperCase()})`}
              >
                {exporting === "docx" ? "⏳ Exporting DOCX…" : `⬇️ Export DOCX (${style.toUpperCase()})`}
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
