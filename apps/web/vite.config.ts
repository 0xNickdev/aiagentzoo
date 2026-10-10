import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // The docs are their own page: no video, no map, just text.
      input: { main: "index.html", docs: "docs.html", evolution: "evolution.html" },
    },
  },
});
