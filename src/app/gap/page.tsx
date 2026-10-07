"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatedProcessingIndicator } from "@/components/AnimatedProcessingIndicator";
import { sget, sset, KEYS } from "@/lib/session";
import { readSessionInput, sessionSearchText } from "@/lib/clinical-input";
import { NO_LITERATURE_MESSAGE, NO_LITERATURE_HINT } from "@/lib/clinical-keywords";

interface Reference { pmid: string; title: string; authors: string; year: string; journal: string; doi?: string; url: string }
interface PointWithRefs { point: string; references: Reference[] }
interface GapResult {
  topic: string; specialty?: string;
  known: PointWithRefs[]; uncertain: PointWithRefs[];
  gaps: { gap: string; why: string }[];
  suggestedQuestions: { question: string; rationale: string }[];
  note?: string;
}

/** True when the map carries neither evidence points nor usable reference records. */
function isEmptyResult(g: GapResult): boolean {
  const points = [...(g.known || []), ...(g.uncertain || [])];
  const hasPoints = points.some(p => (p.point || "").trim().length > 0);
  const hasRefs = points.some(p => (p.references || []).length > 0);
  return !hasPoints && !hasRefs;
}

export default function GapPage() {
  const router = useRouter();
  const [gap, setGap] = useState<GapResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"known" | "uncertain" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isMounted = true;
    const normalized = sget<string>(KEYS.inputText);
    const stored = readSessionInput(sget<unknown>(KEYS.input));
    const input = normalized || (stored ? sessionSearchText(stored) : "");
    if (!input) { router.replace("/"); return; }
    (async () => {
      try {
        const res = await fetch("/api/engine", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: "gap", input })
        });
        if (!isMounted) return;
        // Surface the server's own diagnostic instead of replacing it with a generic string.
        if (!res.ok) {
          const body = await res.json().catch(() => null as { error?: string } | null);
          if (isMounted) setError(body?.error || `The evidence mapping service returned an error (${res.status}). Please try again.`);
          return;
        }
        const data: GapResult & { error?: string } = await res.json();
        if (!isMounted) return;
        if (data?.error && !Array.isArray(data.known)) {
          setError(data.error);
        } else {
          setGap(data);
          if (Array.isArray(data.suggestedQuestions) && data.suggestedQuestions.length > 0) {
            setSelected(data.suggestedQuestions[0].question);
          }
        }
      } catch {
        if (isMounted) setError("The evidence mapping service did not respond. Please go back and retry.");
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [router]);

  const vancouverPlain = (r: Reference) => {
    const url = r.url || `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`;
    return [
      r.authors ? `${r.authors.replace(/\.$/, "")}.` : "",
      r.title ? `${r.title.replace(/\.$/, "")}.` : "",
      r.journal ? (r.year ? `${r.journal.replace(/\.$/, "")}. ${r.year}.` : `${r.journal.replace(/\.$/, "")}.`) : (r.year ? `${r.year}.` : ""),
      r.doi ? `doi:${r.doi.replace(/^doi:\s*/i, "")}` : "",
      url
    ].filter(Boolean).join(" ");
  };

  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "document";

  const dlPdf = async (payload: Record<string, unknown>, name: string, kind: "known" | "uncertain") => {
    setExporting(kind);
    setExportError(null);
    try {
      const res = await fetch("/api/pdf", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        let msg = "PDF generation failed. Please retry.";
        try { const j = await res.json(); if (j && j.error) msg = j.error; } catch { /* keep default */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      if (!blob.size || blob.type !== "application/pdf") throw new Error("Unexpected response from PDF service.");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setExportError("⚠️ PDF export failed: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setExporting(null);
    }
  };

  const exportEvidencePDF = (section: "known" | "uncertain") => {
    if (!gap) return;
    const isKnown = section === "known";
    const items: PointWithRefs[] = (isKnown ? gap.known : gap.uncertain) || [];
    // Never emit a misleading document when the section holds nothing to report.
    if (!items.length) {
      setExportError(`There are no ${isKnown ? "established-evidence" : "conflicting-evidence"} records to export.`);
      return;
    }
    const title = isKnown ? "Established Knowledge" : "Conflicting / Low-Quality Evidence";
    const sections = items.map((item, i) => ({
      heading: `${i + 1}. ${isKnown ? "Established point" : "Contested area"}`,
      blocks: item.references.length
        ? [item.point, "Supporting literature: " + item.references.map(vancouverPlain).join(" ")]
        : [item.point]
    }));
    dlPdf({
      docType: `${title} · Evidence Map`,
      title: gap.topic,
      meta: `Generated ${new Date().toLocaleDateString()} · Obstetrics & Gynecology${gap.specialty ? ` · ${gap.specialty}` : ""}`,
      sections
    }, slug(gap.topic) + "-evidence-map.pdf", section);
  };

  const refine = (q: string) => {
    if (gap) sset(KEYS.gap, gap);
    sset(KEYS.question, q);
    router.push("/question");
  };

  return (
    <div className="wrap">
      <header className="hdr">
        <h1>🕳️ Step 2 · Evidence Map</h1>
        <p>What is established, what is contested, and where the real gaps are</p>
      </header>

      <main className="solo">
        {!gap && !error && (
          <section className="card">
            <AnimatedProcessingIndicator
              message="Mapping the evidence"
              secondaryMessage="Retrieving studies from PubMed, filtering for PICO relevance, and constructing the clinical evidence map. This usually takes 20–60 seconds..."
            />
          </section>
        )}
        {error && (
          <section className="card"><div className="advisory">⚠️ {error}</div>
            <button className="primary" onClick={() => router.push("/")}>← Back to start</button></section>
        )}

        {gap && isEmptyResult(gap) && (
          <section className="card">
            <span className="pill">🗺️ Evidence Map · {gap.topic}</span>
            <div className="empty-state" role="alert" aria-live="polite">
              <p className="empty-title">{NO_LITERATURE_MESSAGE}</p>
              <p className="hint">{NO_LITERATURE_HINT}</p>
            </div>
            {gap.note && <div className="advisory">⚠️ {gap.note}</div>}
            <div className="row">
              <button className="primary" onClick={() => router.push("/")}>← Revise your keywords</button>
            </div>
          </section>
        )}

        {gap && !isEmptyResult(gap) && (
          <section className="card" ref={mapRef}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
              <span className="pill">🗺️ Evidence Map · {gap.topic}</span>
              <div className="row">
                {exportError && <div className="advisory">{exportError}</div>}
                <button className="secondary" disabled={!!exporting || !gap.known?.length} title={!gap.known?.length ? "No established-evidence records to export" : undefined} onClick={() => exportEvidencePDF("known")}>{exporting === "known" ? "⏳ Generating PDF…" : "📄 Established Knowledge (PDF)"}</button>
                <button className="secondary" disabled={!!exporting || !gap.uncertain?.length} title={!gap.uncertain?.length ? "No conflicting-evidence records to export" : undefined} onClick={() => exportEvidencePDF("uncertain")}>{exporting === "uncertain" ? "⏳ Generating PDF…" : "📄 Conflicting Evidence (PDF)"}</button>
              </div>
            </div>
            {gap.note && <div className="advisory">⚠️ {gap.note}</div>}

            {!!gap.known?.length && (
              <>
                <h3 className="sec-h">✅ Established knowledge</h3>
                <ul className="gap-list">
                  {gap.known.map((k, i) => (
                    <li key={`k${i}`}>
                      {k.point}
                      {!!k.references?.length && (
                        <div className="refs">{k.references.map((r, j) => (
                          <a key={j} href={r.url} target="_blank" rel="noopener noreferrer" className="ref-link">
                            [{r.year}] {r.authors}. {r.title}. {r.journal}.{r.pmid ? ` PMID: ${r.pmid}.` : ""}{r.doi ? ` DOI: ${r.doi}.` : ""}
                          </a>))}</div>
                      )}
                    </li>))}
                </ul>
              </>
            )}
            {!!gap.uncertain?.length && (
              <>
                <h3 className="sec-h">⚖️ Conflicting / low-quality evidence</h3>
                <ul className="gap-list">
                  {gap.uncertain.map((u, i) => (
                    <li key={`u${i}`}>
                      {u.point}
                      {!!u.references?.length && (
                        <div className="refs">{u.references.map((r, j) => (
                          <a key={j} href={r.url} target="_blank" rel="noopener noreferrer" className="ref-link">
                            [{r.year}] {r.authors}. {r.title}. {r.journal}.{r.pmid ? ` PMID: ${r.pmid}.` : ""}{r.doi ? ` DOI: ${r.doi}.` : ""}
                          </a>))}</div>
                      )}
                    </li>))}
                </ul>
              </>
            )}
            {!!gap.gaps?.length && (
              <>
                <h3 className="sec-h">🕳️ Research gaps</h3>
                <ul className="gap-list">
                  {gap.gaps.map((g, i) => <li key={`g${i}`}><strong>{g.gap}</strong> — {g.why}</li>)}
                </ul>
              </>
            )}
            {!!gap.suggestedQuestions?.length && (
              <>
                <h3 className="sec-h">💡 PICO questions — select exactly one to continue</h3>
                <div className="variants">
                  {gap.suggestedQuestions.map((s, i) => {
                    const isSel = selected === s.question;
                    return (
                      <div key={i}
                        className={`variant-card${isSel ? " selected" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelected(s.question)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(s.question); } }}>
                        <span className="v-q">{s.question}</span>
                        <span className="v-r">{s.rationale}</span>
                        <span className={`v-sel${isSel ? "" : " muted"}`}>{isSel ? "✓ Selected" : "○ Select this PICO"}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="row" style={{ marginTop: 12 }}>
                  <button className="primary" disabled={!selected} onClick={() => selected && refine(selected)}>
                    {selected ? "Continue with selected PICO →" : "Continue with selected PICO"}
                  </button>
                </div>
              </>
            )}
            <div className="row">
              <button className="link" onClick={() => router.push("/")}>← Start over</button>
            </div>
          </section>
        )}
      </main>
      <footer>Version 3.1 · Copyright©RaoufRoshdy2026</footer>
    </div>
  );
}
