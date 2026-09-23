import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Internal development playground only (docs/DECISIONS.md D-057) — never the
// production student app (`/apps/web`, not built yet). No API/DB/AI wiring.
export default defineConfig({
  plugins: [react()],
  server: { port: 5183 }
});
