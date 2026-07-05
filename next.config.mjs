/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: [
      '@mastra/core', '@mastra/libsql', '@mastra/mcp', '@libsql/client'
    ],
  },
};
export default nextConfig;
