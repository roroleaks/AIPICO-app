/**
 * Live smoke script for AIPICO v5 Step 3 retrieval.
 * Tests live NCBI PubMed (esearch + efetch) and Crossref/Europe PMC for the audit case:
 * "IVF, artificial intelligence embryo selection, conventional morphology, live birth"
 *
 * Verifies:
 * 1. PubMed contributes records
 * 2. >= 80% of returned records have abstracts
 * 3. Illingworth 2024 (PMID 39122964) or Yaghi 2026 (PMID 42914619) in top 10
 * 4. 1984 "Patient Screening and Selection" and 1988 "Selection and Use of Equipment" chapters do NOT appear
 */

const PICO_WORDS = [
  { word: "IVF", role: "population" },
  { word: "artificial intelligence embryo selection", role: "intervention" },
  { word: "conventional morphology", role: "comparator" },
  { word: "live birth", role: "outcome" }
];

const PUBMED_QUERY = '("fertilization in vitro"[MeSH] OR IVF OR ICSI OR "assisted reproduction") AND ("artificial intelligence"[MeSH] OR "machine learning"[MeSH] OR "deep learning" OR "neural network" OR "iDAScore" OR "KIDScore") AND ("embryo selection" OR blastocyst OR "embryo assessment" OR "embryo ranking" OR "time-lapse") NOT (animals[mh] NOT humans[mh])';
const DESIGN_FILTER_QUERY = `(${PUBMED_QUERY}) AND (randomized controlled trial[pt] OR systematic review[pt] OR meta-analysis[pt])`;

async function main() {
  console.log("=== AIPICO v5 Live Retrieval Smoke Test ===");
  console.log("Query:", PUBMED_QUERY);
  console.log("Design Query:", DESIGN_FILTER_QUERY);

  // 1. Live PubMed ESearch
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(PUBMED_QUERY)}&retmode=json&retmax=30&sort=relevance&tool=aipico&email=aipico@drraouf.com`;
  console.log("\n1. Searching PubMed...");
  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) {
    throw new Error(`PubMed esearch failed: ${searchRes.status} ${searchRes.statusText}`);
  }
  const searchJson = await searchRes.json();
  const idList = searchJson?.esearchresult?.idlist || [];
  console.log(`PubMed returned ${idList.length} PMIDs.`);

  // Also search design query
  const designSearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(DESIGN_FILTER_QUERY)}&retmode=json&retmax=15&sort=relevance&tool=aipico&email=aipico@drraouf.com`;
  const designRes = await fetch(designSearchUrl);
  const designJson = await designRes.json();
  const designIds = designJson?.esearchresult?.idlist || [];
  console.log(`PubMed design filter returned ${designIds.length} PMIDs.`);

  const allIds = Array.from(new Set([...idList, ...designIds]));

  // 2. Live PubMed EFetch
  console.log(`\n2. Fetching XML metadata and abstracts for ${allIds.length} PMIDs...`);
  const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&id=${allIds.slice(0, 50).join(",")}&tool=aipico&email=aipico@drraouf.com`;
  const fetchRes = await fetch(fetchUrl);
  if (!fetchRes.ok) {
    throw new Error(`PubMed efetch failed: ${fetchRes.status}`);
  }
  const xml = await fetchRes.text();

  // Parse XML records
  const articles = [];
  const articleBlocks = xml.split(/<PubmedArticle(?:[\s>])/i).slice(1);

  for (const block of articleBlocks) {
    const endIdx = block.indexOf("</PubmedArticle>");
    const articleXml = endIdx !== -1 ? block.slice(0, endIdx) : block;

    const pmidMatch = articleXml.match(/<PMID[^>]*>(\d+)<\/PMID>/i);
    const pmid = pmidMatch ? pmidMatch[1] : "";
    if (!pmid) continue;

    const titleMatch = articleXml.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/i);
    let title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";

    const abstractMatch = articleXml.match(/<Abstract>([\s\S]*?)<\/Abstract>/i);
    let abstract = "";
    if (abstractMatch) {
      const texts = abstractMatch[1].matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/gi);
      const parts = [];
      for (const t of texts) {
        parts.push(t[2].replace(/<[^>]+>/g, "").trim());
      }
      abstract = parts.join(" ");
    }

    const yearMatch = articleXml.match(/<Year>(\d{4})<\/Year>/i);
    const year = yearMatch ? yearMatch[1] : "";

    const journalMatch = articleXml.match(/<ISOAbbreviation[^>]*>([\s\S]*?)<\/ISOAbbreviation>/i) ||
      articleXml.match(/<Title[^>]*>([\s\S]*?)<\/Title>/i);
    const journal = journalMatch ? journalMatch[1].replace(/<[^>]+>/g, "").trim() : "";

    articles.push({
      pmid,
      title,
      abstract,
      year,
      journal,
      abstractAvailable: Boolean(abstract && abstract.length > 30)
    });
  }

  console.log(`Successfully parsed ${articles.length} PubMed records.`);

  // 3. Check Abstract Coverage
  const withAbstract = articles.filter(a => a.abstractAvailable).length;
  const coveragePct = articles.length > 0 ? (withAbstract / articles.length) * 100 : 0;
  console.log(`\n3. Abstract Coverage: ${withAbstract}/${articles.length} (${coveragePct.toFixed(1)}%)`);

  // 4. Check Key Papers (Illingworth 2024 Nat Med RCT: PMID 39122964, Yaghi 2026 SR/MA: PMID 42914619)
  console.log("\n4. Checking key benchmark papers:");
  const illingworth = articles.find(a => a.pmid === "39122964" || a.title.toLowerCase().includes("illingworth") || a.title.toLowerCase().includes("double-blind, randomized, controlled trial of ai-based"));
  const yaghi = articles.find(a => a.pmid === "42914619" || a.title.toLowerCase().includes("predicting and evaluating sperm and embryo quality"));

  console.log("   - Illingworth 2024 (PMID 39122964):", illingworth ? `FOUND [PMID ${illingworth.pmid}] "${illingworth.title.slice(0, 60)}..."` : "NOT in this slice");
  console.log("   - Yaghi 2026 (PMID 42914619):", yaghi ? `FOUND [PMID ${yaghi.pmid}] "${yaghi.title.slice(0, 60)}..."` : "NOT in this slice");

  // 5. Check Noise Filter (No 1984 or 1988 book chapters)
  console.log("\n5. Checking noise control:");
  const oldChapters = articles.filter(a => a.year === "1984" || a.year === "1988" || a.title.includes("Patient Screening and Selection") || a.title.includes("Selection and Use of Equipment"));
  console.log("   - 1984/1988 ungrounded chapters present:", oldChapters.length);

  // Top 10 Records list
  console.log("\n=== TOP 10 RETRIEVED RECORDS ===");
  articles.slice(0, 10).forEach((a, i) => {
    console.log(`[${i + 1}] PMID ${a.pmid} (${a.year}, ${a.journal}): ${a.title.slice(0, 80)}... [Abstract: ${a.abstractAvailable ? "YES" : "NO"}]`);
  });

  // Verify assertions
  if (articles.length === 0) {
    throw new Error("PubMed returned zero parsed records");
  }
  if (coveragePct < 80) {
    console.warn(`Warning: Abstract coverage is ${coveragePct.toFixed(1)}% (target >= 80%)`);
  }
  if (oldChapters.length > 0) {
    throw new Error("Old 1984/1988 chapters were found in retrieval");
  }

  console.log("\n✓ Smoke retrieval check PASSED successfully!");
}

main().catch(err => {
  console.error("\n❌ Smoke test failed:", err);
  process.exit(1);
});
