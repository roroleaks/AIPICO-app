import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveCanonicalUrl, getCanonicalUrl, buildCanonicalMetadata } from "./site-config.ts";

test("OG1. resolveCanonicalUrl defaults to https://aipico.vercel.app", () => {
  const url = resolveCanonicalUrl({});
  assert.equal(url, "https://aipico.vercel.app");
});

test("OG2. resolveCanonicalUrl respects CANONICAL_URL environment variable", () => {
  const url = resolveCanonicalUrl({ CANONICAL_URL: "https://custom.example.com/" });
  assert.equal(url, "https://custom.example.com");
});

test("OG3. resolveCanonicalUrl respects NEXT_PUBLIC_SITE_URL environment variable", () => {
  const url = resolveCanonicalUrl({ NEXT_PUBLIC_SITE_URL: "https://app.example.com" });
  assert.equal(url, "https://app.example.com");
});

test("OG4. resolveCanonicalUrl respects VERCEL_PROJECT_PRODUCTION_URL", () => {
  const url = resolveCanonicalUrl({ VERCEL_PROJECT_PRODUCTION_URL: "aipico-prod.vercel.app" });
  assert.equal(url, "https://aipico-prod.vercel.app");
});

test("OG5. getCanonicalUrl appends path correctly", () => {
  const env = { CANONICAL_URL: "https://aipico.vercel.app" };
  assert.equal(getCanonicalUrl("", env), "https://aipico.vercel.app");
  assert.equal(getCanonicalUrl("/", env), "https://aipico.vercel.app/");
  assert.equal(getCanonicalUrl("/paper", env), "https://aipico.vercel.app/paper");
  assert.equal(getCanonicalUrl("gap", env), "https://aipico.vercel.app/gap");
});

test("OG6. buildCanonicalMetadata outputs consistent metadataBase, openGraph.url, and alternates.canonical", () => {
  const meta = buildCanonicalMetadata({ CANONICAL_URL: "https://aipico.vercel.app" });
  assert.equal(meta.metadataBase.origin, "https://aipico.vercel.app");
  assert.equal(meta.openGraph.url, "https://aipico.vercel.app");
  assert.equal(meta.alternates.canonical, "/");
});

test("OG7. layout.tsx imports CANONICAL_URL and sets alternates.canonical", () => {
  const layoutPath = path.resolve(import.meta.dirname, "../app/layout.tsx");
  const layoutSrc = fs.readFileSync(layoutPath, "utf8");
  assert.ok(layoutSrc.includes("CANONICAL_URL"), "layout.tsx must reference CANONICAL_URL");
  assert.ok(layoutSrc.includes("alternates:"), "layout.tsx must specify alternates");
  assert.ok(layoutSrc.includes('canonical: "/"'), "layout.tsx must specify canonical: '/'");
});
