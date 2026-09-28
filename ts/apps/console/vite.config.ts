import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Novig's own typefaces are fetched into <kit>/fonts by scripts/fetch-fonts.sh (gitignored,
// licensed, local only). Serving that folder as the public dir makes /fonts/*.ttf resolve.
// The hosted demo build (VITE_DEMO=1) must never ship them, so it has no public dir at all.
const fonts = fileURLToPath(new URL("../../../fonts", import.meta.url));
const demo = process.env.VITE_DEMO === "1";

export default defineConfig({
  plugins: [react()],
  publicDir: demo ? false : fonts,
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: false } },
    fs: { allow: [fileURLToPath(new URL("../../..", import.meta.url))] },
  },
  build: { outDir: "dist", assetsDir: "assets" },
});
