import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  root: path.resolve(__dirname),
  publicDir: path.resolve(__dirname, "public"),
  server: {
    port: 5199,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(__dirname, "dist-gallery"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "src/gallery/video-widgets.html"),
    },
  },
});
