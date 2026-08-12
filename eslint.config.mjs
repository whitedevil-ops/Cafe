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
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Desktop wrapper (Tauri) — a separate Rust/Cargo project, not JS/TS at all.
    "desktop/**",
  ]),

  // ── Known debt, deliberately visible ──────────────────────────────────────
  //
  // These seven files carry 13 react-hooks violations that predate CI. They
  // are downgraded to warnings HERE, per file and per rule, rather than
  // disabled inline or ignored globally — so they still appear on every lint
  // run and this list shrinks as they are fixed.
  //
  // Why not just fix them: every one is in a screen that cannot be exercised
  // from a dev machine without a café login (POS, kitchen, floor plan, the
  // customer QR menu). These are React correctness rules — a wrong fix changes
  // runtime behaviour on a till during service. They should be fixed one file
  // at a time, each verified against a real café, not in a batch nobody can
  // test.
  //
  // Adding a file to this list is a decision, not a formality. New code has to
  // pass these rules.
  {
    files: [
      "app/dashboard/kitchen/kitchen-client.tsx",
      "app/dashboard/pos/pos-client.tsx",
      "app/dashboard/tables/floor-client.tsx",
      "app/dashboard/tables/tables-client.tsx",
      // `*` rather than the literal [token] segment: square brackets are a
      // glob character class in ESLint's matcher, so "app/t/[token]/…" quietly
      // matches nothing at all.
      "app/t/*/menu-client.tsx",
      "app/t/*/orders/my-orders-client.tsx",
      "app/t/*/wallet/wallet-client.tsx",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
    },
  },
]);

export default eslintConfig;
