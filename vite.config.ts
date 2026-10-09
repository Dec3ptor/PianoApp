import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import path from 'path';
import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/; the deploy workflow passes that
// path in BASE_PATH. Local dev and preview run from the root.
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    // Generates a second bundle (with polyfills + ES5) for old browsers like
    // iPadOS 12/13 WKWebView shipped inside the "Web MIDI Browser" app.
    // It also sets the build target for the modern bundle.
    legacy({
      targets: ['ios >= 12', 'safari >= 12', 'last 2 versions'],
      modernPolyfills: true,
      renderLegacyChunks: true,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  esbuild: {
    target: 'es2017',
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 3005,
    allowedHosts: true,
  },
});
