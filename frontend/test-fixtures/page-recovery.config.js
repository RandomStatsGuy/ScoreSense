import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "qa-dist", rollupOptions: { input: "test-fixtures/page-recovery.html" } },
});
