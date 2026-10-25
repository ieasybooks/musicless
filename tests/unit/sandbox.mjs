// Runs an extension module in a vm sandbox with stand-ins for the browser:
// its imports are dropped (pass what it uses as globals) and its exports are
// returned. `rewrite` can adjust the source first (e.g. import.meta.url).
import { readFileSync } from "node:fs";
import vm from "node:vm";

export function load(file, globals = {}, rewrite = (source) => source) {
  const source = rewrite(readFileSync(new URL(`../../extension/${file}`, import.meta.url), "utf8"));
  const names = [...source.matchAll(/^export (?:async )?(?:function|class|const|let) (\w+)/gm)].map((match) => match[1]);
  const code = source.replace(/^import [\s\S]*?;\n/gm, "").replace(/^export /gm, "");
  const context = vm.createContext({ console, ...globals });
  vm.runInContext(`${code}\nglobalThis.__exports = { ${names.join(", ")} };`, context);
  return context.__exports;
}

// Lets pending promise callbacks run.
export const flush = async (rounds = 5) => {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
};

// A plain copy of a value from a sandbox, for deepEqual (its objects have the sandbox's prototypes).
export const plain = (value) => JSON.parse(JSON.stringify(value));
