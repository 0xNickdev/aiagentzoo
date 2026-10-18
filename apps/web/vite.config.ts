import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // Vite's default CSS minifier (lightningcss) keeps only -webkit-backdrop-filter, which Chrome and Android ignore: no glass there at all.
    cssMinify: "esbuild",
    rollupOptions: {
      // The docs are their own page: no video, no map, just text.
      input: { main: "index.html", docs: "docs.html", evolution: "evolution.html", app: "app.html", xray: "xray.html" },
    },
  },
});
