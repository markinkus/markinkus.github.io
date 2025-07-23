import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/', // o '/nome-repo/' se non usi markinkus.github.io
  resolve: {
    alias: {
      buffer: 'buffer', // usa la versione browserizzata
    },
  },
  define: {
    global: 'window', // richiesto da alcuni moduli legacy
  },
});
