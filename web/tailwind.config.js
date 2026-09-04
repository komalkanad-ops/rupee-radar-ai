/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Mirrors the Android app's dark neon palette 1:1
        // (android/.../ui/theme/Color.kt's NeonBackground/NeonSurface/NeonGreen/GradientPurple/
        // GradientBlue) so the website reads as the same product, not a separate corporate site.
        app: {
          bg: "#0A0A12",
          surface: "#15151F",
          border: "#ffffff1f", // ~12% white, the "glass" edge highlight
          text: "#F5F5FA",
          muted: "#A0A0B2",
        },
        brand: {
          DEFAULT: "#C6FF4A", // NeonGreen
          dark: "#8FCC1F", // NeonGreenDark
          light: "#EAF4DC",
        },
        purple: "#6D5BD0", // GradientPurple
        blue: "#3E63E0", // GradientBlue
        gold: {
          DEFAULT: "#D4AF37", // ProGold — PRO-only accent, matches the app's paywall
          dark: "#8A6D1A",
        },
        danger: "#FF6B6B",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #6D5BD0 0%, #3E63E0 100%)",
      },
      keyframes: {
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        floatSlow: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-14px)" },
        },
      },
      animation: {
        "fade-in-up": "fadeInUp 0.7s ease-out both",
        "float-slow": "floatSlow 7s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
