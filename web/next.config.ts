import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // TL_DIST_DIR lets a second dev server run against this same working tree
  // (Next locks one dev server per distDir). Unset everywhere but a scratch
  // verification run, so the default build output is untouched.
  ...(process.env.TL_DIST_DIR ? { distDir: process.env.TL_DIST_DIR } : {}),
};

export default nextConfig;
