import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "copy-manifest",
      closeBundle() {
        const out = path.resolve(__dirname, "dist");
        if (!existsSync(out)) mkdirSync(out, { recursive: true });
        copyFileSync(
          path.resolve(__dirname, "manifest.json"),
          path.resolve(out, "manifest.json"),
        );
      },
    },
  ],
  resolve: {
    alias: {
      "@iiif-atlas/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        background: path.resolve(__dirname, "src/background.ts"),
        content: path.resolve(__dirname, "src/content.ts"),
        popup: path.resolve(__dirname, "src/popup/popup.html"),
        options: path.resolve(__dirname, "src/options/options.html"),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "background") return "background.js";
          if (chunk.name === "content") return "content.js";
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
