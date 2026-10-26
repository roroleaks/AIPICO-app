import test from "node:test";
import assert from "node:assert/strict";
import {
  SECURITY_HEADERS,
  ALLOWED_ORIGINS,
  isAllowedOrigin,
  corsHeaders,
} from "./security-headers.ts";

// ── SH1. SECURITY_HEADERS contains all required headers ───────────────────────
test("SH1. SECURITY_HEADERS contains Content-Security-Policy", () => {
  const csp = SECURITY_HEADERS.find(h => h.key === "Content-Security-Policy");
  assert.ok(csp, "Content-Security-Policy header must be present");
  assert.ok(csp!.value.includes("default-src 'self'"), "default-src 'self' required");
  assert.ok(csp!.value.includes("frame-ancestors 'none'"), "frame-ancestors 'none' required");
  assert.ok(csp!.value.includes("object-src 'none'"), "object-src 'none' required");
  assert.ok(csp!.value.includes("base-uri 'none'"), "base-uri 'none' required");
  assert.ok(csp!.value.includes("form-action 'self'"), "form-action 'self' required");
});

test("SH2. SECURITY_HEADERS contains X-Frame-Options: DENY", () => {
  const h = SECURITY_HEADERS.find(h => h.key === "X-Frame-Options");
  assert.ok(h, "X-Frame-Options header must be present");
  assert.equal(h!.value, "DENY");
});

test("SH3. SECURITY_HEADERS contains X-Content-Type-Options: nosniff", () => {
  const h = SECURITY_HEADERS.find(h => h.key === "X-Content-Type-Options");
  assert.ok(h, "X-Content-Type-Options header must be present");
  assert.equal(h!.value, "nosniff");
});

test("SH4. SECURITY_HEADERS contains Referrer-Policy", () => {
  const h = SECURITY_HEADERS.find(h => h.key === "Referrer-Policy");
  assert.ok(h, "Referrer-Policy header must be present");
  assert.ok(h!.value.length > 0, "Referrer-Policy value must be non-empty");
});

test("SH5. SECURITY_HEADERS contains Permissions-Policy that revokes camera, mic, geo", () => {
  const h = SECURITY_HEADERS.find(h => h.key === "Permissions-Policy");
  assert.ok(h, "Permissions-Policy header must be present");
  assert.ok(h!.value.includes("camera=()"), "camera must be revoked");
  assert.ok(h!.value.includes("microphone=()"), "microphone must be revoked");
  assert.ok(h!.value.includes("geolocation=()"), "geolocation must be revoked");
});

test("SH6. SECURITY_HEADERS contains Strict-Transport-Security", () => {
  const h = SECURITY_HEADERS.find(h => h.key === "Strict-Transport-Security");
  assert.ok(h, "Strict-Transport-Security header must be present");
  assert.ok(h!.value.includes("max-age="), "must include max-age directive");
  assert.ok(h!.value.includes("includeSubDomains"), "must include includeSubDomains");
});

// ── SH7. ALLOWED_ORIGINS list ─────────────────────────────────────────────────
test("SH7. ALLOWED_ORIGINS contains both confirmed Vercel hostnames", () => {
  assert.ok(ALLOWED_ORIGINS.includes("https://aipico.vercel.app"),
    "primary origin aipico.vercel.app must be present");
  assert.ok(ALLOWED_ORIGINS.includes("https://aipico-app.vercel.app"),
    "secondary origin aipico-app.vercel.app must be present");
  // Must NOT contain a bare wildcard
  assert.ok(!ALLOWED_ORIGINS.includes("*"), "wildcard * must not be in the explicit list");
});

// ── SH8-SH12. isAllowedOrigin logic ──────────────────────────────────────────
test("SH8. isAllowedOrigin accepts primary origin", () => {
  assert.ok(isAllowedOrigin("https://aipico.vercel.app"));
});

test("SH9. isAllowedOrigin accepts secondary origin", () => {
  assert.ok(isAllowedOrigin("https://aipico-app.vercel.app"));
});

test("SH10. isAllowedOrigin accepts preview deployment matching aipico*.vercel.app pattern", () => {
  assert.ok(isAllowedOrigin("https://aipico-abc123.vercel.app"));
  assert.ok(isAllowedOrigin("https://aipico-pr-42.vercel.app"));
});

test("SH11. isAllowedOrigin rejects unrelated origins and wildcard", () => {
  assert.equal(isAllowedOrigin("https://evil.example.com"), false);
  assert.equal(isAllowedOrigin("http://aipico.vercel.app"), false, "HTTP (non-HTTPS) must be rejected");
  assert.equal(isAllowedOrigin("*"), false);
  assert.equal(isAllowedOrigin(null), false);
  assert.equal(isAllowedOrigin(""), false);
});

test("SH12. isAllowedOrigin rejects unrelated vercel.app domains", () => {
  assert.equal(isAllowedOrigin("https://attacker-aipico.vercel.app"), false,
    "prefix spoofing must be rejected");
  assert.equal(isAllowedOrigin("https://other-project.vercel.app"), false);
});

// ── SH13. corsHeaders returns correct fields ──────────────────────────────────
test("SH13. corsHeaders returns expected CORS fields for a matched origin", () => {
  const h = corsHeaders("https://aipico.vercel.app");
  assert.equal(h["Access-Control-Allow-Origin"], "https://aipico.vercel.app");
  assert.ok(h["Access-Control-Allow-Methods"].includes("POST"), "POST must be allowed");
  assert.ok(h["Access-Control-Allow-Methods"].includes("OPTIONS"), "OPTIONS must be allowed");
  assert.ok(h["Access-Control-Allow-Headers"].includes("Content-Type"), "Content-Type header must be allowed");
  assert.equal(h["Vary"], "Origin", "Vary: Origin must be set to prevent cache poisoning");
});

test("SH14. corsHeaders does NOT emit Access-Control-Allow-Origin: * (wildcard)", () => {
  const h = corsHeaders("https://aipico.vercel.app");
  assert.notEqual(h["Access-Control-Allow-Origin"], "*", "wildcard ACAO must never be emitted");
});

// ── SH15. CSP does not block same-origin fetches ─────────────────────────────
test("SH15. CSP connect-src includes 'self' to allow same-origin /api/* fetches", () => {
  const csp = SECURITY_HEADERS.find(h => h.key === "Content-Security-Policy")!;
  assert.ok(csp.value.includes("connect-src 'self'"),
    "connect-src 'self' must be present for in-app API calls");
});

// ── SH16. CSP does not include unsafe-eval ───────────────────────────────────
test("SH16. CSP does not include unsafe-eval", () => {
  const csp = SECURITY_HEADERS.find(h => h.key === "Content-Security-Policy")!;
  assert.ok(!csp.value.includes("'unsafe-eval'"),
    "'unsafe-eval' must not be present");
});

// ── SH17. Security headers structure validation ───────────────────────────────
test("SH17. Every entry in SECURITY_HEADERS has non-empty key and value", () => {
  for (const h of SECURITY_HEADERS) {
    assert.ok(typeof h.key === "string" && h.key.length > 0,
      `Header key must be non-empty string: ${JSON.stringify(h)}`);
    assert.ok(typeof h.value === "string" && h.value.length > 0,
      `Header value must be non-empty string for key: ${h.key}`);
  }
});
