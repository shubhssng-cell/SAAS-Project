import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The real student-facing product surface (docs/MASTER_PLAN.md vertical-slice
// UI). Distinct dev port from apps/training-playground (5183), which remains
// unchanged and untouched by this app. No API/DB/AI-provider wiring yet --
// see src/adapter/README for what stands in for the future
// training-recommendation composition layer.
export default defineConfig({
  plugins: [react()],
  server: { port: 5184 }
});
