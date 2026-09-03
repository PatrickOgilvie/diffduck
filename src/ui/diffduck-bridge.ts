import { z } from "zod";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { AdoptAlternative, PrepareQuestion, QuestionRef, ReadSession, RecordDelivery } from "../domain/commands.js";
import type { Result, SessionSnapshot } from "../domain/discussion.js";
import { fail, ok } from "../domain/discussion.js";
import { toolContracts, type AppToolName, type DuckError } from "../protocol/diffduck.js";
import type { PreparedQuestion, SessionRead } from "../service/review-sessions.js";

/** Caller-owned cancellation for every asynchronous host operation. */
export type AsyncOptions = { readonly signal?: AbortSignal };
/** Expected transport and server failures presented without raw host exceptions. */
export type ClientFailure = DuckError | {
  readonly _tag: "HostUnavailable" | "InvalidHostResponse" | "Cancelled";
  readonly message: string;
};
/** A host acknowledgement never implies that generation finished. */
export type HostDelivery =
  | { readonly _tag: "Accepted" }
  | { readonly _tag: "Rejected"; readonly message: string }
  | { readonly _tag: "Unconfirmed"; readonly message: string };

/** The controller's real external seam, implemented by MCP Apps or a recorded test host. */
export interface DiscussionPort {
  prepare(input: PrepareQuestion, options: AsyncOptions): Promise<Result<PreparedQuestion, ClientFailure>>;
  recordDelivery(input: RecordDelivery, options: AsyncOptions): Promise<Result<SessionSnapshot, ClientFailure>>;
  read(input: ReadSession, options: AsyncOptions): Promise<Result<SessionRead, ClientFailure>>;
  cancel(input: QuestionRef, options: AsyncOptions): Promise<Result<SessionSnapshot, ClientFailure>>;
  adopt(input: AdoptAlternative, options: AsyncOptions): Promise<Result<SessionSnapshot, ClientFailure>>;
  send(trigger: string, options: AsyncOptions): Promise<HostDelivery>;
}

/** Translate MCP Apps mechanics into parsed application outcomes. */
export class DiffDuckBridge implements DiscussionPort {
  /** Bind to the originating app's allowed server-tool and message capabilities. */
  constructor(private readonly app: Pick<App, "callServerTool" | "sendMessage">) {}

  /** Freeze a new question before dispatch. */
  prepare(input: PrepareQuestion, options: AsyncOptions) {
    return this.call("prepare_diffduck_question", input, toolContracts.prepare_diffduck_question.output, options);
  }
  /** Record delivery, preserving terminal states. */
  recordDelivery(input: RecordDelivery, options: AsyncOptions) {
    return this.call("record_diffduck_delivery", input, toolContracts.record_diffduck_delivery.output, options);
  }
  /** Fetch a conditional snapshot without opening another surface. */
  read(input: ReadSession, options: AsyncOptions) {
    return this.call("read_diffduck_session", input, toolContracts.read_diffduck_session.output, options);
  }
  /** Close the logical question, not the underlying Codex task. */
  cancel(input: QuestionRef, options: AsyncOptions) {
    return this.call("cancel_diffduck_question", input, toolContracts.cancel_diffduck_question.output, options);
  }
  /** Adopt an example-only alternative under a revision guard. */
  adopt(input: AdoptAlternative, options: AsyncOptions) {
    return this.call("adopt_diffduck_alternative", input, toolContracts.adopt_diffduck_alternative.output, options);
  }
  /** Send once; transport failures mean delivery is uncertain, not definitely rejected. */
  async send(trigger: string, options: AsyncOptions): Promise<HostDelivery> {
    if (options.signal?.aborted) return { _tag: "Unconfirmed", message: "Delivery was interrupted. The question has not been resent." };
    try {
      const response: unknown = await this.app.sendMessage({ role: "user", content: [{ type: "text", text: trigger }] }, options);
      const parsed = z.object({ isError: z.boolean().optional() }).safeParse(response);
      if (!parsed.success) return { _tag: "Unconfirmed", message: "The host receipt was not understood. Check for an answer before retrying." };
      return parsed.data.isError === true
        ? { _tag: "Rejected", message: "Codex did not accept this question." }
        : { _tag: "Accepted" };
    } catch {
      return { _tag: "Unconfirmed", message: "Delivery could not be confirmed. Codex may already have received the question." };
    }
  }

  private async call<T>(name: AppToolName, input: Record<string, unknown>, schema: z.ZodType<Result<T, DuckError>>, options: AsyncOptions): Promise<Result<T, ClientFailure>> {
    if (options.signal?.aborted) return fail("Cancelled", "The operation was cancelled.");
    try {
      const response = await this.app.callServerTool({ name, arguments: input }, options);
      if (options.signal?.aborted) return fail("Cancelled", "The operation was cancelled.");
      const parsed = schema.safeParse(response.structuredContent);
      if (!parsed.success) return response.isError === true
        ? fail("InvalidInput", "The host rejected this DiffDuck command. Your draft has been kept.")
        : fail("InvalidHostResponse", "DiffDuck received an invalid response. Its existing discussion has been kept.");
      if (response.isError === true && parsed.data._tag === "Ok") return fail("InvalidHostResponse", "The host response contained inconsistent success information.");
      return parsed.data._tag === "Err" ? parsed.data : ok(parsed.data.value);
    } catch {
      return options.signal?.aborted ? fail("Cancelled", "The operation was cancelled.")
        : fail("HostUnavailable", "The connection to DiffDuck is unavailable. Your draft has been kept.");
    }
  }
}
