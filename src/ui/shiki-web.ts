import { createBundledHighlighter } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export * from "shiki/core";
export { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/** The syntax grammars accepted by DiffDuck's review schema. */
export const bundledLanguages = {
  javascript: () => import("shiki/dist/langs/javascript.mjs"),
  json: () => import("shiki/dist/langs/json.mjs"),
  jsx: () => import("shiki/dist/langs/jsx.mjs"),
  tsx: () => import("shiki/dist/langs/tsx.mjs"),
  typescript: () => import("shiki/dist/langs/typescript.mjs"),
} as const;

/** Create a highlighter limited to the grammars DiffDuck can render. */
export const createHighlighter = createBundledHighlighter({
  engine: createJavaScriptRegexEngine,
  langs: bundledLanguages,
  themes: {},
});

/** Reject the WASM engine that DiffDuck intentionally excludes from its MCP bundle. */
export function createOnigurumaEngine(_wasm: unknown): never {
  throw new Error("DiffDuck supports Shiki's JavaScript regex engine only.");
}
