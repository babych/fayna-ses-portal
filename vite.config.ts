import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'og-banner.png', 'og-banner.svg', 'screenshot-desktop.png', 'screenshot-mobile.png'],
      manifest: {
        id: '/',
        start_url: '/',
        scope: '/',
        name: 'Fayna SES — Complex Energy Portal',
        short_name: 'Fayna SES',
        description: 'Real-time monitoring of battery storage, solar SES generation, and resilience in Fayna Town complex',
        theme_color: '#ffffff',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'any',
        icons: [
          {
            src: '/icon-192.png?v=5',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icon-512.png?v=5',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icon-512.png?v=5',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ],
        screenshots: [
          {
            src: '/screenshot-desktop.png',
            sizes: '1280x720',
            type: 'image/png',
            form_factor: 'wide',
            label: 'Fayna SES Desktop Dashboard'
          },
          {
            src: '/screenshot-mobile.png',
            sizes: '750x1334',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Fayna SES Mobile Monitor'
          }
        ]
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        importScripts: ['/custom-sw.js'],
        runtimeCaching: [
          // 1. Current Day & Current Month (Dynamic / Appended Daily): NetworkFirst
          {
            urlPattern: ({ url }) => {
              const now = new Date();
              const yyyy = now.getFullYear();
              const mm = String(now.getMonth() + 1).padStart(2, '0');
              const dd = String(now.getDate()).padStart(2, '0');
              const currentMonth = `${yyyy}-${mm}`;
              const currentDay = `${yyyy}-${mm}-${dd}`;
              return url.pathname.endsWith(`/month/${currentMonth}.json`) || url.pathname.endsWith(`/day/${currentDay}.json`);
            },
            handler: 'NetworkFirst',
            options: {
              cacheName: 'ses-current-period-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 300 // 5 minutes
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // 2. Immutable Historical Data (Past Days & Past Months): CacheFirst for 1 Year!
          {
            urlPattern: /\/(day\/\d{4}-\d{2}-\d{2}|month\/\d{4}-\d{2})\.json$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ses-historical-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 31536000 // 1 Year (365 days)
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // 3. Real-time Live Feeds (today.json, station.json): NetworkFirst with 5 min fallback
          {
            urlPattern: /^https:\/\/(data-ses\.funs\.net\.ua|.*\/api)\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'ses-api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 300 // 5 minutes
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
