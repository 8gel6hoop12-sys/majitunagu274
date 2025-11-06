/** @type {import('next').NextConfig} */
const isGitHub = process.env.GITHUB_PAGES === 'true';
const repo = 'majitunagu274';

module.exports = {
  output: 'export',
  images: { unoptimized: true },
  basePath: isGitHub ? `/${repo}` : '',
  assetPrefix: isGitHub ? `/${repo}/` : '',
  trailingSlash: true,
};
