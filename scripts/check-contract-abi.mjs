#!/usr/bin/env node
// Contract ABI compatibility gate.
//
// Extracts the public entrypoints (`pub fn` inside `#[contractimpl]` blocks) of
// every Soroban contract under contracts/*/src/lib.rs and compares them with
// the committed baseline contracts/abi-baseline.json.
//
//   - a removed or changed entrypoint fails the check (breaking ABI change);
//   - a new entrypoint is allowed but the baseline must be refreshed, so the
//     check also fails until `--update` is run and the result is committed.
//
// Usage:
//   node scripts/check-contract-abi.mjs            # verify
//   node scripts/check-contract-abi.mjs --update   # regenerate the baseline
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "contracts", "abi-baseline.json");
const REGEN = "node scripts/check-contract-abi.mjs --update";

// Generated TypeScript client package that must be regenerated when a
// contract's interface changes (contracts without a client are omitted).
const CLIENT_PACKAGES = {
  proof_registry: "frontend/packages/proof-registry",
  issuer_registry: "frontend/packages/issuer-registry",
};

const norm = (s) => s.replace(/\s+/g, " ").replace(/\s*,\s*$/, "").trim();

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// Index of the brace closing the one opened at `open`.
function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return i;
  }
  throw new Error("unbalanced braces");
}

function extract(src) {
  const code = stripComments(src);
  const fns = {};
  const implRe = /#\[contractimpl[^\]]*\]\s*impl\b[^{]*\{/g;
  let m;
  while ((m = implRe.exec(code))) {
    const open = m.index + m[0].length - 1;
    const body = code.slice(open + 1, matchBrace(code, open));
    // Scan the impl body; only signatures at brace depth 0 are entrypoints.
    let depth = 0;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (depth === 0 && /^pub\s+fn\s/.test(body.slice(i, i + 8)) && (i === 0 || /\W/.test(body[i - 1]))) {
        const brace = body.indexOf("{", i);
        const sig = body.slice(i, brace);
        const nm = /^pub\s+fn\s+(\w+)\s*\(/.exec(sig);
        if (!nm) throw new Error(`cannot parse signature: ${sig}`);
        let d = 1;
        let j = nm[0].length;
        for (; j < sig.length && d > 0; j++) d += sig[j] === "(" ? 1 : sig[j] === ")" ? -1 : 0;
        const params = sig.slice(nm[0].length, j - 1);
        const ret = sig.slice(j).replace(/^\s*->\s*/, "");
        fns[nm[1]] = `(${norm(params)}) -> ${norm(ret) || "()"}`;
      }
    }
  }
  return fns;
}

function current() {
  const out = {};
  const dir = path.join(ROOT, "contracts");
  for (const name of fs.readdirSync(dir).sort()) {
    const lib = path.join(dir, name, "src", "lib.rs");
    if (!fs.existsSync(lib)) continue;
    const fns = extract(fs.readFileSync(lib, "utf8"));
    if (Object.keys(fns).length) out[name] = Object.fromEntries(Object.entries(fns).sort());
  }
  return out;
}

const now = current();

if (process.argv.includes("--update")) {
  fs.writeFileSync(BASELINE, JSON.stringify(now, null, 2) + "\n");
  console.log(`Wrote ${path.relative(ROOT, BASELINE)}`);
  process.exit(0);
}

const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const breaking = [];
const additive = [];
for (const contract of Object.keys(base)) {
  for (const [fn, sig] of Object.entries(base[contract])) {
    const cur = now[contract]?.[fn];
    if (cur === undefined) breaking.push(`${contract}::${fn} was removed`);
    else if (cur !== sig) breaking.push(`${contract}::${fn} changed\n      baseline: ${sig}\n      current:  ${cur}`);
  }
}
for (const contract of Object.keys(now)) {
  for (const fn of Object.keys(now[contract])) {
    if (base[contract]?.[fn] === undefined) additive.push(`${contract}::${fn} is new`);
  }
}

const stale = [...new Set([...breaking, ...additive].map((l) => l.split("::")[0]))]
  .map((c) => CLIENT_PACKAGES[c])
  .filter(Boolean);

if (breaking.length || additive.length) {
  console.error("Contract ABI differs from contracts/abi-baseline.json:");
  for (const l of breaking) console.error(`  BREAKING  ${l}`);
  for (const l of additive) console.error(`  ADDED     ${l}`);
  if (stale.length) console.error(`Stale generated client package(s): ${stale.join(", ")}`);
  console.error(`Regenerate the baseline with: ${REGEN}`);
  if (stale.length) console.error("and regenerate the client(s) with: npm run codegen:clients");
  process.exit(1);
}
console.log("Contract ABI matches the committed baseline.");
