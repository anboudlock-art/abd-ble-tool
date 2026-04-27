import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@abd/shared'],
  output: 'standalone',
  // In a pnpm monorepo the standalone tracer needs to walk up to the
  // workspace root so it pulls in @abd/shared and friends correctly.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  webpack: (config) => {
    // Allow `.js` import specifiers in workspace TypeScript packages
    // (NodeNext requires explicit .js, but Webpack needs to map back to .ts).
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
