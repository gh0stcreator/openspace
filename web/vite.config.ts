import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Собранный фронт отдаёт наш же сервер на :4477.
  build: { outDir: "../public", emptyOutDir: false },
  server: {
    proxy: {
      "/api": "http://localhost:4477",
      "/files": "http://localhost:4477",
    },
  },
})
