# Verification

## Completed during development

- Strict TypeScript check and a fresh production build.
- 26 tests / 128 assertions across domain, session, controller, host-adapter, in-memory MCP and built stdio integration.
- Read-only Diffs selection and inline actions in the Codex in-app browser.
- Simulated answer in scenario A while scenario B remains active with its draft preserved.
- Explicit alternative adoption creates revision 2 while revision 1 remains selectable.
- 390px responsive layout has no document-width overflow.
- Plugin and skill schema validation; new plugin installation through the personal marketplace.
- Release archive ran successfully from an isolated temporary directory without node_modules (17 stdio assertions). The exact archived plugin passed manifest validation.
- Credential-pattern and local-user-path scan found no matches in source/distribution (excluding development dependencies and unshipped source maps).

## Release gates

- In actual Codex, open two examples, select lines in A and ask a question; switch to B and draft while waiting. Verify the model fetches complete A context, calls the explicit response tool, and the answer appears in A without another mounted surface.
- Verify a real-host context near the 32 KiB boundary is complete rather than truncated. If not, lower the bound before stable release.

The last two checks require the newly installed plugin to be exposed in a live Codex task. A browser demo or SDK transport test cannot substitute for them.

## Known preview limitation

The custom gutter action was removed after pointer activation failed in the host while keyboard activation worked. Select line numbers and use the inline annotation action, or use the keyboard range picker. Do not restore the gutter action until both input methods pass a browser check.
