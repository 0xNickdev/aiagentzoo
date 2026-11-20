/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./docs.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // One palette for every page, the dashboard's: night, three surfaces, hairlines. Text is always a solid colour.
      colors: {
        fg: { DEFAULT: "#ffffff", 2: "#e6e9e7", 3: "#d9dddb", 4: "#b8beba" },
        /** Quieter solid greys for labels and meta lines. */
        dim: "#aab2ad",
        faint: "#7d8681",
        night: { DEFAULT: "#030504", surface: "#080b0a", raised: "#0e1311" },
        line: { DEFAULT: "#18201c", 2: "#232c27" },
        danger: "#ff5a4f",
        warn: "#e8a23a",
        // "lit": the one primary: a white button with near-black ink, and the colour of good or alive data.
        lit: { DEFAULT: "#ffffff", hover: "#e6e9e7", ink: "#030504", edge: "#333b37" },
      },
      fontFamily: {
        sans: ["Geist", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
