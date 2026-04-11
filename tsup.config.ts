import { defineConfig } from "tsup"

export default defineConfig([
  {
    entry: { "bin/wizard": "bin/wizard.ts" },
    format: ["esm"],
    target: "node18",
    clean: true,
    dts: false,
    banner: {
      js: "#!/usr/bin/env node",
    },
    // Copy templates into dist/ so generators can resolve them at runtime via
    // `resolve(__dirname, "../templates")` from dist/generators/.
    onSuccess: "cp -r src/templates dist/templates",
  },
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    target: "node18",
    clean: false,
    dts: true,
  },
])
