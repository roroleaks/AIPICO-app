"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatedProcessingIndicator } from "@/components/AnimatedProcessingIndicator";
import { sget, sset, resetSession, KEYS, isMatchingExploreCache, type ExcludedState } from "@/lib/session";
import { NO_LITERATURE_MESSAGE, NO_LITERATURE_HINT } from "@/lib/clinical-keywords";
import { WorkflowStepper } from "@/components/WorkflowStepper";
import type { ExploreRecord } from "@/lib/explore-scoring";

interface ChoiceSession {
  category: "established" | "conflicting" | "gap";
  phrase: string;
}

interface ExploreResponse {
  records: ExploreRecord[];
  corpusStats: {
    retrieved: number;
    screened: number;
    blocked: number;
    returned: number;
  };
  hasMore: boolean;
}

const CATEGORY_META = {
  established: {
    label: "✅ i — Established knowledge",
    badgeBg: "#ecfdf5",
    badgeColor: "#065f46",
    borderColor: "#10b981"
  },
  conflicting: {
    label: "⚖️ ii — Conflicting evidence",
    badgeBg: "#fffbeb",
    badgeColor: "#92400e",
    borderColor: "#f59e0b"
  },
  gap: {
    label: "🔍 iii — Research gap",
    badgeBg: "#faf5ff",
    badgeColor: "#5b21b6",
    borderColor: "#8b5cf6"
  }
};

const ELEMENT_LABELS: Record<string, string> = {
  P: "Population",
  I: "Intervention",
  C: "Comparator",
  O: "Outcome"
};

function getRecordKey(r: ExploreRecord): string {
  if (r.pmid) return "p:" + r.pmid.trim();
  if (r.doi) return "d:" + r.doi.toLowerCase().replace(/^https?:\/\/doi\.org\//, "").trim();
  const t = (r.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return "t:" + t.slice(0, 50);
}

export default function ExplorePage() {
  const router = useRouter();
  const [choice, setChoice] = useState<ChoiceSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [exploreData, setExploreData] = useState<ExploreResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userExcluded, setUserExcluded] = useState<string[]>([]);
  const [seen, setSeen] = useState<string[]>([]);

  // Initialize or read exclusion state from session
  const getOrInitExcluded = useCallback((currentChoice: ChoiceSession): ExcludedState => {
    const stored = sget<ExcludedState>(KEYS.excluded);
    if (stored && stored.phrase === currentChoice.phrase && stored.category === currentChoice.category) {
      return stored;
    }
    const fresh: ExcludedState = {
      phrase: currentChoice.phrase,
      category: currentChoice.category,
      userExcluded: [],
      seen: []
    };
    sset(KEYS.excluded, fresh);
    return fresh;
  }, []);

  const fetchExplore = useCallback(async (
    targetChoice: ChoiceSession,
    activeExcluded: string[],
    activeSeen: string[],
    force = false
  ) => {
    if (!force) {
      const cached = sget<ExploreResponse & { phrase: string; category: string }>(KEYS.explore);
      if (isMatchingExploreCache(cached, targetChoice)) {
        setExploreData(cached);
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "explore",
          phrase: targetChoice.phrase,
          category: targetChoice.category,
          userExcluded: activeExcluded,
          seen: activeSeen
        })
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null as { error?: string } | null);
        setError(body?.error || `The exploration service returned an error (${res.status}). Please try again.`);
        return;
      }

      const data: ExploreResponse = await res.json();
      const snapshot = {
        ...data,
        phrase: targetChoice.phrase,
        category: targetChoice.category
      };
      setExploreData(snapshot);
      sset(KEYS.explore, snapshot);

      // Append newly returned keys to seen state in session after cards are available
      const newKeys = (data.records || []).map(getRecordKey);
      const updatedSeen = Array.from(new Set([...activeSeen, ...newKeys]));
      setSeen(updatedSeen);
      sset(KEYS.excluded, {
        phrase: targetChoice.phrase,
        category: targetChoice.category,
        userExcluded: activeExcluded,
        seen: updatedSeen
      });
    } catch {
      setError("Network or server error during evidence exploration. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const storedChoice = sget<ChoiceSession>(KEYS.choice);
      const storedWords = sget<unknown[]>(KEYS.picoWords);

      if (!storedWords || !Array.isArray(storedWords) || storedWords.length < 3) {
        router.replace("/");
        return;
      }
      if (!storedChoice || !storedChoice.phrase || !storedChoice.category) {
        router.replace("/screen");
        return;
      }

      setChoice(storedChoice);
      const excl = getOrInitExcluded(storedChoice);
      setUserExcluded(excl.userExcluded || []);
      setSeen(excl.seen || []);

      void fetchExplore(storedChoice, excl.userExcluded || [], excl.seen || [], false);
    }, 0);
    return () => clearTimeout(timer);
  }, [router, getOrInitExcluded, fetchExplore]);

  const handleExcludeCard = (record: ExploreRecord) => {
    if (!choice || !exploreData) return;
    const key = getRecordKey(record);
    const nextExcluded = Array.from(new Set([...userExcluded, key]));
    setUserExcluded(nextExcluded);

    // Save updated exclusion state
    sset(KEYS.excluded, {
      phrase: choice.phrase,
      category: choice.category,
      userExcluded: nextExcluded,
      seen
    });

    // Remove the card immediately from local view
    const filteredRecords = exploreData.records.filter(r => getRecordKey(r) !== key);
    const updatedData: ExploreResponse = {
      ...exploreData,
      records: filteredRecords,
      corpusStats: {
        ...exploreData.corpusStats,
        returned: filteredRecords.length
      }
    };
    setExploreData(updatedData);
    sset(KEYS.explore, {
      ...updatedData,
      phrase: choice.phrase,
      category: choice.category
    });
  };

  const handleReRun = () => {
    if (!choice) return;
    void fetchExplore(choice, userExcluded, seen, true);
  };

  const handleReset = () => {
    if (!choice) return;
    const freshSeen: string[] = [];
    setSeen(freshSeen);
    sset(KEYS.excluded, {
      phrase: choice.phrase,
      category: choice.category,
      userExcluded,
      seen: freshSeen
    });
    sessionStorage.removeItem(KEYS.explore);
    void fetchExplore(choice, userExcluded, freshSeen, true);
  };

  if (!choice) {
    return (
      <div className="wrap">
        <header className="hdr">
          <h1>🔬 Step 3 · Evidence Explorer</h1>
          <p>Explore literature records ranked by relevance for your selected PICO phrase</p>
        </header>
        <WorkflowStepper currentStep={3} />
        <main id="main" className="solo">
          <section className="card">
            <p className="hint">Loading evidence explorer…</p>
          </section>
        </main>
        <footer>Version 3.1 · Copyright©RaoufRoshdy2026</footer>
      </div>
    );
  }

  const meta = CATEGORY_META[choice.category] || CATEGORY_META.established;
  const records = exploreData?.records || [];
  const isExhausted = exploreData && records.length === 0 && !exploreData.hasMore && (userExcluded.length > 0 || seen.length > 0);
  const isEmptyCorpus = exploreData && records.length === 0 && !isExhausted;

  return (
    <div className="wrap">
      <header className="hdr">
        <h1>🔬 Step 3 · Evidence Explorer</h1>
        <p>Explore literature records ranked by relevance for your selected PICO phrase</p>
      </header>

      <WorkflowStepper currentStep={3} />

      <main id="main" className="solo">
        {/* Selection Summary Card */}
        <section className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
            <span
              className="pill"
              style={{
                background: meta.badgeBg,
                color: meta.badgeColor,
                fontWeight: 700,
                fontSize: "0.92rem",
                padding: "6px 14px"
              }}
            >
              {meta.label}
            </span>
            {userExcluded.length > 0 && (
              <span className="pill" style={{ background: "#fee2e2", color: "#991b1b", fontWeight: 700 }}>
                Excluded: {userExcluded.length}
              </span>
            )}
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

        {/* Loading state with Shimmer Skeletons */}
        {loading && (
          <section className="card">
            <AnimatedProcessingIndicator
              message="Exploring evidence related to your selection…"
              secondaryMessage="PubMed · Europe PMC · Cochrane CENTRAL · OpenAlex · Crossref · Semantic Scholar (~10–20 s)"
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 20 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ padding: "16px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <div className="skeleton-box" style={{ height: 24, width: "18%" }} />
                    <div className="skeleton-box" style={{ height: 24, width: "28px" }} />
                  </div>
                  <div className="skeleton-box" style={{ height: 20, width: i % 2 === 0 ? "85%" : "92%", marginBottom: 8 }} />
                  <div className="skeleton-box" style={{ height: 14, width: "60%", marginBottom: 8 }} />
                  <div className="skeleton-box" style={{ height: 14, width: "40%" }} />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Error State */}
        {error && !loading && (
          <section className="card">
            <div className="advisory">⚠️ {error}</div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="primary" onClick={handleReRun}>🔄 Try again</button>
              <button className="secondary" onClick={() => router.push("/screen")}>← Back to Step 2</button>
            </div>
          </section>
        )}

        {/* Empty Corpus State */}
        {isEmptyCorpus && !loading && !error && (
          <section className="card">
            <div className="empty-state" role="alert" aria-live="polite">
              <p className="empty-title">{NO_LITERATURE_MESSAGE}</p>
              <p className="hint">{NO_LITERATURE_HINT}</p>
            </div>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="secondary" onClick={handleReRun}>🔄 Refresh exploration</button>
              <button className="primary" onClick={() => router.push("/screen")}>← Revise your selection</button>
            </div>
          </section>
        )}

        {/* Exhausted State */}
        {isExhausted && !loading && !error && (
          <section className="card">
            <div className="advisory" style={{ marginBottom: 16 }}>
              ℹ️ No further records related to this selection were found — excluded and seen papers stay filtered.
            </div>
            <div className="row" style={{ gap: 12 }}>
              <button className="primary" onClick={handleReset}>↺ Reset exploration</button>
              <button className="secondary" onClick={() => router.push("/screen")}>← Revise your selection</button>
            </div>
          </section>
        )}

        {/* Results List */}
        {!loading && !error && records.length > 0 && (
          <section className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="pill" style={{ fontWeight: 600 }}>
                  Showing {records.length} papers
                </span>
                {exploreData && (
                  <span className="pill" style={{ background: "#f1f5f9", color: "#475569" }}>
                    Screened {exploreData.corpusStats.screened} (Blocked: {exploreData.corpusStats.blocked})
                  </span>
                )}
              </div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button className="primary" onClick={handleReRun} title="Fetch new papers excluding seen and excluded ones">
                  🔄 Re-run (new papers)
                </button>
                <button className="secondary" onClick={handleReset} title="Clear seen papers and restart exploration">
                  ↺ Reset exploration
                </button>
                <button className="secondary" onClick={() => router.push("/summary")} title="Proceed to workflow summary">
                  Next: Workflow summary →
                </button>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {records.map((r, i) => {
                const elementsMatchedText = (r.matchedElements || [])
                  .map(code => ELEMENT_LABELS[code] || code)
                  .join(", ");
                const matchSummary = elementsMatchedText ? `Matches: ${elementsMatchedText}` : "Broad clinical context match";

                return (
                  <div
                    key={r.pmid || r.doi || `r-${i}`}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      padding: "16px 18px",
                      background: "#ffffff",
                      position: "relative",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span
                          className="pill"
                          style={{
                            background: r.relevancePct >= 70 ? "#ecfdf5" : r.relevancePct >= 40 ? "#eff6ff" : "#f8fafc",
                            color: r.relevancePct >= 70 ? "#065f46" : r.relevancePct >= 40 ? "#1e40af" : "#475569",
                            fontWeight: 700,
                            fontSize: "0.92rem",
                            padding: "4px 10px"
                          }}
                        >
                          {r.relevancePct}% related
                        </span>
                        {r.year && (
                          <span className="pill" style={{ background: "#f1f5f9", color: "#475569", fontSize: "0.82rem" }}>
                            {r.year}
                          </span>
                        )}
                        {r.source && (
                          <span className="pill" style={{ background: "#f8fafc", color: "#64748b", fontSize: "0.78rem" }}>
                            {r.source}
                          </span>
                        )}
                        {r.evidenceType === "preprint" && (
                          <span className="pill" style={{ background: "#fef3c7", color: "#92400e", fontSize: "0.78rem", fontWeight: 600 }}>
                            [preprint — not peer reviewed]
                          </span>
                        )}
                        {r.evidenceType === "trial_registration" && (
                          <span className="pill" style={{ background: "#e0e7ff", color: "#3730a3", fontSize: "0.78rem", fontWeight: 600 }}>
                            [trial registration — no results]
                          </span>
                        )}
                        {r.evidenceType === "book_chapter" && (
                          <span className="pill" style={{ background: "#f1f5f9", color: "#475569", fontSize: "0.78rem", fontWeight: 600 }}>
                            [book chapter]
                          </span>
                        )}
                        {r.evidenceType === "thesis" && (
                          <span className="pill" style={{ background: "#f1f5f9", color: "#475569", fontSize: "0.78rem", fontWeight: 600 }}>
                            [thesis]
                          </span>
                        )}
                        {r.evidenceType && !["preprint", "trial_registration", "book_chapter", "thesis", "unclassified"].includes(r.evidenceType) && (
                          <span className="pill" style={{ background: "#ecfdf5", color: "#065f46", fontSize: "0.78rem", fontWeight: 600 }}>
                            {r.evidenceType.replace(/_/g, " ")}
                          </span>
                        )}
                      </div>

                      {/* Exclude button */}
                      <button
                        type="button"
                        onClick={() => handleExcludeCard(r)}
                        aria-label={`Exclude paper: ${r.title}`}
                        style={{
                          background: "transparent",
                          border: "1px solid #cbd5e1",
                          borderRadius: "50%",
                          width: "28px",
                          height: "28px",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          color: "#64748b",
                          fontSize: "1rem",
                          lineHeight: 1,
                          padding: 0
                        }}
                        title="Exclude paper from exploration"
                      >
                        ×
                      </button>
                    </div>

                    {/* Paper Title (strictly without hyperlinks) */}
                    <h3 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "6px 0 8px 0", color: "#0f172a", lineHeight: 1.4 }}>
                      {r.title}
                    </h3>

                    {/* Authors and Journal */}
                    <p style={{ margin: "0 0 8px 0", fontSize: "0.86rem", color: "#475569", lineHeight: 1.4 }}>
                      {r.authors ? `${r.authors}. ` : ""}
                      {r.journal ? <em>{r.journal}</em> : ""}
                      {r.pmid ? ` (PMID: ${r.pmid})` : r.doi ? ` (DOI: ${r.doi})` : ""}
                    </p>

                    {/* Abstract snippet */}
                    {r.context && (
                      <p style={{ margin: "0 0 8px 0", fontSize: "0.84rem", color: "#64748b", lineHeight: 1.45 }}>
                        {r.context.slice(0, 240)}{r.context.length > 240 ? "…" : ""}
                      </p>
                    )}

                    {/* Matched Elements basis */}
                    <div style={{ fontSize: "0.82rem", color: "#0d9488", fontWeight: 600 }}>
                      ✓ {matchSummary}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="row" style={{ marginTop: 20, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                <button className="link" onClick={() => router.push("/screen")}>
                  ← Back to Step 2
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
              <button className="primary" onClick={() => router.push("/summary")}>
                Next: Workflow summary →
              </button>
            </div>
          </section>
        )}
      </main>
      <footer>Version 3.1 · Copyright©RaoufRoshdy2026</footer>
    </div>
  );
}
