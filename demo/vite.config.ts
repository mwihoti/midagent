import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // '/' by default; CI sets VITE_BASE=/midagent/ for the GitHub Pages deploy.
  base: process.env.VITE_BASE || '/',
  resolve: {
    alias: {
      // The compiled contracts under ../contracts/managed import this package.
      // Node resolution from there walks up to the REPO root's node_modules —
      // which exists locally (yarn) but not in CI, where only demo/ installs.
      // Pin it to demo's own copy so the build works from either state.
      '@midnight-ntwrk/compact-runtime': fileURLToPath(
        new URL('./node_modules/@midnight-ntwrk/compact-runtime', import.meta.url),
      ),
    },
  },
  // Cast: the wasm plugin's CJS/ESM-interop types read as non-callable under the
  // strict node config, though it calls fine at runtime. Top-level-await is
  // handled natively via the esnext build target (the dedicated plugin breaks
  // the production bundle with newer @swc/core).
  plugins: [react(), (wasm as any)()],
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['@midnight-ntwrk/ledger-v8'],
  },
});
