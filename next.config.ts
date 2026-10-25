import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/pdf": ["./src/fonts/**/*"],
  },
};

export default nextConfig;
