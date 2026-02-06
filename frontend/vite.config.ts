import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: "frontend",
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/serverlist": "http://127.0.0.1:24680",
      "/offset": "http://127.0.0.1:24680",
    },
  },
  build: {
    outDir: "../public",
    emptyOutDir: true,
  },
});
