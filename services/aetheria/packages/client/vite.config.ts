import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/ext/aetheria/",
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/leaderboard": "http://localhost:2567",
      "/api": "http://localhost:2567",
      "/auth": "http://localhost:2567",
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          drei: ["@react-three/drei", "@react-three/fiber"],
          colyseus: ["colyseus.js"],
          react: ["react", "react-dom"],
        },
      },
    },
    chunkSizeWarningLimit: 800,
    sourcemap: false,
  },
});
