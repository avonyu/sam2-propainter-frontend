import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 7262,
    allowedHosts: true, // Allow access from AutoDL proxy domains
  },
  preview: {
    host: "0.0.0.0",
    port: 7262,
    allowedHosts: true,
  },
});