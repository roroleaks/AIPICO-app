import test from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit } from "./rate-limiter.ts";

test("P2-1. checkRateLimit handles sliding-window requests under the 20/min ceiling", async () => {
  const ip = "192.168.1.100";
  for (let i = 0; i < 20; i++) {
    const res = await checkRateLimit(ip, "engine-test", 20, 60);
    assert.equal(res.success, true, `Request ${i + 1} should be permitted`);
  }
  const over = await checkRateLimit(ip, "engine-test", 20, 60);
  assert.equal(over.success, false, "Request 21 must be rate limited");
  assert.equal(over.remaining, 0);
});

test("P2-2. checkRateLimit isolates buckets by IP address", async () => {
  const ip1 = "10.1.1.1";
  const ip2 = "10.1.1.2";
  for (let i = 0; i < 20; i++) {
    await checkRateLimit(ip1, "engine-test-iso", 20, 60);
  }
  const res1 = await checkRateLimit(ip1, "engine-test-iso", 20, 60);
  assert.equal(res1.success, false, "ip1 should be exhausted");

  const res2 = await checkRateLimit(ip2, "engine-test-iso", 20, 60);
  assert.equal(res2.success, true, "ip2 should still have quota");
});

test("P3-1. package.json specifies secure versions for next and zod", async () => {
  const fs = await import("fs");
  const path = await import("path");
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"));
  const nextVer = pkg.dependencies.next || "";
  const zodVer = pkg.dependencies.zod || "";
  assert.match(nextVer, /16\.4\.[6-9]|16\.[5-9]|1[7-9]/, "Next.js must be at least 16.4.6");
  assert.match(zodVer, /4\.[6-9]\.[6-9]|4\.[7-9]|[5-9]/, "Zod must be at least 4.6.6");
});

test("P3-3. layout.tsx configures font fallbacks for build reproducibility", async () => {
  const fs = await import("fs");
  const path = await import("path");
  const layout = fs.readFileSync(path.resolve(process.cwd(), "src/app/layout.tsx"), "utf8");
  assert.ok(layout.includes("fallback:"), "layout.tsx must configure font fallback list");
  assert.ok(layout.includes("display: \"swap\""), "layout.tsx must use display: swap");
});

test("P3-4. UI and generator text reflects accurate Vancouver description and outcome guidance", async () => {
  const fs = await import("fs");
  const path = await import("path");
  const pdfGen = fs.readFileSync(path.resolve(process.cwd(), "src/lib/pdf-generator.ts"), "utf8");
  const docxGen = fs.readFileSync(path.resolve(process.cwd(), "src/lib/docx-generator.ts"), "utf8");

  assert.ok(pdfGen.includes("Vancouver (superscript numerals)"), "PDF generator must use accurate Vancouver label");
  assert.ok(docxGen.includes("Vancouver (superscript numerals)"), "DOCX generator must use accurate Vancouver label");

  const gapPath = path.resolve(process.cwd(), "src/app/gap/page.tsx");
  const questionPath = path.resolve(process.cwd(), "src/app/question/page.tsx");

  if (fs.existsSync(gapPath) && fs.existsSync(questionPath)) {
    const gapPage = fs.readFileSync(gapPath, "utf8");
    const questionPage = fs.readFileSync(questionPath, "utf8");

    assert.ok(!gapPage.includes("🕳️"), "Step 2 gap page must not use black hole emoji");
    assert.ok(gapPage.includes("🗺️ Step 2"), "Step 2 must use map emoji");
    assert.ok(gapPage.includes("🔍 Research gaps"), "Research gaps must use search emoji");

    assert.ok(!questionPage.includes("Uppercase / No Brackets"), "Question page must not use old Vancouver phrasing");
    assert.ok(questionPage.includes("Vancouver (superscript numerals)"), "Question page must label Vancouver accurately");
    assert.ok(questionPage.includes("suggested outcomes — verify against the relevant published core outcome set"), "Step 3 guidance must be accurate");
  } else {
    // Legacy flow pages retired in v4 workflow redesign
    assert.ok(!fs.existsSync(gapPath), "Legacy gap page must be removed in v4");
    assert.ok(!fs.existsSync(questionPath), "Legacy question page must be removed in v4");
  }
});



