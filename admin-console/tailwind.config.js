/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#0F6E5B",
          dark: "#0A4F42",
          light: "#E4F3EF",
        },
      },
    },
  },
  plugins: [],
};
