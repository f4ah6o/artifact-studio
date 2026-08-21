import { defineConfig } from 'vite-plus';

const nonCodePaths = [
  '.github/**',
  'docs/**',
  'issues/**',
  'references/**',
  'rules/**',
  'tests/bench/**',
  'tests/fixtures/**',
  '**/*.md',
];

export default defineConfig({
  server: {
    host: process.env.VITE_HOST || '0.0.0.0',
    port: Number(process.env.VITE_PORT || 5173),
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.API_PORT || 3000}`,
        changeOrigin: true,
      },
      '/health': {
        target: `http://127.0.0.1:${process.env.API_PORT || 3000}`,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules/**'],
  },
  fmt: {
    ignorePatterns: nonCodePaths,
    singleQuote: true,
  },
  lint: {
    ignorePatterns: nonCodePaths,
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
    options: { typeAware: true, typeCheck: true },
  },
});
