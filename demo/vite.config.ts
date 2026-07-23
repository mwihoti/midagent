import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
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
