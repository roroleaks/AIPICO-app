/**
 * Canonical site origin configuration.
 *
 * Single source of truth for the application's canonical domain across
 * metadataBase, OpenGraph url, Twitter card, and canonical link tags.
 *
 * Precedence:
 * 1. process.env.CANONICAL_URL
 * 2. process.env.NEXT_PUBLIC_SITE_URL
 * 3. https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}
 * 4. Default: "https://aipico.vercel.app"
 */
export function resolveCanonicalUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw =
    env.CANONICAL_URL ||
    env.NEXT_PUBLIC_SITE_URL ||
    (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    "https://aipico.vercel.app";

  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.startsWith("http://") || trimmed.startsWith("https://")
    ? trimmed
    : `https://${trimmed}`;
}

export const CANONICAL_URL = resolveCanonicalUrl();

export function getCanonicalUrl(path = "", env: NodeJS.ProcessEnv = process.env): string {
  const base = resolveCanonicalUrl(env);
  const cleanPath = path ? (path.startsWith("/") ? path : `/${path}`) : "";
  return `${base}${cleanPath}`;
}

/**
 * Builds canonical metadata definitions for Next.js Metadata objects.
 */
export function buildCanonicalMetadata(env: NodeJS.ProcessEnv = process.env) {
  const canonicalUrl = resolveCanonicalUrl(env);
  return {
    metadataBase: new URL(canonicalUrl),
    alternates: {
      canonical: "/",
    },
    openGraph: {
      url: canonicalUrl,
    },
  };
}
