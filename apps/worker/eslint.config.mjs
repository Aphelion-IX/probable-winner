import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...tseslint.configs.recommended,
  prettierConfig,
  globalIgnores(["dist/**"]),
]);

export default eslintConfig;
