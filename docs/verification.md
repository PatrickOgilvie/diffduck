# Verification

## Completed during development

- Strict TypeScript check and a fresh production build.
- 62 tests / 410 assertions across domain, session, controller, revision trail, development workbench, host-adapter, real MCP Apps SDK transport, rendered recovery controls and built stdio integration.
- Read-only Diffs selection and inline actions in the Codex in-app browser.
- Simulated answer in scenario A while scenario B remains active with its draft preserved.
- Explicit alternative adoption appends revision columns while retaining the baseline, older columns and their discussion anchors.
- 390px responsive layout has no document-width overflow.
- Plugin and skill schema validation; new plugin installation through the personal marketplace.
- The published preview archive ran successfully from an isolated temporary directory without node_modules (17 stdio assertions). The current bundled-server check has 29 assertions, including the app-only JSON envelope, revision trail and development-code exclusion. The exact archived plugin passed manifest validation.
- Credential-pattern and local-user-path scan found no matches in source/distribution (excluding development dependencies and unshipped source maps).

## Release gates

- In actual Codex, open two examples, select lines in A and ask a question; switch to B and draft while waiting. Verify the model fetches complete A context, calls the explicit response tool, and the answer appears in A without another mounted surface.
- Verify a real-host context near the 32 KiB boundary is complete rather than truncated. If not, lower the bound before stable release.

The model-facing tools are exposed in the live Codex task. Opening the review succeeded, but questions failed, including “Another question is waiting for Codex” and “DiffDuck received an invalid response. Its existing discussion has been kept.” No app-originated question reached the originating task. The embedded panel's raw response has not been captured. A browser demo or SDK transport test cannot substitute for these release gates.

## Fast workbench verification

- `bun run dev` started Vite on `127.0.0.1:5173` in 176 ms in the local environment; no build or plugin installation was required. This is startup evidence, not a guaranteed page-load or refresh benchmark.
- In the actual browser, a question about after-lines 3–4 was held in scenario A while a draft was composed in B. A temporary shared React-caption edit and a stylesheet border edit both appeared through hot updates without navigation. B remained active, its exact draft survived, and A could still receive its held answer. The unread marker appeared on A and adopting its alternative created revision 2. Both temporary visual edits were reverted.
- Theme and read-only controls work. Invalid review JSON displays an error without clearing the draft; valid JSON replaces the review and clears the old draft. Explicit reset restores the sample review.
- The initial 390px workbench check found no document-width overflow but did find a clipped revision picker. The picker has since been removed and replaced by the revision trail verified below. The browser viewport override was reset after inspection. No browser console warnings/errors were observed.
- Deterministic development tests cover held/automatic answers, exact selection, A/B draft routing, alternative adoption, rejection and edited resubmission, cannot-answer, cancellation, teardown and input limits. Built stdio checks also verify that the packaged HTML excludes workbench strings, simulated-answer logic and the Vite client.

The installed plugin was not reinstalled for this work. The browser is an independent local visual workbench with simulated responses, not evidence of live Codex chat or a browser-to-MCP transport. Controller/session/entrypoint edits can still reload and reset the page; component/style edits use the faster path.

## Horizontal revision trail

- The browser rendered **Before → Revision 1 → Revision 2 → Revision 3**, with both later revisions created through the visible question, reply and adoption workflow. Later columns show changes from their immediate predecessor; no original-baseline changes repeat in revision 2 or 3.
- The desktop rail was 848px wide with 1702px of content. Adoption revealed the newest column; Home/End moved between offsets 0 and 854. Arrow controls and Latest work. A scenario's intermediate horizontal position survived switching to another scenario and back.
- Selecting revision 2's previous-version lines 3–4 attached revision 1's after-pane, showing the exact `Pipeline.from(input)` / `.through(parse)` source in the composer. The sent transcript retained revision 1. Its simulated answer arrived in A while B stayed active with its draft and A gained an unread marker.
- Pointer selection on baseline line 3 attached the original before-source. The inline “Ask about this” action focused the composer without changing that source identity. Read-only mode disabled the column actions and composer.
- At 390px, both viewport and document width were 390px; the 348px trail held 1342px of columns. Latest brought the newest full column into view. The temporary viewport override was reset. No console warnings/errors were observed.
- A cold-load browser check exposed blank code when Diffs 1.3.6's file header was disabled. Using its custom-header slot restored initial rendering for both `File` and `MultiFileDiff`, verified by reloading before any theme or selection interaction.
- New tests use real session adoptions to verify adjacent comparisons, original/added/removed coordinates, inverse annotation mapping, invalid ranges, invalid parent chains and repeated identities. A real controller test verifies atomic source attachment, draft/reply preservation, rejection of a foreign scenario's revision and exact submitted text.

The shared production UI was rebuilt; the installed plugin was not reinstalled. These browser checks use local simulated answers, not a live Codex-host round trip.

## Preparation-recovery regression

The controller previously refreshed only after transcript conflicts or an already-pending error. A preparation that committed on the server but lost its response left the UI unaware of the pending question and without recovery controls.

Current source reconciles uncertain preparation with a session read. Failed reconciliation keeps sending disabled, preserves both tabs' drafts, and offers bounded automatic checking plus an explicit “Check again.” A recovered pending question exposes the existing retry/stop actions. It is never automatically sent. A read begun before preparation cannot clear the uncertainty.

Tests inject a lost response after the real MCP tool has committed, then exercise the production UI adapter, controller and rendered discussion panel. They verify exact frozen context, visible recovery controls, explicit single-message retry, A/B routing, draft preservation and unread answers. This demonstrates recovery from that failure window, not the cause or resolution of the live Codex handoff error.

The recovery change is now installed locally, together with the explicit `$diffduck:review` launch prompt. The installed UI/server hashes match the current source distribution, and the bundled-server test passed against that installed copy (17 assertions). Lense was uninstalled at the user's request; its source files remain intact. Already-open review surfaces do not receive the new build: save error details and drafts, then test in a new task with a fresh review. The published `v0.2.0-preview.1` archive still does not include this recovery change.

## Known preview limitation

The custom gutter action was removed after pointer activation failed in the host while keyboard activation worked. Select line numbers and use the inline annotation action, or use the keyboard range picker. Do not restore the gutter action until both input methods pass a browser check.

## Invalid-response regression

The real MCP Apps `App` and `AppBridge`, an MCP client and the real server reproduce the reported invalid-response message when the host forwards only text content. Previously the server sent prose acknowledgements for most tools, and the UI read only `structuredContent`. Successes now include the complete result in both standard representations; one shared decoder accepts the JSON text representation only when structured data is absent. Present-but-invalid structured data still fails strict validation.

The near-limit test also exposed an independent error-format defect: the SDK client validates any `structuredContent` against the published success schema, even with `isError: true`. A `ContextTooLarge` result therefore threw before the UI could display it. Typed errors now travel in JSON text with `isError: true` and no structured field. The existing strict error union is unchanged.

The SDK transport tests verify normal structured and text-only round trips, complete context above 30,000 bytes but below 32 KiB, A/B draft and answer routing, and over-limit rejection in both modes. Rejection preserves the draft, sends no model message and allows a smaller question in the other tab. The packaged stdio test also verifies a typed missing-session error survives SDK output validation.

Malformed results include bounded `DD_RESPONSE_V1` details; failed calls include `DD_REQUEST_V1`. Tests check that payload values, host error text and arbitrary property names cannot leak into response diagnostics. These are reproducible transport fixes, not proof of the live panel's original failure cause. The isolated Codex backend previously preserved valid structured results for the recorded eight-example input; the embedded UI is the remaining verification boundary.

## Parent-revision transport regression

The next live failure identified `read_diffduck_session structured/contract-mismatch` at `value.snapshot.scenarios.[item].revisions.[item].parentRevisionId`. The recorded opening result for the six-example review contains explicit, valid `null` parent IDs. Removing null-valued properties only at the host response seam reproduces the same error through the real MCP Apps SDK. The exact transformation inside the live embedded host has not been captured, so null omission remains the reproduced explanation rather than a directly observed host implementation detail.

App-only replies now carry their complete typed result as JSON inside a versioned two-string envelope. This protects every nested value from object-field conversion at the host boundary without loosening the domain schema. Model-facing results and inputs are unchanged. Tests still reject a missing parent ID inside the encoded JSON, even when the text duplicate is valid; no missing value is guessed.

The lossy-host SDK regressions pass for normal and near-limit contexts. They also verify follow-up history, null and non-null revision parents, alternative adoption, cancellation and another tab's draft. An isolated Codex app-server replay of the actual six-example opening passes show, prepare and read through the production decoder, with all six null parent IDs preserved. It sends no model message and does not touch the user's open session. The live embedded-panel question-and-answer loop remains a separate check.
