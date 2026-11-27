import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_DISPLAY_NAME } from '../../packages/game-core/src/config';

function injectAppDisplayName(): Plugin {
  return {
    name: 'inject-app-display-name',
    transformIndexHtml(html) {
      return html.replaceAll('%APP_DISPLAY_NAME%', APP_DISPLAY_NAME);
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    injectAppDisplayName(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: [
        'icons/icon.svg',
        'icons/pwa-192x192.png',
        'icons/pwa-512x512.png',
        'icons/pwa-maskable-512x512.png',
        'offline.html',
      ],
      manifest: {
        name: APP_DISPLAY_NAME,
        short_name: APP_DISPLAY_NAME,
        description: 'Offline-first family puzzle and card games',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f8f6f2',
        theme_color: '#1f2937',
        icons: [
          {
            src: '/icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/icons/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
