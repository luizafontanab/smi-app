import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // next.config.ts switches distDir to .next-visual for the visual suite, so
    // this fills with build output the moment `pnpm visual` runs — and eslint
    // lints it, failing `pnpm lint`/`pnpm check` with ~900 errors in generated
    // chunks. Same reason .next/** is ignored.
    ".next-visual/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    // Agent tooling, not app code: plugin skills vendor their own scripts
    // (164 warnings from .claude/skills/impeccable alone), which buried the
    // app's own lint output.
    ".claude/**",
  ]),
]);

export default eslintConfig;
