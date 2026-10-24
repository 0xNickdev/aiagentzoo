/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // One palette for every page. Text is always a solid colour, never white at some opacity over a picture.
      colors: {
        fg: { DEFAULT: "#ffffff", 2: "#e6e9e7", 3: "#d9dddb", 4: "#a3aaa6" },
        night: { DEFAULT: "#030504", surface: "#0a0e0c", raised: "#101412" },
        danger: "#ff8a7e",
        warn: "#ffc27a",
        moss: "#a6e3b4",
      },
    },
  },
  plugins: [],
};
