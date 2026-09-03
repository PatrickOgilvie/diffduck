# Verification

## Completed during development

- Strict TypeScript check and a fresh production build.
- 33 tests / 199 assertions across domain, session, controller, host-adapter, in-memory MCP, rendered recovery controls and built stdio integration.
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

The model-facing tools are now exposed in the live Codex task. Opening the review succeeded, but the user's first question failed and a later attempt reported “Another question is waiting for Codex.” No app-originated question reached the task. The original host error has not yet been captured. A browser demo or SDK transport test cannot substitute for these release gates.

## Preparation-recovery regression

The controller previously refreshed only after transcript conflicts or an already-pending error. A preparation that committed on the server but lost its response left the UI unaware of the pending question and without recovery controls.

Current source reconciles uncertain preparation with a session read. Failed reconciliation keeps sending disabled, preserves both tabs' drafts, and offers bounded automatic checking plus an explicit “Check again.” A recovered pending question exposes the existing retry/stop actions. It is never automatically sent. A read begun before preparation cannot clear the uncertainty.

Tests inject a lost response after the real MCP tool has committed, then exercise the production UI adapter, controller and rendered discussion panel. They verify exact frozen context, visible recovery controls, explicit single-message retry, A/B routing, draft preservation and unread answers. This demonstrates recovery from that failure window, not the cause or resolution of the live Codex handoff error.

The recovery change is not installed into the user's open session and is not part of the published `v0.2.0-preview.1` archive. The existing session is retained while gathering the original error.

## Known preview limitation

The custom gutter action was removed after pointer activation failed in the host while keyboard activation worked. Select line numbers and use the inline annotation action, or use the keyboard range picker. Do not restore the gutter action until both input methods pass a browser check.
