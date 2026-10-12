import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/out/**", "**/node_modules/**", "**/release/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended
);
