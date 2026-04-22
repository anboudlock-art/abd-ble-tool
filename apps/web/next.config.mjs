/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@abd/shared'],
  output: 'standalone',
};

export default nextConfig;
