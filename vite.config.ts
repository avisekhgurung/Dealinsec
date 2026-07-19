import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "favicon.png", "apple-touch-icon.png"],
      manifest: {
        name: "DealInSec — Deal Management OS",
        short_name: "DealInSec",
        description:
          "Track, sign, and bill every client or brand deal — in one workflow. Built for India.",
        theme_color: "#0E8C5A",
        background_color: "#0F172A",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/dashboard",
        categories: ["business", "productivity", "finance"],
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Server-rendered routes that live OUTSIDE the React SPA must NOT be
        // shadowed by the navigation fallback (index.html) — otherwise the SW
        // serves the SPA shell and /tools etc. render the landing page.
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/tools(\/|$)/,
          /^\/sitemap\.xml$/,
          /^\/robots\.txt$/,
        ],
        runtimeCaching: [
          {
            // App shell — network first so users get fresh deploys. Exclude the
            // server-rendered /tools/* pages so the SW never caches/handles them.
            urlPattern: ({ request, url }) =>
              request.mode === "navigate" && !url.pathname.startsWith("/tools"),
            handler: "NetworkFirst",
            options: { cacheName: "pages", networkTimeoutSeconds: 3 },
          },
          {
            // Static assets — cache first
            urlPattern: ({ request }) =>
              ["style", "script", "worker", "font"].includes(request.destination),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "assets" },
          },
          {
            // ImageKit + uploaded images
            urlPattern: ({ url }) => url.hostname.includes("imagekit.io"),
            handler: "CacheFirst",
            options: {
              cacheName: "images",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // Never cache API responses (always fresh data)
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
        ],
      },
      devOptions: { enabled: false },
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Split vendor libraries into separate cached chunks
    rollupOptions: {
      output: {
        manualChunks: {
          // React core — cached across all page navigations
          "vendor-react": ["react", "react-dom"],
          // Routing + data fetching — used on every page
          "vendor-query": ["@tanstack/react-query", "wouter"],
          // Radix UI primitives bundled together
          "vendor-radix": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-select",
            "@radix-ui/react-tabs",
            "@radix-ui/react-toast",
            "@radix-ui/react-tooltip",
            "@radix-ui/react-label",
            "@radix-ui/react-checkbox",
            "@radix-ui/react-slot",
          ],
          // Form utilities
          "vendor-forms": ["react-hook-form", "@hookform/resolvers", "zod"],
          // Icons (react-icons is heavy — isolate it)
          "vendor-icons": ["react-icons", "lucide-react"],
          // Charts — only used in billing/analytics pages
          "vendor-charts": ["recharts"],
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
