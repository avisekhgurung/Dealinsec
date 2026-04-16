import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
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
