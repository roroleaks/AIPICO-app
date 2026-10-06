"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatedProcessingIndicator } from "@/components/AnimatedProcessingIndicator";
import type { Formulation } from "@/lib/kb";
import { sget, sset, KEYS } from "@/lib/session";
import { readSessionInput, sessionSearchText } from "@/lib/clinical-input";
import { NO_LITERATURE_MESSAGE, NO_LITERATURE_HINT } from "@/lib/clinical-keywords";
import { formatReference, formatVancouverReference } from "@/lib/relevance";
import { validateDeliverableIntegrity } from "@/lib/deliverable-integrity";

interface ReferenceItem { pmid: string; title: string; authors: string; year: string; journal: string; doi?: string; url: string }
type PubMedResult = ReferenceItem;
interface GapSnapshot {
  topic?: string;
  known?: Array<{ point?: string; references?: ReferenceItem[] }>;
  uncertain?: Array<{ point?: string; references?: ReferenceItem[] }>;
}
interface CommentaryPaper {
  title: string; abstract: string; keywords: string[];
  introduction: string; discussion: string; conclusion: string;
  references: string[];
  /** Exactly the records behind `references`: this is the exported/rendered reference list. */
  fetchedReferences?: ReferenceItem[];
  /** Retained as direct evidence but not cited in the bibliography. */
  additionalEvidence?: ReferenceItem[];
  /** Retrieved but not direct evidence for the claim; never exported as references. */
  contextualReferences?: ReferenceItem[];
  retainedCount?: number;
  retrievedCount?: number;
  excludedCount?: number;
  excludedReferences?: Array<{ pmid: string; title: string; reason: string; url: string }>;
  noDirectEvidence?: boolean;
  refAudit?: RefAudit[]; paperRefAudit?: Array<{ ref: string; audit: RefAudit }>; 
  citationChecks?: CitationChecks;
  /** Citations that matched no retrieved source and were stripped so no unverifiable
   *  attribution reaches the user. Surfaced rather than silently dropped. */
  removedCitations?: string[];
  /** Whether a model wrote the narrative ("ai") or it was assembled without one ("deterministic"). */
  source?: "ai" | "deterministic";
  /** False when `source` is "deterministic": the text below is an evidence list, not a synthesis. */
  synthesisGenerated?: boolean;
  /** Server-supplied explanation shown to the user when no synthesis was produced. */
  notice?: string;
}
interface RefAudit {
  pmid: string; title: string; url: string;
  resolved: boolean; doiOk: boolean; design: string;
  population: boolean; intervention: boolean; comparator: boolean; outcome: boolean; score: number;
}
interface CitationChecks {
  totalRefs: number; citedRefs: number;
  uncited: string[]; orphans: string[]; consistent: boolean;
}
interface ExcludedRef { pmid: string; title: string; reason: string; url: string }

function FormattedPaperSection({ content }: { content: string }) {
  if (!content) return null;
  const blocks = content.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  return (
    <div className="paper-section-body" style={{ lineHeight: 1.7, fontSize: "0.97rem", color: "#1e293b" }}>
      {blocks.map((block, idx) => {
        if (block.startsWith("#### ")) {
          const headingText = block.replace(/^####\s+/, "");
          return (
            <h4
              key={idx}
              style={{
                fontSize: "1.05rem",
                fontWeight: 700,
                color: "#0f766e",
                marginTop: 22,
                marginBottom: 8,
                borderBottom: "1px solid #e2e8f0",
                paddingBottom: 4
              }}
            >
              {headingText}
            </h4>
          );
        }
        if (block.startsWith("- ")) {
          const items = block.split(/\n-\s+/).map(it => it.replace(/^- /, "").trim()).filter(Boolean);
          return (
            <ul key={idx} style={{ paddingLeft: 22, margin: "10px 0", listStyleType: "disc" }}>
              {items.map((item, iIdx) => {
                const parts = item.split(/\*\*(.*?)\*\*/);
                return (
                  <li key={iIdx} style={{ marginBottom: 6 }}>
                    {parts.map((p, pIdx) => (pIdx % 2 === 1 ? <strong key={pIdx} style={{ color: "#0f172a" }}>{p}</strong> : p))}
                  </li>
                );
              })}
            </ul>
          );
        }
        const parts = block.split(/\*\*(.*?)\*\*/);
        return (
          <p key={idx} style={{ marginBottom: 12 }}>
            {parts.map((p, pIdx) => (pIdx % 2 === 1 ? <strong key={pIdx} style={{ color: "#0f172a" }}>{p}</strong> : p))}
          </p>
        );
      })}
    </div>
  );
}

export default function PaperPage() {
  const router = useRouter();
  const curRefAudit = (c: CommentaryPaper): RefAudit[] =>
    Array.isArray(c.refAudit) ? c.refAudit : [];
  const curCitationChecks = (c: CommentaryPaper): CitationChecks | undefined =>
    c.citationChecks && typeof c.citationChecks === "object" ? c.citationChecks : undefined;
  const curPaperRefAudit = (c: CommentaryPaper): Array<{ ref: string; audit: RefAudit }> => {
    const v = (c as { paperRefAudit?: unknown }).paperRefAudit;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is { ref: string; audit: RefAudit } => {
      const o = x as { ref?: unknown; audit?: RefAudit };
      return !!o && typeof o.ref === "string" && !!o.audit && typeof o.audit.pmid === "string";
    });
  };
  const [formulation] = useState<Formulation | null>(() => {
    const f = sget<Formulation>(KEYS.formulation);
    if (!f || typeof f.finalQuestion !== "string") return null;
    const str = (v: unknown): string => (typeof v === "string" ? v : "");
    const el = (v: unknown): { label: string; value: string } | null => {
      const o = v as { label?: unknown; value?: unknown };
      if (!o || typeof o !== "object") return null;
      const label = str(o.label);
      const value = str(o.value);
      return value ? { label: label || "Element", value } : null;
    };
    const sc = (v: unknown): { name: string; value: number } | null => {
      const o = v as { name?: unknown; value?: unknown };
      if (!o || typeof o !== "object") return null;
      const name = str(o.name);
      const value = typeof o.value === "number" ? o.value : 0;
      return name ? { name, value } : null;
    };
    const va = (v: unknown): { question: string; rationale: string } | null => {
      const o = v as { question?: unknown; rationale?: unknown };
      if (!o || typeof o !== "object") return null;
      const question = str(o.question);
      return question ? { question, rationale: str(o.rationale) } : null;
    };
    const ad = (v: unknown): string => {
      if (typeof v === "string" && v.trim()) return v;
      const o = v as { warning?: unknown; recommendation?: unknown; rationale?: unknown };
      if (o && typeof o === "object") {
        return [str(o.warning), o.recommendation ? `Recommended: ${str(o.recommendation)}` : "", str(o.rationale)].filter(Boolean).join(" ");
      }
      return "";
    };
    const elements = Array.isArray(f.elements)
      ? f.elements.map(el).filter((x): x is { label: string; value: string } => !!x) : [];
    if (!elements.length) return null;
    return {
      ...f,
      elements,
      scores: Array.isArray(f.scores)
        ? f.scores.map(sc).filter((x): x is { name: string; value: number } => !!x) : [],
      advisories: Array.isArray(f.advisories) ? f.advisories.map(ad).filter(Boolean) : [],
      variants: Array.isArray(f.variants)
        ? f.variants.map(va).filter((x): x is { question: string; rationale: string } => !!x) : []
    };
  });
  const [gapTopic] = useState<string | null>(() => {
    const g = sget<GapSnapshot>(KEYS.gap);
    const normalized = sget<string>(KEYS.inputText);
    const stored = readSessionInput(sget<unknown>(KEYS.input));
    return g?.topic
      || sget<string>(KEYS.question)
      || normalized
      || (stored ? sessionSearchText(stored) : "")
      || "";
  });
  const [outcome] = useState<string>(() => sget<string>("cq_outcome") || "");
  const [outcomes] = useState<string[]>(() => {
    const arr = sget<string[]>(KEYS.outcomes);
    if (Array.isArray(arr) && arr.length) return arr.filter(o => typeof o === "string" && o.trim());
    const o = sget<string>("cq_outcome");
    return o ? o.split(/\s+and\s+|\s*,\s*/).filter(Boolean) : [];
  });
  const [variantIdx, setVariantIdx] = useState(0);
  const [commentary, setCommentary] = useState<CommentaryPaper | null>(() => {
    const c = sget<CommentaryPaper>(KEYS.commentary);
    if (!c || typeof c.title !== "string") return null;
    if (c.title === "No literature related to your search found" || c.noDirectEvidence === true) {
      return null;
    }
    return {
      title: c.title,
      abstract: typeof c.abstract === "string" ? c.abstract : c.title,
      keywords: Array.isArray(c.keywords) ? c.keywords.filter((k): k is string => typeof k === "string") : [],
      introduction: typeof c.introduction === "string" ? c.introduction : "",
      discussion: typeof c.discussion === "string" ? c.discussion : "",
      conclusion: typeof c.conclusion === "string" ? c.conclusion : "",
      references: Array.isArray(c.references) ? c.references.filter((r): r is string => typeof r === "string") : [],
      fetchedReferences: Array.isArray(c.fetchedReferences) ? c.fetchedReferences : undefined,
      additionalEvidence: Array.isArray(c.additionalEvidence) ? c.additionalEvidence : undefined,
      contextualReferences: Array.isArray(c.contextualReferences) ? c.contextualReferences : undefined,
      retainedCount: typeof c.retainedCount === "number" ? c.retainedCount : undefined,
      retrievedCount: typeof c.retrievedCount === "number" ? c.retrievedCount : undefined,
      excludedCount: typeof c.excludedCount === "number" ? c.excludedCount : undefined,
      excludedReferences: Array.isArray(c.excludedReferences) ? c.excludedReferences : undefined,
      noDirectEvidence: typeof c.noDirectEvidence === "boolean" ? c.noDirectEvidence : undefined,
      refAudit: curRefAudit(c),
      paperRefAudit: curPaperRefAudit(c),
      citationChecks: curCitationChecks(c),
      removedCitations: Array.isArray(c.removedCitations) ? c.removedCitations : []
    };
  });
  const [commentaryLoading, setCommentaryLoading] = useState(false);
  const [commentaryError, setCommentaryError] = useState(false);
  const [pubmed, setPubmed] = useState<PubMedResult[] | null>(null);
  const [pubmedLoading, setPubmedLoading] = useState(false);
  const [exporting, setExporting] = useState<"commentary" | "refs" | "sources" | "question" | "pubmed" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const commentaryRef = useRef<HTMLDivElement>(null);

  const activeQuestion = formulation?.variants?.[variantIdx]?.question ?? formulation?.finalQuestion ?? "";

  const genLockRef = useRef(false);
  const generateCommentary = useCallback(async (overrideQ?: string) => {
    if (!formulation?.finalQuestion) return;
    if (genLockRef.current) return; // synchronous guard against concurrent regenerations
    genLockRef.current = true;
    const q = overrideQ || activeQuestion || formulation.finalQuestion;
    setCommentaryLoading(true);
    setCommentaryError(false);
    try {
      const res = await fetch("/api/engine", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "commentary",
          topic: gapTopic || formulation.finalQuestion,
          gapAnalysis: sget<GapSnapshot>(KEYS.gap),
          selectedQuestion: q,
          outcome,
          outcomes,
          picoElements: formulation.elements
        })
      });
      const data: CommentaryPaper & { error?: string } = await res.json();
      if (data && typeof data === "object" && data.title && !data.error) {
        const str = (v: unknown): string => (typeof v === "string" ? v : "");
        const strings = (v: unknown): string[] =>
          Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
        const validRef = (r: unknown): r is ReferenceItem => {
          const o = r as ReferenceItem;
          return !!o && typeof o === "object" && typeof o.pmid === "string" && typeof o.title === "string";
        };
        const norm: CommentaryPaper = {
          title: str(data.title),
          abstract: str(data.abstract) || data.title,
          keywords: strings(data.keywords),
          introduction: str(data.introduction),
          discussion: str(data.discussion),
          conclusion: str(data.conclusion),
          references: strings(data.references),
          fetchedReferences: Array.isArray(data.fetchedReferences)
            ? data.fetchedReferences.filter(validRef) : undefined,
          additionalEvidence: Array.isArray(data.additionalEvidence)
            ? data.additionalEvidence.filter(validRef) : undefined,
          contextualReferences: Array.isArray(data.contextualReferences)
            ? data.contextualReferences.filter(validRef) : undefined,
          retainedCount: typeof data.retainedCount === "number" ? data.retainedCount : undefined,
          retrievedCount: typeof data.retrievedCount === "number" ? data.retrievedCount : undefined,
          excludedCount: typeof data.excludedCount === "number" ? data.excludedCount : undefined,
          excludedReferences: Array.isArray(data.excludedReferences)
            ? (data.excludedReferences as ExcludedRef[]).filter(
                x => !!x && typeof x.pmid === "string" && typeof x.title === "string"
              ) : undefined,
          noDirectEvidence: typeof data.noDirectEvidence === "boolean" ? data.noDirectEvidence : undefined,
          source: data.source === "ai" || data.source === "deterministic" ? data.source : undefined,
          synthesisGenerated: typeof data.synthesisGenerated === "boolean" ? data.synthesisGenerated : undefined,
          notice: typeof data.notice === "string" ? data.notice : undefined,
          refAudit: curRefAudit(data),
          paperRefAudit: curPaperRefAudit(data),
          citationChecks: curCitationChecks(data),
          removedCitations: Array.isArray(data.removedCitations) ? data.removedCitations : []
        };
        if (!norm.noDirectEvidence && norm.title !== "No literature related to your search found") {
          sset(KEYS.commentary, norm);
        } else if (typeof window !== "undefined") {
          window.sessionStorage.removeItem(KEYS.commentary);
        }
        setCommentary(norm);
      } else {
        setCommentaryError(true);
      }
    } catch {
      setCommentaryError(true);
    }
    finally { genLockRef.current = false; setCommentaryLoading(false); }
  }, [formulation, gapTopic, activeQuestion, outcome, outcomes]);

  const selectVariant = useCallback((i: number) => {
    if (i === variantIdx) return;
    setVariantIdx(i);
    if (!commentaryLoading) {
      const q = formulation?.variants?.[i]?.question ?? formulation?.finalQuestion ?? "";
      if (q) generateCommentary(q);
    }
  }, [variantIdx, commentaryLoading, formulation, generateCommentary]);

  useEffect(() => {
    if (!formulation) { router.replace("/"); return; }
    if (!commentary && !commentaryLoading && !commentaryError) {
      const t = setTimeout(generateCommentary, 0);
      return () => clearTimeout(t);
    }
  }, [formulation, commentary, commentaryLoading, commentaryError, generateCommentary, router]);

  const searchPubMed = async () => {
    if (!formulation) return;
    setPubmedLoading(true);
    try {
      const res = await fetch("/api/pubmed", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formulation.searchTerms)
      });
      setPubmed((await res.json()).results || []);
    } catch {
      setPubmed([]);
    } finally { setPubmedLoading(false); }
  };

  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "document";

  const dlPdf = async (payload: Record<string, unknown>, name: string, kind: "commentary" | "refs" | "sources" | "question" | "pubmed") => {
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

  const vancouverPlain = (r: ReferenceItem, idx?: number) => formatVancouverReference(r, idx);

  /**
   * Single parity gate for every deliverable on this page.
   *
   * PDF, Word and clipboard are three separate code paths that each build a bibliography. The
   * acceptance requirement is that they cannot disagree with the commentary and the visible
   * reference list, so instead of trusting each path to remember the filtered set, each one hands
   * its intended references here first and is refused when they are not exactly the records
   * behind the commentary. A refetched or partially-populated commentary has no records to check
   * against, so it is refused rather than exported unverified.
   */
  const guardDeliverable = (intended: string[], label: string): boolean => {
    const retained = commentary?.fetchedReferences ?? [];
    if (!commentary?.references?.length) return true;
    const result = validateDeliverableIntegrity({
      fields: {
        abstract: commentary.abstract || "",
        introduction: commentary.introduction || "",
        discussion: commentary.discussion || "",
        conclusion: commentary.conclusion || ""
      },
      references: commentary.references,
      retainedRecords: retained as ReferenceItem[],
      exportReferences: intended
    });
    if (result.ok) return true;
    setExportError(
      `⚠️ ${label} blocked: it did not match the validated evidence set ` +
      `(${[
        result.unsupportedCitations.length ? `unsupported citations: ${result.unsupportedCitations.join(", ")}` : "",
        result.orphanCitations.length ? `orphan citations: ${result.orphanCitations.join(", ")}` : "",
        result.uncitedReferences.length ? `uncited references: ${result.uncitedReferences.length}` : "",
        result.unresolvedReferences.length ? `unresolved references: ${result.unresolvedReferences.length}` : "",
        result.extraExportReferences.length ? `references outside the evidence set: ${result.extraExportReferences.length}` : ""
      ].filter(Boolean).join("; ")}). Re-run the analysis to regenerate."`
    );
    return false;
  };

  /** The records an export is allowed to cite, sent so the PDF service can verify server-side. */
  const retainedPayload = () =>
    (commentary?.fetchedReferences ?? []).map(r => ({
      pmid: r.pmid, doi: r.doi, title: r.title, authors: r.authors, year: r.year, journal: r.journal, url: r.url
    }));

  const copyReferences = async () => {
    if (!commentary?.references?.length) return;
    const lines = commentary.references.map((r, i) => vancouverFromString(r, i + 1));
    if (!guardDeliverable(lines, "Copy references")) return;
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
    } catch {
      setExportError("⚠️ Could not access the clipboard.");
    }
  };

  const picoPayload = () =>
    (formulation?.elements || []).map(e => ({ label: e.label, value: e.value }));

  const exportQuestionPDF = () => {
    if (!formulation) return;
    dlPdf({
      docType: `Structured Clinical Question · ${formulation.framework}`,
      title: activeQuestion,
      meta: `Generated ${new Date().toLocaleDateString()} · Obstetrics & Gynecology`,
      pico: picoPayload()
    }, slug(activeQuestion) + "-question.pdf", "question");
  };

  const exportWord = () => {
    if (!formulation) return;
    // This document is real HTML, so every interpolated value must be escaped or
    // markup in the question/elements would execute when the file is opened.
    const esc = (s: unknown): string =>
      String(s ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
    // The bibliography is the same filtered set the screen and the PDF exports use, never the
    // raw search pool, so a Word copy cannot reintroduce a source the claim filter rejected.
    const refs = commentary?.fetchedReferences?.length
      ? commentary.fetchedReferences
      : commentary?.references?.length
        ? commentary.references
        : [];
    const bibliography = refs.length
      ? `<h2>References (Vancouver Style)</h2>
<ol>${refs.map((r, i) => `<li>${esc(typeof r === "string" ? r : vancouverPlain(r, i + 1))}</li>`).join("")}</ol>`
      : "";
    if (refs.length && !guardDeliverable(refs.map((r, i) => (typeof r === "string" ? r : vancouverPlain(r, i + 1))), "Word export")) return;
    const html = `<html><head><meta charset="utf-8"></head><body>
<h1>${esc(activeQuestion)}</h1>
<h2>Framework: ${esc(formulation.framework)}</h2>
<table border="1" cellpadding="6" style="border-collapse:collapse">
${formulation.elements.map(e => `<tr><td><b>${esc(e.label)}</b></td><td>${esc(e.value)}</td></tr>`).join("")}
</table>
${bibliography}
<p>Generated by Clinical Question Assistant — ${new Date().toLocaleDateString()}</p>
</body></html>`;
    const blob = new Blob(["﻿" + html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "clinical-question.doc";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const exportRefsPDF = (items: ReferenceItem[], docTitle: string, header: string, kind: "sources" | "pubmed") => {
    if (!items.length) return;
    const refs = items.map((r, i) => vancouverPlain(r, i + 1));
    if (!guardDeliverable(refs, `${header} PDF`)) return;
    dlPdf({
      docType: `Reference List · ${header} (Vancouver Style)`,
      title: docTitle,
      meta: `Clinical Question Assistant · Generated ${new Date().toLocaleDateString()}`,
      pico: picoPayload(),
      outcomes: outcomes.length ? outcomes : undefined,
      references: refs,
      retainedReferences: retainedPayload()
    }, slug(docTitle) + "-references.pdf", kind);
  };

  const vancouverFromString = (r: string, idx?: number) => {
    const cleaned = r.trim().replace(/^\[?\d+\]?[\.\)]?\s*/, "");
    return typeof idx === "number" && idx > 0 ? `${idx}. ${cleaned}` : cleaned;
  };

  const exportCommentaryRefs = () => {
    if (!commentary || !commentary.references?.length) return;
    const refs = commentary.references.map((r, i) => vancouverFromString(r, i + 1));
    if (!guardDeliverable(refs, "Reference PDF")) return;
    dlPdf({
      docType: "Reference List · Vancouver Style",
      title: commentary.title,
      meta: `Clinical Question Assistant · Generated ${new Date().toLocaleDateString()}`,
      pico: picoPayload(),
      outcomes: outcomes.length ? outcomes : undefined,
      references: refs,
      retainedReferences: retainedPayload()
    }, slug(commentary.title) + "-references.pdf", "refs");
  };

  const paras = (t: string) => t.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

  const exportCommentaryToPDF = () => {
    if (!commentary) return;
    const discussionBlocks = commentary.discussion.split(/\n{1,}/).map(b => b.trim()).filter(Boolean);
    const refs = commentary.references.length ? commentary.references.map((r, i) => vancouverFromString(r, i + 1)) : [];
    if (refs.length && !guardDeliverable(refs, "Commentary PDF")) return;
    dlPdf({
      docType: "Scientific Commentary",
      title: commentary.title,
      meta: `Obstetrics & Gynecology · Generated ${new Date().toLocaleDateString()}`,
      pico: picoPayload(),
      outcomes: outcomes.length ? outcomes : undefined,
      keywords: Array.isArray(commentary.keywords) ? commentary.keywords : undefined,
      sections: [
        { heading: "Abstract", blocks: [commentary.abstract] },
        { heading: "Introduction", blocks: paras(commentary.introduction) },
        { heading: "Discussion", blocks: discussionBlocks.length ? discussionBlocks : [commentary.discussion] },
        { heading: "Conclusion", blocks: [commentary.conclusion] }
      ],
      references: refs.length ? refs : undefined,
      retainedReferences: refs.length ? retainedPayload() : undefined
    }, slug(commentary.title) + "-commentary.pdf", "commentary");
  };

  const total = formulation ? formulation.scores.reduce((x, s) => x + (s.value || 0), 0) : 0;
  const maxTotal = formulation ? formulation.scores.length * 20 : 100;

  // The no-literature state is decided by the claim-specific filter, upstream: when no
  // retrieved record directly supports the selected PICO there is nothing to cite, however
  // many broad-topic records were fetched. Contextual records do not count as evidence.
  const hasNoReferences = !!commentary
    && !(commentary.references || []).length
    && !(commentary.fetchedReferences || []).length;
  const retrieved = commentary?.retrievedCount ?? 0;
  const excluded = commentary?.excludedCount ?? 0;

  if (!formulation) {
    return (
      <div className="wrap"><header className="hdr"><h1>📝 Step 4</h1></header>
        <main className="solo"><section className="card">
          <p className="hint">No formulated question found in this session.</p>
          <button className="primary" onClick={() => router.push("/")}>← Start from Step 1</button>
        </section></main></div>
    );
  }

  return (
    <div className="wrap">
      <header className="hdr">
        <h1>📝 Step 4 · Your Scientific Commentary & Question Package</h1>
        <p>The commentary generates automatically — choose your preferred question below</p>
      </header>

      <main className="solo">
        {(commentary || commentaryLoading || commentaryError) && (
          <section className="card" ref={commentaryRef}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span className="pill">📄 Scientific Commentary Paper</span>
              <div className="row">
                {exportError && <div className="advisory">{exportError}</div>}
                {commentary && !!commentary.references?.length && <button className="secondary" disabled={!!exporting} onClick={exportCommentaryRefs}>{exporting === "refs" ? "⏳ Generating PDF…" : "📄 References PDF"}</button>}
                {commentary && !!commentary.references?.length && <button className="secondary" disabled={!!exporting} onClick={copyReferences}>📋 Copy references</button>}
                {hasNoReferences && (
                  <span className="hint" style={{ marginTop: 0 }}>No references to export</span>
                )}
                {commentary && <button className="secondary" disabled={!!exporting} onClick={exportCommentaryToPDF}>{exporting === "commentary" ? "⏳ Generating commentary PDF…" : "🖨️ Download Commentary PDF"}</button>}
              </div>
            </div>
            {!commentary && commentaryLoading && (
              <AnimatedProcessingIndicator
                message="Writing your scientific commentary"
                secondaryMessage="Drafting background abstract, keywords, introduction, detailed thematic discussion, clinical conclusion, and Vancouver-style references from direct evidence..."
              />
            )}
            {commentaryLoading && commentary && (
              <AnimatedProcessingIndicator
                message="Regenerating commentary and references"
                secondaryMessage="Re-evaluating direct evidence and drafting a new commentary for the newly selected PICO option..."
              />
            )}
            {commentaryError && !commentary && (
              <>
                <div className="advisory">⚠️ Commentary generation failed. The AI service may be busy — please retry.</div>
                <div className="row"><button className="primary" disabled={commentaryLoading} onClick={() => generateCommentary()}>{commentaryLoading ? "⏳ Retrying…" : "🔄 Retry"}</button></div>
              </>
            )}
            {commentaryError && commentary && (
              <div className="advisory" style={{ marginTop: 12 }}>
                ⚠️ Regeneration failed — the AI service may be busy. Your previous commentary is still shown below.
                <div className="row" style={{ marginTop: 8 }}><button className="secondary" disabled={commentaryLoading} onClick={() => generateCommentary()}>{commentaryLoading ? "⏳ Retrying…" : "🔄 Try again"}</button></div>
              </div>
            )}
            {commentary && (
              <>
                {commentary.notice && (
                  <div style={{
                    border: "1px solid #0f766e", background: "#f0fdfa", color: "#134e4a",
                    borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: ".88rem"
                  }}>
                    💡 <b>Evidence Grounding:</b> {commentary.notice}
                  </div>
                )}
                <h2 style={{ marginBottom: 12 }}>{commentary.title}</h2>
                <p style={{ fontSize: ".9rem", color: "var(--muted)", marginBottom: 16 }}>Keywords: {commentary.keywords.join(", ")}</p>
                <h3 className="sec-h">Abstract</h3><FormattedPaperSection content={commentary.abstract} />
                <h3 className="sec-h">Introduction</h3><FormattedPaperSection content={commentary.introduction} />
                <h3 className="sec-h">Discussion</h3><FormattedPaperSection content={commentary.discussion} />
                <h3 className="sec-h">Conclusion</h3><FormattedPaperSection content={commentary.conclusion} />
                {!!commentary.references.length && (
                  <><h3 className="sec-h">References (Vancouver Style)</h3>
                    <ol className="refs-numbered">{commentary.references.map((ref, i) => <li key={i}>{vancouverFromString(ref, i + 1)}</li>)}</ol></>
                )}
                {/* Filtering summary: how many records were retrieved, how many survived the
                    claim-specific filter, and what was dropped. Contextual records are listed
                    apart from the references so they can never be mistaken for evidence. */}
                {commentary && retrieved > 0 && !hasNoReferences && (
                  <p className="hint" style={{ marginTop: 12 }}>
                    🔎 Evidence filter: {retrieved} record{retrieved === 1 ? "" : "s"} retrieved for this question,
                    {" "}{commentary.retainedCount ?? commentary.fetchedReferences?.length ?? 0} retained as directly relevant
                    to the selected PICO and outcomes,
                    {" "}{commentary.references?.length ?? 0} cited in the reference list,
                    {" "}{excluded} excluded as not directly relevant.
                  </p>
                )}
                {!!commentary.additionalEvidence?.length && (
                  <details style={{ marginTop: 10 }}>
                    <summary className="hint" style={{ cursor: "pointer" }}>
                      {commentary.additionalEvidence.length} further relevant record(s) not cited in this commentary
                    </summary>
                    <ul className="refs-numbered" style={{ marginTop: 8 }}>
                      {commentary.additionalEvidence.map((r, i) => (
                        <li key={r.pmid} style={{ opacity: .85 }}>{vancouverPlain(r, i + 1)}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {!!commentary.contextualReferences?.length && (
                  <details style={{ marginTop: 10 }}>
                    <summary className="hint" style={{ cursor: "pointer" }}>
                      {commentary.contextualReferences.length} contextual record(s) match the population and outcome
                      but not the selected treatment — not cited or exported
                    </summary>
                    <ul className="refs-numbered" style={{ marginTop: 8 }}>
                      {commentary.contextualReferences.map((r) => (
                        <li key={r.pmid} style={{ opacity: .8 }}>
                          <a href={r.url} target="_blank" rel="noopener noreferrer" className="ref-link">
                            {r.authors ? `${r.authors}. ` : ""}{r.year ? `${r.year}. ` : ""}
                            {r.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {/* Zero references is a real state, not a validation pass: render the required
                    no-literature message instead of a "Reference Validation 0/0" panel. */}
                {hasNoReferences && (
                  <div className="empty-state" role="alert" aria-live="polite" style={{ marginTop: 14 }}>
                    <p className="empty-title">{NO_LITERATURE_MESSAGE}</p>
                    <p className="hint">{NO_LITERATURE_HINT}</p>
                  </div>
                )}
                {!hasNoReferences && commentary.refAudit && commentary.citationChecks && (() => {
                  const removedCitations = Array.isArray(commentary.removedCitations) ? commentary.removedCitations : [];
                  const baseAudits = Array.isArray(commentary.paperRefAudit) && commentary.paperRefAudit.length
                    ? commentary.paperRefAudit
                    : commentary.refAudit.map(aud => ({ ref: aud.title, audit: aud }));
                  const a = baseAudits.map(x => x.audit);
                  const c = commentary.citationChecks;
                  const resolved = a.filter(x => x.resolved).length;
                  const withDoi = a.filter(x => x.doiOk).length;
                  const matched = a.filter(x => x.score >= 3).length;
                  const allClean = a.length > 0 && matched === a.length && c.consistent;
                  return (
                    <div style={{ marginTop: 14 }}>
                      <h3 className="sec-h">Reference Validation</h3>
                      <p className="hint" style={{ marginTop: 4 }}>
                        Claim-to-reference audit: each source (PubMed · Europe PMC · OpenAlex · Crossref) is checked against the PICO elements (population · intervention · comparator · outcome) and every in-text citation is checked against the reference list.
                      </p>
                      <p className="hint" style={{ marginTop: 4 }}>
                        🔗 Sources resolved: {resolved}/{a.length} · Valid DOIs: {withDoi} · In-text citations matched: {c.citedRefs}/{c.totalRefs}
                      </p>
                      {allClean ? (
                        <div className="good-note">✔ All {a.length} references match the selected PICO elements and are properly cited in the text.</div>
                      ) : (
                        <>
                          {matched < a.length && (
                            <div className="advisory">⚠️ {a.length - matched} of {a.length} reference(s) did not fully match the selected PICO elements. A reference with an unmatched element may still be contextually related rather than directly supporting that specific element of the question.</div>
                          )}
                          <table className="pico"><tbody>
                            <tr><td><b>Design</b></td><td><b>Reference</b></td><td><b>Population</b></td><td><b>Intervention</b></td><td><b>Comparator</b></td><td><b>Outcome</b></td></tr>
                            {baseAudits.map(({ ref, audit: x }) => (
                              <tr key={x.pmid}>
                                <td>{x.design}</td>
                                <td><a href={x.url} target="_blank" rel="noopener noreferrer" className="ref-link">{ref.slice(0, 46)}{ref.length > 46 ? "…" : ""}</a></td>
                                <td>{x.population ? "✓" : "—"}</td>
                                <td>{x.intervention ? "✓" : "—"}</td>
                                <td>{x.comparator ? "✓" : "—"}</td>
                                <td>{x.outcome ? "✓" : "—"}</td>
                              </tr>))}
                          </tbody></table>
                          {c.uncited.length > 0 && (
                            <div className="advisory">⚠️ {c.uncited.length} reference(s) listed but never cited in text: {c.uncited.map(u => `"${u.slice(0, 44)}${u.length > 44 ? "…" : ""}"`).join("; ")}</div>
                          )}
                          {c.orphans.length > 0 && (
                            <div className="advisory">⚠️ In-text citations with no matching reference: {c.orphans.join("; ")}</div>
                          )}
                          {c.consistent && <div className="good-note">✔ All listed references are cited in text and every in-text citation matches a listed reference.</div>}
                        </>
                      )}
                      {removedCitations.length > 0 && (
                        <div className="advisory">
                          ⚠️ {removedCitations.length} in-text citation(s) could not be matched to any retrieved source and were removed so no unverifiable attribution is shown: {removedCitations.join("; ")}
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div className="row"><button className="secondary" disabled={commentaryLoading} onClick={() => generateCommentary()}>{commentaryLoading ? "⏳ Regenerating…" : "🔄 Regenerate"}</button></div>
              </>
            )}
          </section>
        )}

        {!!commentary?.fetchedReferences?.length && (
          <section className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span className="pill">📚 Evidence sources (PubMed · Europe PMC · OpenAlex · Crossref)</span>
              <button className="secondary" disabled={!!exporting} onClick={() => exportRefsPDF(commentary.fetchedReferences || [], commentary.title, "Evidence Sources", "sources")}>{exporting === "sources" ? "⏳ Generating PDF…" : "📄 References PDF"}</button>
            </div>
            {commentary.fetchedReferences.map(r => {
              const audit = commentary.refAudit?.find(x => x.pmid === r.pmid);
              return (
                <a key={r.pmid} className="result" href={r.url} target="_blank" rel="noopener noreferrer">
                  <div className="r-title">{r.title}</div>
                  <div className="r-meta">
{r.authors} · {r.journal} · {r.year} · {/^(pmc|epmc|oax|cr):/.test(r.pmid) ? `ID: ${r.pmid}` : `PMID: ${r.pmid}`}{r.doi ? ` · DOI: ${r.doi}` : ""}
                    {audit && (
                      <div style={{ marginTop: 4 }}>
                        <span className="tag">{audit.design}</span>
                        <span className="tag" style={{ opacity: audit.population ? 1 : .45 }}>pop {audit.population ? "✓" : "✗"}</span>
                        <span className="tag" style={{ opacity: audit.intervention ? 1 : .45 }}>int {audit.intervention ? "✓" : "✗"}</span>
                        <span className="tag" style={{ opacity: audit.comparator ? 1 : .45 }}>cmp {audit.comparator ? "✓" : "✗"}</span>
                        <span className="tag" style={{ opacity: audit.outcome ? 1 : .45 }}>out {audit.outcome ? "✓" : "✗"}</span>
                        <span className="tag" style={{ opacity: audit.resolved ? 1 : .45 }}>PMID {audit.resolved ? "✓" : "✗"}</span>
                      </div>
                    )}
                  </div>
                </a>
              );
            })}
          </section>
        )}

        <section className="card">
          <span className="pill">🎯 Your Answerable Question — pick one of the options</span>
          <table className="pico"><tbody>
            {formulation.elements.map(e => <tr key={e.label}><td>{e.label}</td><td>{e.value}</td></tr>)}
            <tr><td>Question</td><td>{activeQuestion}</td></tr>
          </tbody></table>
          {formulation.variants && formulation.variants.length > 1 && (
            <>
              <p className="hint" style={{ marginTop: 12 }}>Four ways to ask it — select your favourite:</p>
              <div className="variants">
                {formulation.variants.map((v, i) => (
                  <button key={i} type="button"
                    aria-pressed={variantIdx === i}
                    className={`variant-card ${variantIdx === i ? "selected" : ""}`}
                    onClick={() => selectVariant(i)}>
                    <span className="v-num">{variantIdx === i ? `✓ Selected (Option ${i + 1})` : `Option ${i + 1}`}</span>
                    <span className="v-q">{v.question}</span>
                    <span className="v-r">{v.rationale}</span>
                  </button>))}
              </div>
            </>
          )}
          <div className="final-q"><strong>{activeQuestion}</strong></div>
          {outcomes.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <span className="hint" style={{ display: "block", marginBottom: 6 }}>🎯 Selected outcomes for this commentary:</span>
              <div className="chips">{outcomes.map(o => <span key={o} className="chip chip-on">{o}</span>)}</div>
            </div>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="secondary" onClick={searchPubMed} disabled={pubmedLoading}>
              {pubmedLoading ? "⏳ Searching…" : "📚 Evidence on PubMed"}
            </button>
            <button className="secondary" disabled={!!exporting} onClick={exportQuestionPDF}>{exporting === "question" ? "⏳ Generating PDF…" : "🖨️ Question as PDF"}</button>
            <button className="secondary" onClick={exportWord}>📄 Word</button>
            <button className="secondary" onClick={() => navigator.clipboard.writeText(activeQuestion)}>📋 Copy</button>
          </div>
        </section>

        <section className="card">
          <span className="pill">📊 Quality Assessment ({total}/{maxTotal})</span>
          {formulation.scores.map(s => (
            <div key={s.name} className="score-row">
              <span className="score-name">{s.name}</span>
              <div className="bar-bg"><div className="bar" style={{ width: `${(s.value / 20) * 100}%` }} /></div>
              <span className="score-val">{s.value}/20</span>
            </div>))}
          {formulation.advisories.map((adv, i) => <div key={i} className="advisory">⚠️ {adv}</div>)}
          {!formulation.advisories.length && <div className="good-note">✔ Well-formulated answerable question.</div>}
        </section>

        {pubmed && (
          <section className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span className="pill">📚 Evidence from PubMed</span>
              {pubmed.length > 0 && <button className="secondary" disabled={!!exporting} onClick={() => exportRefsPDF(pubmed, formulation.finalQuestion, "PubMed Search Results", "pubmed")}>{exporting === "pubmed" ? "⏳ Generating PDF…" : "📄 References PDF"}</button>}
            </div>
            {pubmed.length === 0 && <p className="hint">No results found.</p>}
            {pubmed.map(r => (
              <a key={r.pmid} className="result" href={`https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`} target="_blank" rel="noopener">
                <div className="r-title">{r.title}</div>
                <div className="r-meta">{r.authors} · {r.journal} · {r.year} · PMID: {r.pmid}{r.doi ? ` · DOI: ${r.doi}` : ""}</div>
              </a>))}
          </section>
        )}

        <div className="row"><button className="link" onClick={() => router.push("/")}>← Start a new question</button></div>
      </main>
      <footer>Version 3.0 · Copyright©RaoufRoshdy2026</footer>
    </div>
  );
}
