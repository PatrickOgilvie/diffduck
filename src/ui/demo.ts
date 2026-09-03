import { ReviewSessions, defaultSessionLimits } from "../service/review-sessions.js";
import { exampleReview } from "../testing/fixtures.js";
import type { QuestionRef } from "../domain/commands.js";
import { respondSchema } from "../domain/commands.js";
import type { DiscussionPort } from "./diffduck-bridge.js";
import { AppLifetime } from "./app-lifetime.js";

/** Explicit development-only demo. Its replies are simulated, never presented as live Codex output. */
export function createDemo() {
  const sessions = new ReviewSessions({ newUuid: () => crypto.randomUUID(), now: () => new Date().toISOString(), emit: () => {} }, defaultSessionLimits);
  const opened = sessions.open(exampleReview());
  if (opened._tag !== "Ok") throw new Error("Invalid demonstration fixture");
  const lifetime = new AppLifetime(() => {});
  let current: QuestionRef | undefined;
  const port: DiscussionPort = {
    prepare: async (input) => { const result = sessions.prepare(input); if (result._tag === "Ok") current = result.value.ref; return result; },
    read: async (input) => sessions.read(input), recordDelivery: async (input) => sessions.recordDelivery(input),
    cancel: async (input) => sessions.cancel(input), adopt: async (input) => sessions.adopt(input),
    send: async () => {
      const ref = current;
      if (ref === undefined) return { _tag: "Rejected", message: "Demo question was not prepared." };
      lifetime.run(async (signal) => {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, 1_500);
          function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }
          signal.addEventListener("abort", done, { once: true });
          if (signal.aborted) done();
        });
        if (signal.aborted) return;
        const context = sessions.getQuestion(ref);
        if (context._tag !== "Ok") return;
        sessions.respond(respondSchema.parse({ ...ref, response: {
          _tag: "Answered",
          text: "Demo response: the proposed call site makes the sequence explicit. The useful design question is whether that clarity earns the extra API surface. This reply is attached to the exact example you selected, even if you switched tabs.",
          alternative: context.value.question.intent === "explore-alternative" ? {
            basedOnRevisionId: context.value.example.id,
            after: { label: "Alternative proposal", code: "import { pipe } from \"@popcomputer/pipeline\";\n\nconst result = await pipe(input, parse, validate, persist);\n" },
            observations: ["A function composition alternative, shown as an example only."],
          } : null,
        } }));
      });
      return { _tag: "Accepted" };
    },
  };
  return { port, snapshot: opened.value, dispose: () => lifetime.dispose(async () => {}) };
}
