# Discussion architecture

The composition root creates one `ReviewSessions` owner and one MCP stdio server. React owns a `DiscussionController` per mounted surface, with an MCP Apps adapter at its external boundary.

```text
Select/compose → prepare question → frozen context + routing identity
                       ↓
                send host message
                       ↓
Codex task → get exact context → respond to the original question
                                      ↓
Mounted UI ← conditional session read ← stored terminal response
```

## Ownership

| Module | Owns |
| --- | --- |
| domain/review, domain/discussion | Parsed example, provenance, selection and conversation contracts |
| domain/commands, protocol/diffduck | Strict command/result boundaries and exported protocol |
| service/review-sessions | Immutable histories, guarded transitions, identities and capacity |
| server/create-diffduck-server | MCP registration, visibility and UI resource metadata |
| ui/diffduck-bridge | Validated host tool results and delivery classification |
| ui/discussion-controller | Per-tab drafts, selection, unread state, dispatch and bounded polling |
| ui/code-comparison, ui/discussion-panel | Read-only examples, annotations, transcript and composer |
| ui/app-lifetime | Setup/fullscreen/teardown promise ownership |

## Invariants

Opening and preparing are idempotent by caller identity plus equal input. A replay never automatically sends another host message. Responses use session, question and context identities; identical retries succeed, conflicting responses fail. A delivery receipt cannot overwrite a completed or cancelled question.

The service derives selected text from normalized, stored code, not browser-supplied snippets. Ranges are one-sided, inclusive and one-based; a terminal newline is not a phantom line. A context contains full examples and nonrecursive preceding history plus any historical revisions needed to interpret it.

Preparing checks the scenario transcript version the user saw. Adoption checks both the current revision and the alternative's base. It retains the before-pane and all old revisions. Existing drafts are not silently re-anchored by adoption or historical viewing.

Only the opening tool renders a resource. Other success results are typed data; only errors set `isError`. The SDK requires an object success output schema, so the server publishes that schema while the UI also parses the explicit error result union.

Session mutations commit synchronously after capacity validation. No persistence or silent pruning occurs. IDs are local capabilities, not user-account authentication. Tool visibility is host-enforced metadata, not a substitute for an authorization server if a network transport is added later.

## Integration constraints

The host must support MCP Apps text messages and app-only server calls. This implementation does not use MCP sampling, a public callback URL, notification subscriptions or a second model SDK. Replies are stored as completed messages, not token streams.

The controller owns cancellation for every host call, ignores stale/foreign snapshots, allows at most one polling call in flight, and supervises every promise. Visibility and unmount cancel reads/timers; dispatch uncertainty does not imply non-delivery.

Preparation can commit before its response is lost. The controller then requires reconciliation before permitting another submission, even if it has not yet seen a pending question. A fresh session read restores the stored question and its actions, or proves that preparation did not commit. Failed reads preserve this requirement, drafts and selection; bounded polling and explicit checking remain available. Reads started before the preparation are cancelled, so an older unchanged result cannot falsely resolve its outcome. Reconciliation never sends a host message.

See [MCP Apps UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui#separate-data-processing-from-ui-rendering) and [Diffs documentation](https://diffs.com/llms-full.txt). The real Codex-host round trip remains a separate release check.
