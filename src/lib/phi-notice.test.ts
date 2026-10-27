import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PHI_NOTICE_TEXT } from "./phi-notice.ts";

test("PHI-1. Notice text matches chosen Option 1 verbatim", () => {
  const expected =
    "Do not enter patient identifiers (such as names, medical record numbers, dates of birth, or contact details). Text entered here is processed by this application to formulate clinical search queries and evidence summaries.";
  assert.equal(PHI_NOTICE_TEXT, expected);
});

test("PHI-2. Component uses accessible landmarks and attributes", () => {
  const componentPath = path.resolve(import.meta.dirname, "../components/PhiNotice.tsx");
  const src = fs.readFileSync(componentPath, "utf8");
  assert.ok(src.includes('role="note"'), "Must use role='note' landmark");
  assert.ok(src.includes('aria-label="Patient Privacy Notice"'), "Must have accessible label");
});

test("PHI-3. Page renders PhiNotice before submission button", () => {
  const pagePath = path.resolve(import.meta.dirname, "../app/page.tsx");
  const src = fs.readFileSync(pagePath, "utf8");
  assert.ok(src.includes("PhiNotice"), "page.tsx must import PhiNotice");
  assert.ok(src.includes("<PhiNotice />"), "page.tsx must render <PhiNotice />");

  const noticeIndex = src.indexOf("<PhiNotice />");
  const submitIndex = src.indexOf("<button className=\"primary\" onClick={start}");
  assert.ok(noticeIndex !== -1, "PhiNotice must be present in page markup");
  assert.ok(submitIndex !== -1, "Submit button must be present in page markup");
  assert.ok(noticeIndex < submitIndex, "PhiNotice must appear before submission button");
});
