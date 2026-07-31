import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/src/builder/") || id.includes("/routes/Builder")) {
            return "builder";
          }
          if (id.includes("@whenlist/dsl")) {
            return "dsl";
          }
        },
      },
    },
  },
});
