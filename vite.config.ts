import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Generates a second bundle (with polyfills + ES5) for old browsers like
    // iPadOS 12/13 WKWebView shipped inside the "Web MIDI Browser" app.
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
  build: {
    target: 'es2015',
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
