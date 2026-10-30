import type { AuditableRef } from "./relevance.ts";

export type CitationStyle = "vancouver" | "apa" | "harvard";

export interface ParsedAuthor {
  surname: string;
  initials: string;
  raw: string;
}

export function parseAuthors(authorsStr?: string | null): ParsedAuthor[] {
  if (!authorsStr) return [];
  // Authors are typically separated by commas or semicolons
  // Format could be "Owen DD, Hankins G" or "Smith, J. A., & Doe, B."
  const clean = authorsStr.replace(/\s+and\s+/gi, ", ").replace(/&/g, ", ");
  const rawParts = clean.split(/[,;]+/).map(s => s.trim()).filter(Boolean);

  const results: ParsedAuthor[] = [];

  for (let i = 0; i < rawParts.length; i++) {
    const part = rawParts[i];
    if (/^et al\.?$/i.test(part)) continue;

    // Check if format is "Surname Initials" (e.g. "Owen DD" or "Morton RK")
    const matchSurnameInitials = part.match(/^([A-Za-z\-'\s]+?)\s+([A-Z]{1,4})$/);
    if (matchSurnameInitials) {
      results.push({
        surname: matchSurnameInitials[1].trim(),
        initials: matchSurnameInitials[2].split("").join("."),
        raw: part
      });
      continue;
    }

    // Check if next part is initials (e.g. "Smith", "J. A.")
    if (i + 1 < rawParts.length && /^[A-Z](\.[A-Z])*\.?$/.test(rawParts[i + 1])) {
      results.push({
        surname: part,
        initials: rawParts[i + 1],
        raw: `${part}, ${rawParts[i + 1]}`
      });
      i++;
      continue;
    }

    // Fallback: take last word as initials if uppercase, else whole part as surname
    const words = part.split(/\s+/);
    if (words.length > 1 && /^[A-Z]{1,3}$/.test(words[words.length - 1])) {
      results.push({
        surname: words.slice(0, -1).join(" "),
        initials: words[words.length - 1].split("").join("."),
        raw: part
      });
    } else {
      results.push({
        surname: part,
        initials: "",
        raw: part
      });
    }
  }

  return results;
}

/**
 * Format an in-text author string (e.g. "Owen et al.", "Hodgetts Morton & Morris")
 */
export function formatInTextAuthors(
  authorsStr: string | undefined | null,
  style: "apa" | "harvard"
): string {
  const parsed = parseAuthors(authorsStr);
  if (!parsed.length) return "Anonymous";

  const ampersand = style === "apa" ? "&" : "and";

  if (parsed.length === 1) {
    return parsed[0].surname;
  }
  if (parsed.length === 2) {
    return `${parsed[0].surname} ${ampersand} ${parsed[1].surname}`;
  }
  return `${parsed[0].surname} et al.`;
}

/**
 * Format a reference item according to Vancouver style (ICMJE/NLM).
 * Sequential number, no quotes, year follows journal.
 */
export function formatVancouver(ref: AuditableRef, index?: number): string {
  const prefix = typeof index === "number" && index > 0 ? `${index}. ` : "";
  const authors = ref.authors ? `${ref.authors.trim().replace(/\.$/, "")}.` : "";
  const title = ref.title ? `${ref.title.trim().replace(/\.$/, "")}.` : "";
  const journal = ref.journal ? `${ref.journal.trim().replace(/\.$/, "")}.` : "";
  const year = ref.year ? `${String(ref.year).trim()}.` : "";
  const doi = ref.doi ? `doi:${ref.doi.replace(/^doi:\s*/i, "")}` : "";
  const url = ref.url || (ref.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${ref.pmid}/` : "");

  return `${prefix}${authors} ${title} ${journal ? `${journal} ${year}`.trim() : year} ${doi} ${url}`
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Format a reference item according to APA 7th Edition style.
 * Author, A. A., & Author, B. B. (Year). Title of article in sentence case. Journal Name, Volume(Issue), pages. https://doi.org/...
 */
export function formatApa(ref: AuditableRef): string {
  const parsed = parseAuthors(ref.authors);
  let authorsFormatted = "";

  if (parsed.length === 0) {
    authorsFormatted = "Anonymous.";
  } else if (parsed.length === 1) {
    authorsFormatted = `${parsed[0].surname}${parsed[0].initials ? `, ${parsed[0].initials}.` : ""}`;
  } else if (parsed.length === 2) {
    const a1 = `${parsed[0].surname}${parsed[0].initials ? `, ${parsed[0].initials}.` : ""}`;
    const a2 = `${parsed[1].surname}${parsed[1].initials ? `, ${parsed[1].initials}.` : ""}`;
    authorsFormatted = `${a1}, & ${a2}`;
  } else {
    // List up to 20 authors in APA 7th, or first author + et al. for compact display
    const list = parsed.slice(0, 6).map(p => `${p.surname}${p.initials ? `, ${p.initials}.` : ""}`);
    if (parsed.length > 6) {
      authorsFormatted = `${list.join(", ")}, et al.`;
    } else {
      const allExceptLast = list.slice(0, -1).join(", ");
      const last = list[list.length - 1];
      authorsFormatted = `${allExceptLast}, & ${last}`;
    }
  }

  if (authorsFormatted && !authorsFormatted.endsWith(".")) authorsFormatted += ".";

  const year = ref.year ? `(${String(ref.year).trim()}).` : "(n.d.).";
  const title = ref.title ? `${ref.title.trim().replace(/\.$/, "")}.` : "";
  const journal = ref.journal ? `${ref.journal.trim().replace(/\.$/, "")}.` : "";
  const doiUrl = ref.doi
    ? `https://doi.org/${ref.doi.replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:\s*/i, "")}`
    : ref.url || (ref.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${ref.pmid}/` : "");

  return `${authorsFormatted} ${year} ${title} ${journal} ${doiUrl}`.replace(/\s+/g, " ").trim();
}

/**
 * Format a reference item according to Harvard style.
 * Author, A.A. and Author, B.B., Year. Title of article in sentence case. Journal Name, Volume(Issue), pp.pages.
 */
export function formatHarvard(ref: AuditableRef): string {
  const parsed = parseAuthors(ref.authors);
  let authorsFormatted = "";

  if (parsed.length === 0) {
    authorsFormatted = "Anonymous";
  } else if (parsed.length === 1) {
    authorsFormatted = `${parsed[0].surname}${parsed[0].initials ? `, ${parsed[0].initials.replace(/\./g, "")}` : ""}`;
  } else if (parsed.length === 2) {
    const a1 = `${parsed[0].surname}${parsed[0].initials ? `, ${parsed[0].initials.replace(/\./g, "")}` : ""}`;
    const a2 = `${parsed[1].surname}${parsed[1].initials ? `, ${parsed[1].initials.replace(/\./g, "")}` : ""}`;
    authorsFormatted = `${a1} and ${a2}`;
  } else {
    authorsFormatted = `${parsed[0].surname}${parsed[0].initials ? `, ${parsed[0].initials.replace(/\./g, "")}` : ""} et al.`;
  }

  const year = ref.year ? `${String(ref.year).trim()}.` : "n.d.";
  const title = ref.title ? `${ref.title.trim().replace(/\.$/, "")}.` : "";
  const journal = ref.journal ? `${ref.journal.trim().replace(/\.$/, "")}.` : "";
  const url = ref.doi
    ? `doi:${ref.doi.replace(/^doi:\s*/i, "")}`
    : ref.url || (ref.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${ref.pmid}/` : "");

  return `${authorsFormatted}, ${year} ${title} ${journal} Available at: ${url}`.replace(/\s+/g, " ").trim();
}

/**
 * Formats a reference list given the records and citation style.
 */
export function formatBibliographyList(
  records: AuditableRef[],
  style: CitationStyle = "vancouver"
): Array<{ id: string; text: string; index?: number; record: AuditableRef }> {
  if (style === "vancouver") {
    // Vancouver preserves order of appearance in narrative
    return records.map((r, i) => ({
      id: r.pmid || `ref-${i + 1}`,
      text: formatVancouver(r, i + 1),
      index: i + 1,
      record: r
    }));
  }

  // APA and Harvard sort alphabetically by first author surname
  const sorted = [...records].sort((a, b) => {
    const aName = (a.authors || "").toLowerCase();
    const bName = (b.authors || "").toLowerCase();
    return aName.localeCompare(bName);
  });

  return sorted.map((r, i) => ({
    id: r.pmid || `ref-${i + 1}`,
    text: style === "apa" ? formatApa(r) : formatHarvard(r),
    index: i + 1,
    record: r
  }));
}

export function toSuperscript(str: string): string {
  const map: Record<string, string> = {
    "0": "⁰",
    "1": "¹",
    "2": "²",
    "3": "³",
    "4": "⁴",
    "5": "⁵",
    "6": "⁶",
    "7": "⁷",
    "8": "⁸",
    "9": "⁹",
    "-": "⁻",
    ",": ","
  };
  return str.split("").map(c => map[c] || c).join("");
}

export function formatVancouverSuperscript(text: string): string {
  if (!text) return "";
  // If citation follows ? or !, remove trailing period after citation if any
  let res = text.replace(/([?!])\s*\[([\d\s,\-]+)\]\.?/g, (_m, punct, inner) => {
    const clean = inner.replace(/\s+/g, "");
    return `${punct}${toSuperscript(clean)}`;
  });
  // General citation replace: remove space before bracket and trailing dot if attached
  res = res.replace(/\s*\[([\d\s,\-]+)\]\.?/g, (match, inner) => {
    const clean = inner.replace(/\s+/g, "");
    const endsWithDot = match.endsWith(".");
    return `${toSuperscript(clean)}${endsWithDot ? "." : ""}`;
  });
  return res;
}

/**
 * Expand bracket tokens like [1], [1, 2], [1-3] into the target citation style.
 *
 * For Vancouver:
 *  Strips the brackets and keeps purely uppercase superscript numbers: "1", "1, 2", "1-3".
 *  (No brackets).
 *
 * For APA:
 *  Converts "[1]" to "(Owen & Hankins, 2020)"
 *  Converts "[1, 2]" to "(Hodgetts Morton & Morris, 2021; Owen & Hankins, 2020)"
 *
 * For Harvard:
 *  Converts "[1]" to "(Owen and Hankins 2020)"
 *  Converts "[1, 2]" to "(Hodgetts Morton and Morris 2021, Owen and Hankins 2020)"
 */
export function transformCitationsInText(
  text: string,
  records: AuditableRef[],
  style: CitationStyle = "vancouver"
): string {
  if (!text) return "";

  const tokenRegex = /\[([\d\s,\-]+)\]/g;

  return text.replace(tokenRegex, (match, inner) => {
    // Parse indices inside bracket
    const nums: number[] = [];
    for (const part of inner.split(",")) {
      const p = part.trim();
      if (p.includes("-")) {
        const [startStr, endStr] = p.split("-").map((s: string) => parseInt(s.trim(), 10));
        if (!isNaN(startStr) && !isNaN(endStr)) {
          for (let n = startStr; n <= endStr; n++) nums.push(n);
        }
      } else {
        const n = parseInt(p, 10);
        if (!isNaN(n)) nums.push(n);
      }
    }

    if (style === "vancouver") {
      // NOTE: Vancouver must be uppercase superscript and with NO brackets.
      // We return the inner clean numbers (e.g. "1", "1, 2", "1-3")
      return inner.trim();
    }

    // Resolve matching records for APA / Harvard
    const matchedRecords: AuditableRef[] = [];
    for (const num of nums) {
      const rec = records[num - 1];
      if (rec && !matchedRecords.includes(rec)) {
        matchedRecords.push(rec);
      }
    }

    if (!matchedRecords.length) {
      return match; // Fallback if no record found
    }

    if (style === "apa") {
      const formattedCites = matchedRecords.map(r => {
        const author = formatInTextAuthors(r.authors, "apa");
        const yr = r.year ? String(r.year).trim() : "n.d.";
        return `${author}, ${yr}`;
      });
      return `(${formattedCites.join("; ")})`;
    }

    if (style === "harvard") {
      const formattedCites = matchedRecords.map(r => {
        const author = formatInTextAuthors(r.authors, "harvard");
        const yr = r.year ? String(r.year).trim() : "n.d.";
        return `${author} ${yr}`;
      });
      return `(${formattedCites.join(", ")})`;
    }

    return inner.trim();
  });
}
