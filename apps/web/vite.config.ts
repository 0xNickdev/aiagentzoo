import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // The docs are their own page: no video, no map, just text.
      input: { main: resolve(__dirname, "index.html"), docs: resolve(__dirname, "docs.html") },
    },
  },
});
