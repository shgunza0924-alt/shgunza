const { readdirSync, readFileSync, statSync } = require("node:fs");
const { resolve, relative } = require("node:path");
const { spawnSync } = require("node:child_process");

const root = resolve(__dirname, "..");
const ignored = new Set([".git", "node_modules"]);

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignored.has(entry.name)) return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

const sourceFiles = filesUnder(root);
const javascriptFiles = sourceFiles.filter((path) => /\.(?:js|cjs|mjs)$/.test(path));

for (const path of javascriptFiles) {
  const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

const html = readFileSync(resolve(root, "index.html"), "utf8");
const localReferences = Array.from(html.matchAll(/(?:src|href)=(['"])([^'"?#]+)(?:[?#][^'"]*)?\1/g))
  .map((match) => match[2])
  .filter((value) => !/^(?:https?:|data:|#|\/)/.test(value));

for (const reference of localReferences) {
  const target = resolve(root, reference);
  try {
    if (!statSync(target).isFile()) throw new Error();
  } catch {
    throw new Error(`Missing local asset: ${reference}`);
  }
}

console.log(`Verified ${javascriptFiles.length} JavaScript files and ${localReferences.length} local HTML assets.`);
