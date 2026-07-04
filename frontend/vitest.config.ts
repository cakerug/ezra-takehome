import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Separate from vite.config.ts (which is typed against `vite`'s `defineConfig`, not
// `vitest/config`'s) so `vite.config.ts` doesn't need a `/// <reference types="vitest" />`
// just to type-check the `test` block. Vitest picks this file up automatically.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
  },
});
