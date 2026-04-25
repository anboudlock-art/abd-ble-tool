/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@abd/shared'],
  output: 'standalone',
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
