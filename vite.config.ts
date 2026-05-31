import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Port 1420 matches Tauri's default dev server expectation for Phase 2.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    rollupOptions: {
      output: {
        // Code-splitting (UI-1). Firebase (auth + Firestore + its grpc/protobuf
        // transitive deps) is heavy and woven into the sync store, so we can't
        // lazily defer it without reworking sync — but we can carve it into its
        // own chunk so it downloads in parallel, caches independently, and stops
        // bloating the main bundle. React Flow + dagre aren't listed here on
        // purpose: MapView is React.lazy'd (see App.tsx), so Rollup already emits
        // them as an on-demand chunk that outline-only sessions never fetch.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (
            id.includes("/firebase/") ||
            id.includes("/@firebase/") ||
            id.includes("/@grpc/") ||
            id.includes("protobufjs")
          ) {
            return "firebase";
          }
        },
      },
    },
  },
});
