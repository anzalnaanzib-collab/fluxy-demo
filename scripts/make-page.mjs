// Builds public/fluxus.html: a COPY of the Fluxus Autopilot page with the Fluxy
// bridge added and visible "Claude" wording changed to "Fluxy".
// The original artifact in Claude is never touched; this only reads
// source/fluxus-original.html (a saved copy) and writes a new file.
import { readFileSync, writeFileSync } from "node:fs";

const SRC = process.env.FLUXUS_SOURCE || "source/fluxus-original.html";
const OUT = "public/fluxus.html";
let html = readFileSync(SRC, "utf8");
const log = [];
let failed = false;

function rep(name, pattern, replacement, { min = 1, max = Infinity } = {}) {
  let n = 0;
  html = html.replace(pattern, (...a) => { n++; return typeof replacement === "function" ? replacement(...a) : replacement; });
  log.push(`${String(n).padStart(4)}  ${name}`);
  if (n < min || n > max) { failed = true; log.push(`      ^ expected ${min}..${max === Infinity ? "∞" : max}`); }
}

// 1. Load the bridge before Fluxus's own code.
rep("inject bridge", /<head>/, '<head><meta name="robots" content="noindex"><link rel="stylesheet" href="/fluxy/tokens.css"><link rel="stylesheet" href="/fluxy/bridge-ui.css"><script src="/fluxy/bridge.js"></script>', { max: 1 });

// 2. Specific wording first (English).
rep("Fluxy's AI (Claude)", /Fluxy's AI \(Claude\) isn't allowed on this page yet/g, "Fluxy isn't available right now");
rep("Fluxy's AI (Claude) other", /Fluxy's AI \(Claude\)/g, "Fluxy", { min: 0 });
rep("Claude busy", /Claude is busy for this account right now\./g, "Fluxy is busy right now.");
rep("Claude not enabled", /Claude isn't enabled for this page, so Fluxus used its demo engine\./g, "Fluxy isn't available right now, so Fluxus used its demo engine.");
rep("your account", /Claude \(your account\)/g, "Fluxy", { min: 0 });
rep("open in Claude", /Open Fluxus in Claude to use this/g, "Fluxy needs to be online to use this", { min: 0 });
rep("agent label", /Fluxus agent \(Claude\)/g, "Fluxy", { min: 0 });
rep("by-claude display", /t\.by === "claude" \? "Claude"/g, 't.by === "claude" ? "Fluxy"', { min: 0 });
rep("label display", /a\.label === "Claude" \? "Claude"/g, 'a.label === "Claude" ? "Fluxy"', { min: 0 });
rep("upper case", /\bCLAUDE\b/g, "FLUXY", { min: 0 });

// 3. Protect factual mentions of other companies and internal data tags.
const keep = [];
const protect = (name, re) => rep(`keep: ${name}`, re, (m) => `\u0000K${keep.push(m) - 1}\u0000`, { min: 0 });
protect("Claude (Anthropic)", /Claude \(Anthropic\)/g);
protect("Claude Premium", /Claude Premium/g);
protect("ChatGPT, Claude, Gemini", /ChatGPT, Claude, Gemini/g);
protect("AI stack list", /Claude(?=[,،、]\s?OpenAI| وOpenAI)/g);
protect('exact "Claude" data value', /"Claude"/g);

// 4. Everything else: the word Claude in visible text becomes Fluxy.
//    \b means identifiers like useFxClaude are not touched; claude.ai stays lowercase.
rep("Claude -> Fluxy", /\bClaude\b/g, "Fluxy", { min: 50 });

html = html.replace(/\u0000K(\d+)\u0000/g, (_, i) => keep[Number(i)]);

// 5. Checks.
for (const bad of ["Ask Claude", "Claude is on", "Fluxy's AI (Claude)", "(Claude is off here)"]) {
  if (html.includes(bad)) { failed = true; log.push(`FAIL still contains: ${bad}`); }
}
const left = [...html.matchAll(/.{0,30}\bClaude\b.{0,30}/g)].map((m) => m[0].replace(/\s+/g, " "));
log.push(`remaining "Claude" mentions (factual or internal): ${left.length}`);

console.log(log.join("\n"));
if (failed) { console.error("make-page: a wording check failed; fix scripts/make-page.mjs"); process.exit(1); }
writeFileSync(OUT, html);
console.log(`wrote ${OUT} (${(html.length / 1e6).toFixed(1)} MB)`);
