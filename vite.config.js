import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        storefront: "index.html",
        admin: "admin/index.html",
        avanzado: "admin/avanzado/index.html"
      }
    }
  }
});
