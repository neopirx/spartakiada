import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  resolve: { dedupe: ['three'] },
  assetsInclude: ['**/*.fbx'],
  build: { chunkSizeWarningLimit: 2000 },
});
