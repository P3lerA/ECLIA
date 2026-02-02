/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      animation: {
        "fade-in": "fade-in 0.35s ease-out both",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: 0, transform: "translateY(8px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif", "system-ui", "-apple-system",
          "BlinkMacSystemFont", "Segoe UI", "Roboto",
          "Helvetica Neue", "Arial", "sans-serif",
        ],
        serif: [
          "Playfair Display",
          "Merriweather",
          "Georgia",
          "Cambria",
          "Times New Roman",
          "Times",
          "serif",
        ],
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
