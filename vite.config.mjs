import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// マルチページ: LP(index.html) と ゲーム本体(play.html)
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        play: resolve(import.meta.dirname, 'play.html'),
      },
    },
  },
});
