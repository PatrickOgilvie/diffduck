import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { z } from "zod";

const root = resolve(import.meta.dirname, "..");
const modules = join(root, "node_modules");
const manifestSchema = z.object({ name: z.string(), version: z.string(), license: z.unknown().optional() });
const directories: string[] = [];
for (const entry of await readdir(modules, { withFileTypes: true })) {
  if (entry.name.startsWith(".")) continue;
  if (entry.name.startsWith("@")) {
    for (const child of await readdir(join(modules, entry.name))) directories.push(join(modules, entry.name, child));
  } else directories.push(join(modules, entry.name));
}
const notices = ["DiffDuck third-party notices", "", "License texts from the locked build environment. This includes build-time packages as well as runtime code; inclusion is not a claim that every package is distributed in the bundle.", ""];
for (const directory of directories.sort()) {
  const manifest = manifestSchema.parse(JSON.parse(await readFile(join(directory, "package.json"), "utf8")));
  const files = (await readdir(directory)).filter((name) => /^(licen[cs]e|notice|copying)(\..*)?$/i.test(name)).sort();
  notices.push(`--- ${manifest.name}@${manifest.version} ---`, `Declared license: ${JSON.stringify(manifest.license ?? "not declared")}`);
  for (const file of files) notices.push("", `[${file}]`, await readFile(join(directory, file), "utf8"));
  notices.push("");
}
await writeFile(join(root, "THIRD_PARTY_NOTICES.txt"), notices.join("\n"));
console.log("Generated third-party notices from installed package license files.");
