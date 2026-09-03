import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { z } from "zod";

const root = resolve(import.meta.dirname, "..");
const manifest = z.object({ name: z.literal("diffduck"), version: z.string().regex(/^\d+\.\d+\.\d+$/) })
  .parse(JSON.parse(await readFile(join(root, ".codex-plugin/plugin.json"), "utf8")));
const staging = await mkdtemp(join(tmpdir(), "diffduck-package-"));
const plugin = join(staging, "diffduck");
await mkdir(plugin);
for (const path of [".codex-plugin", ".mcp.json", "assets", "skills", "README.md", "CONTEXT.md", "docs", "THIRD_PARTY_NOTICES.txt"]) {
  await cp(join(root, path), join(plugin, path), { recursive: true });
}
await mkdir(join(plugin, "dist/server"), { recursive: true });
for (const file of ["mcp-app.html", "server/main.js"]) await cp(join(root, "dist", file), join(plugin, "dist", file));
const release = join(root, "release");
await mkdir(release, { recursive: true });
const name = `diffduck-${manifest.version}.zip`;
const archive = join(release, name);
// Create a fresh archive so old entries cannot survive a rebuild.
const zipped = Bun.spawn(["zip", "-q", "-r", join(staging, name), "diffduck"], { cwd: staging, stdout: "inherit", stderr: "inherit" });
if (await zipped.exited !== 0) throw new Error("Archive creation failed");
await cp(join(staging, name), archive);
const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
await writeFile(join(release, "SHA256SUMS"), `${digest}  ${name}\n`);
console.log(`Packaged ${archive}`);
console.log(`Isolated plugin for verification: ${plugin}`);
