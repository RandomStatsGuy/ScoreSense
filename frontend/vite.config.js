import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { productionGtagHtmlSnippet } from "./src/analytics.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiPort = env.SCORESENSE_API_PORT || process.env.SCORESENSE_API_PORT || "8000";
  const initialAssets = new Set(["registerSW.js"]);

  return {
  plugins: [
    react(),
    {
      name: "initial-precache-assets",
      apply: "build",
      generateBundle(_options, bundle) {
        const visit = (fileName) => {
          if (initialAssets.has(fileName)) return;
          initialAssets.add(fileName);
          const chunk = bundle[fileName];
          if (chunk?.type !== "chunk") return;
          for (const css of chunk.viteMetadata?.importedCss || []) initialAssets.add(css);
          for (const dependency of chunk.imports) visit(dependency);
        };
        for (const chunk of Object.values(bundle)) {
          if (chunk.type === "chunk" && chunk.isEntry) visit(chunk.fileName);
        }
      },
    },
    {
      name: "ga4-html-snippet",
      apply: "build",
      transformIndexHtml(html) {
        if (html.includes("googletagmanager.com/gtag/js")) return html;
        return html.replace(
          "<head>",
          `<head>\n    ${productionGtagHtmlSnippet()}`,
        );
      },
    },
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "pwa-192.png", "pwa-512.png"],
      manifest: {
        name: "ScoreSense",
        short_name: "ScoreSense",
        description: "NFL fantasy projections, league tools, and DFS",
        theme_color: "#070d17",
        background_color: "#070d17",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "pwa-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precaching every dynamic chunk would download secondary screens on
        // the first visit anyway. Cache their hashed assets when first used.
        manifestTransforms: [async (entries) => ({
          manifest: entries.filter(({ url }) => !/\.(?:js|css)$/.test(url) || initialAssets.has(url)),
          warnings: [],
        })],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/assets\/.*\.(?:js|css)$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "scoresense-section-assets",
              expiration: { maxEntries: 128, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: /^\/api\/.*/i,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^https:\/\/www\.googletagmanager\.com\/.*/i,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^https:\/\/(?:www|region1)\.google-analytics\.com\/.*/i,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
};
});
