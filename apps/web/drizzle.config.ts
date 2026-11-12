import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "../../packages/core/src/schema/index.ts",
  out: "./drizzle",
});
