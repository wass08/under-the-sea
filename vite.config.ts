import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    target: 'es2022', chunkSizeWarningLimit: 2000,
    // Two pages: the scene and the single-fish inspector (paths are relative to the project root).
    rollupOptions: { input: { main: 'index.html', fish: 'fish.html' } },
  },
});
