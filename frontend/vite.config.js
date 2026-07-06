import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'BrickList',
        short_name: 'BrickList',
        description: 'Sort mixed piles of LEGO bricks back into sets',
        theme_color: '#1d4ed8',
        background_color: '#f9fafb',
        display: 'standalone',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Never let the SW answer for the API
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Part/set images from Rebrickable's CDN — cache-first so
            // thumbnails work on flaky garage Wi-Fi and load instantly
            urlPattern: /^https:\/\/cdn\.rebrickable\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'rebrickable-images',
              expiration: { maxEntries: 1000, maxAgeSeconds: 60 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
