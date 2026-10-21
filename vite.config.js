import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8045', xfwd: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // 大依赖单独分包：业务代码改动不再使 react/lucide/xlsx 等大块的浏览器缓存失效
        manualChunks: {
          react: ['react', 'react-dom'],
          icons: ['lucide-react'],
          viewer: ['pptxviewjs'],
          charts: ['chart.js'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
})
