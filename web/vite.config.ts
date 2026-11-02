import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" keeps every asset URL relative so the export works on an IPFS gateway subpath or ENS name.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true, assetsInlineLimit: 0, chunkSizeWarningLimit: 1200 },
  server: { fs: { allow: [".."] } },
});
