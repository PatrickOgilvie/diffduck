# DiffDuck implementation

Objective: implement the conversation-anchored Lense v0.2 spec, rename the plugin DiffDuck, use a duck logo, and package/publish PatrickOgilvie/diffduck.

## Acceptance ledger

- [x] Immutable examples, side-specific exact selections, provenance and frozen discussion context.
- [x] Strict parsed protocol; eight tools with app/model visibility and a single rendering tool.
- [x] Session-owned histories, single-flight, idempotency, honest delivery uncertainty, cancellation and guarded alternative adoption.
- [x] Per-tab discussion UI, drafts, context inspector, annotations, historical views, unread state and owned polling.
- [x] Duck identity throughout source, UI, assets, skill and plugin metadata.
- [x] Domain/service/protocol/controller tests; packaged stdio test; browser interaction and keyboard checks.
- [ ] Actual Codex host round trip: ask in A, switch to B, answer returns to A without remount.
- [x] Session/context capacity checks and safe diagnostics; no repository-write tools or model API dependency.
- [x] Updated review skill and ADR, build/package/install instructions, release artifact.
- [x] GitHub repository visibility confirmed, source scanned, repo pushed, preview release uploaded and remotely verified.

## Decisions

- Existing local source matched the installed source before changes; the original Lense plugin is preserved while developing the renamed project.
- Active-session in-memory storage; explicit unavailable state after server restart, no silent history truncation.
- Same Codex task/subscription. Per-tab UI histories do not imply isolated agents.
- Read-only Diffs line selections and annotations, not editor Selection Action.
- Use bounded data-tool polling; no unverified sampling or notification dependency.
- SVG duck logo: code-native asset, no raster generation needed.
- GitHub account verified as PatrickOgilvie. User explicitly selected a public repository.
- Publish the initial build as a preview until the actual Codex-host loop and context boundary have been verified. Do not label simulated browser testing as host verification.

## Verification

- Production build and 26 tests passed (128 assertions), including a real stdio subprocess and in-memory MCP client.
- Plugin and skill validation passed.
- Browser preview: line selection, exact before/after scope, A/B answer routing, draft preservation and explicit revision adoption passed. A custom-gutter integration error was found during testing and corrected.
- New plugin installed through the personal marketplace. The current running task still exposes only the old Lense tool; reload Codex before the live-host check.
- The custom gutter action is intentionally deferred after pointer activation failed in the host. Exact selection and inline actions remain available, with a keyboard range picker.
- Public repository: https://github.com/PatrickOgilvie/diffduck
- Preview release: https://github.com/PatrickOgilvie/diffduck/releases/tag/v0.2.0-preview.1
- Archive SHA-256: ecbee6605109b702915d2673da4dc863235ad36857bc7400a8089d49b52d0800
- Final installed UI/server bundles match the released build byte-for-byte. Original Lense remains installed; no user plugin was removed.
- Remaining: reload Codex to expose the new model tools, verify the actual in-tab host round trip and near-limit context, then decide whether to promote a stable release.
