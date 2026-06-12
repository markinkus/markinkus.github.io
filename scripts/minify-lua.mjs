import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const inputPath = join(root, "lua", "markino_frame_app.lua");
const outputPath = join(root, "lua", "markino_frame_app.min.lua");
const source = readFileSync(inputPath, "utf8");

const isIdent = (char) => /[A-Za-z0-9_]/.test(char);
let output = "";
let quote = "";
let pendingSpace = false;

for (let index = 0; index < source.length; index += 1) {
  const char = source[index];
  const next = source[index + 1] ?? "";

  if (quote) {
    output += char;
    if (char === "\\" && next) {
      output += next;
      index += 1;
    } else if (char === quote) {
      quote = "";
    }
    continue;
  }

  if ((char === "'" || char === "\"")) {
    if (pendingSpace && output && isIdent(output.at(-1) ?? "") && isIdent(char)) output += " ";
    pendingSpace = false;
    quote = char;
    output += char;
    continue;
  }

  if (char === "-" && next === "-") {
    while (index < source.length && source[index] !== "\n") index += 1;
    pendingSpace = true;
    continue;
  }

  if (/\s/.test(char)) {
    pendingSpace = true;
    continue;
  }

  if (pendingSpace && output) {
    const prev = output.at(-1) ?? "";
    if (isIdent(prev) && isIdent(char)) output += " ";
  }
  pendingSpace = false;
  output += char;
}

writeFileSync(outputPath, `${output.trim()}\n`);
console.log(`Lua minified: ${source.length} -> ${output.length} bytes`);
