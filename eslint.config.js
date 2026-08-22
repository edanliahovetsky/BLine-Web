import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default tseslint.config(
  {
    ignores: [
      ".ci",
      "dist",
      "node_modules",
      "src-tauri/target",
      "src-tauri/gen",
    ],
  },
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        project: [
          "./tsconfig.app.json",
          "./tsconfig.node.json",
          "./tsconfig.test.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: ["src/core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "Worker",
        "self",
        "navigator",
        "localStorage",
        "sessionStorage",
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: ["react", "react-dom", "lucide-react", "pixi.js", "zustand"],
          patterns: [
            "react/*",
            "react-dom/*",
            "@tauri-apps/*",
            "lucide-react/*",
            "pixi.js/*",
            "zustand/*",
          ],
        },
      ],
    },
  },
  {
    files: ["src/state/**/*.{ts,tsx}", "src/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/storage", "**/storage/*"],
              message:
                "State and UI consume persistence through platform/projectIo, not storage adapters.",
            },
          ],
        },
      ],
    },
  },
);
