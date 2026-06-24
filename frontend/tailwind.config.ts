import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: "#0a0a0f",
          900: "#12121a",
          800: "#1a1a27",
          700: "#1e1e2e",
          600: "#252538",
          500: "#2e2e4a",
        },
        forest: {
          950: "#030d06",
          900: "#061510",
          800: "#0a2218",
          700: "#0f3324",
          600: "#165c3a",
          500: "#1e8a52",
          400: "#29b86b",
          300: "#4cd98a",
          200: "#8eedb8",
          100: "#c7f7dc",
        },
      },
    },
  },
  plugins: [],
};
export default config;
