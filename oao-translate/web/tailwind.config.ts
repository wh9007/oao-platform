import type { Config } from "tailwindcss";
const config: Config = { content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"], theme: { extend: { colors: { oao: "#ff5e00", panel: "#111317", surface: "#191c21" }, boxShadow: { glow: "0 0 35px rgba(255,94,0,.16)" } } }, plugins: [] };
export default config;
