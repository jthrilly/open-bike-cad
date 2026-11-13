import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works on GitHub Pages under /open-bike-cad/.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { environment: 'node' },
} as any);
