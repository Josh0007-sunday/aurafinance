import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import tailwindcss from '@tailwindcss/vite'
// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({
      // Explicitly disable globals to avoid the esbuild banner issue in Vite 8
      globals: {
        Buffer: false,
        global: false,
        process: false,
      },
      protocolImports: true,
    }),
  ],
  resolve: {
    alias: {
      'process/': 'process',
      'buffer/': 'buffer',
    }
  },
  define: {
    'global': 'globalThis',
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    'process.browser': 'true',
    'process.version': '""',
    'process.cwd': '"/"',
  }
})
