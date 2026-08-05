import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ["37816063.r18.cpolar.top"],
  },
  test: {
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
});
