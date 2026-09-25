import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server actions default to a 1 MB body. Thumbnail images go through one (up to 4 MB in
  // total); Vercel itself refuses request bodies over 4.5 MB.
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
};

export default nextConfig;
