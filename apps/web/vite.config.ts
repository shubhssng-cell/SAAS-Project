import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The real student-facing product surface (docs/MASTER_PLAN.md vertical-slice
// UI). Distinct dev port from apps/training-playground (5183), which remains
// unchanged and untouched by this app. The practice loop is still entirely
// fixture-backed (src/adapter) -- Product Phase 1 Unit 5 is the FIRST real
// apps/web -> apps/api connection, for auth only. The dev proxy below makes
// that same-origin from the browser's point of view (matches src/config.ts's
// empty-string default API base), forwarding to `apps/api`'s dev server
// (`npm run dev --workspace @ipmat/api`, PORT defaults to 4001).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5184,
    proxy: {
      "/v1": { target: "http://localhost:4001", changeOrigin: true }
    }
  }
});
