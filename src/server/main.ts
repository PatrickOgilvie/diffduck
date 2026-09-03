import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ReviewSessions, defaultSessionLimits } from "../service/review-sessions.js";
import { createDiffDuckServer } from "./create-diffduck-server.js";

const sessions = new ReviewSessions({
  newUuid: randomUUID,
  now: () => new Date().toISOString(),
  emit: (event) => { process.stderr.write(`${JSON.stringify(event)}\n`); },
}, defaultSessionLimits);
const appHtmlPath = resolve(import.meta.dirname, "../mcp-app.html");
const server = createDiffDuckServer(sessions, () => readFile(appHtmlPath, "utf8"));
const transport = new StdioServerTransport();

await server.connect(transport);
