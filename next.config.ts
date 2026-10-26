import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/pdf": ["./src/fonts/**/*"],
  },
  async headers() {
    return [
      {
        // Apply security headers to every route — pages, API routes, static assets.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
