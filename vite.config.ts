import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  optimizeDeps: { include: ["react", "react-dom", "react-dom/client", "react/jsx-dev-runtime", "motion/react"] },
  plugins: [
    react(),
    // AI calls need a Cloudflare login; local dev uses AI_MOCK unless CF_REMOTE=1.
    cloudflare({ remoteBindings: process.env.CF_REMOTE === "1" }),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script-defer",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Flick",
        short_name: "Flick",
        lang: "ja",
        start_url: "/",
        display: "standalone",
        background_color: "#f7f8fb",
        theme_color: "#f7f8fb",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Take over as soon as a new version is installed. Without this the update
        // waits until every tab is closed, which an installed PWA almost never does.
        // The open page keeps running; the next launch gets the new version.
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
      },
    }),
  ],
});
