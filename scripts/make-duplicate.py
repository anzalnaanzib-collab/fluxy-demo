#!/usr/bin/env python3
"""Build the duplicate copy of Fluxus that uses Fluxy's free engines.

    python3 scripts/make-duplicate.py                  # source/fluxus-original.html -> public/fluxus/index.html
    python3 scripts/make-duplicate.py --report         # also list every wording change

What it does, and nothing else:
  1. Reads the saved copy of the Fluxus page (the original artifact in Claude is never touched).
  2. Changes visible Fluxy wording from "Claude" to "Fluxy" inside text strings only,
     following the rules in replica/design/components.md. Code is not changed.
  3. Adds one <script src="/fluxy/bridge.js"> before the app's own script.
  4. Checks the result and stops with an error if anything looks wrong.
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source" / "fluxus-original.html"
OUT = ROOT / "public" / "fluxus" / "index.html"
BRIDGE_TAG = '<script src="/fluxy/bridge.js"></script>'

# Factual mentions of AI companies (AI Stack page, market research text) stay as they are.
KEEP_IF_CONTAINS = ("Anthropic", "OpenAI", "ChatGPT", "Gemini", "Perplexity", "claude.ai", "Claude Premium", "Higgsfield")

# Whole-phrase rewrites first (wording that would read oddly with a plain swap).
PHRASES = [
    ("Fluxy's AI (Claude) isn't allowed on this page yet,", "Fluxy isn't available right now,"),
    ("Allow Fluxy's AI (Claude) on this page to translate the rest of the text.", "Turn Fluxy on to translate the rest of the text."),
    ("Claude is busy for this account right now.", "Fluxy is busy right now."),
    ("Claude isn't enabled for this page,", "Fluxy isn't available right now,"),
    ("Open answers: Claude (your account)", "Open answers: Fluxy"),
    ("Claude (your account)", "Fluxy"),
    ("Claude (aap ka account)", "Fluxy"),
    ("Claude (آپ کا اکاؤنٹ)", "Fluxy"),
    ("Claude (tu cuenta)", "Fluxy"),
    ("Claude (حسابك)", "Fluxy"),
    ("Claude（你的账户）", "Fluxy"),
    ("✨ Claude is available in this page for open questions (you'll be asked to allow it once).", "✨ Fluxy is available on this page for open questions."),
    (" (you'll be asked to allow it once)", ""),
    ("Open Fluxus in Claude to have Claude analyse", "Turn Fluxy on to have Fluxy analyse"),
    ("Open Fluxus in Claude to use this", "Turn Fluxy on to use this"),
    ("Open Fluxus in Claude for fully custom marks drawn by Claude", "Turn Fluxy on for fully custom marks drawn by Fluxy"),
]

# Visible labels that sit inside code (the general pass skips code on purpose).
# Each must be found at least once, so a change in Fluxus is noticed.
CODE_FIXES = [
    ('children: t.by === "claude" ? "Claude" : "Fluxus demo engine"', 'children: t.by === "claude" ? "Fluxy" : "Fluxus demo engine"'),
    ('label: i === "claude" ? "Claude" : i', 'label: i === "claude" ? "Fluxy" : i'),
    ('a.label === "Claude" ? "Claude" : a.label', 'a.label === "Claude" ? "Fluxy" : a.label'),
    ('setNote("Claude is writing…")', 'setNote("Fluxy is writing…")'),
    ("`Written by Claude with the ${pb[0]} method · check it before you use it`", "`Written by Fluxy with the ${pb[0]} method · check it before you use it`"),
]
# Upper-case badges like "DRAWN BY CLAUDE" (all languages).
UPPER = re.compile(r'"([^"\n{}();=]{0,160}CLAUDE[^"\n{}();=]{0,160})"')

LITERAL = re.compile(r'"((?:[^"\\\n]|\\.){0,400}?)"|`((?:[^`\\]|\\.){0,400}?)`|\'((?:[^\'\\\n]|\\.){0,400}?)\'')
CODE_LIKE = re.compile(r"\bvoid 0\b|=>|\bfunction\b|\bconst \b|\breturn\b|\.slice\(|\bnull\b ==|\?\.")


def new_text(old: str):
    """The replacement for one string literal, or None to leave it alone."""
    if "Claude" not in old or old.strip() == "Claude":
        return None  # a bare "Claude" is also the AI Stack catalogue name: leave it
    if "\n" in old or CODE_LIKE.search(old):
        return None  # not a real UI string (regex spanned code)
    if any(k in old for k in KEEP_IF_CONTAINS):
        return None
    s = old
    for a, b in PHRASES:
        s = s.replace(a, b)
    s = s.replace("Claude's", "Fluxy's").replace("Claude", "Fluxy")
    return s if s != old else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()
    if not SRC.exists():
        print(f"missing {SRC}. Save the Fluxus page there first.", file=sys.stderr)
        return 2
    html = SRC.read_text(encoding="utf-8")
    original_len = len(html)

    # 1. collect candidate literals with their quote character
    seen = {}
    for m in LITERAL.finditer(html):
        q = '"' if m.group(1) is not None else "`" if m.group(2) is not None else "'"
        old = m.group(1) if q == '"' else m.group(2) if q == "`" else m.group(3)
        if old and "Claude" in old:
            seen.setdefault((q, old), 0)

    # 2. apply exact, quote-delimited replacements and count them
    changes = []
    for (q, old) in seen:
        new = new_text(old)
        if new is None:
            continue
        needle, repl = q + old + q, q + new + q
        n = html.count(needle)
        if n == 0:
            continue
        html = html.replace(needle, repl)
        changes.append((n, old, new))

    problems = []
    for a, b in CODE_FIXES:
        n = html.count(a)
        if n == 0:
            problems.append(f"expected code label not found: {a[:60]}")
            continue
        html = html.replace(a, b)
        changes.append((n, a, b))
    for old in sorted(set(UPPER.findall(html))):
        new = old.replace("CLAUDE", "FLUXY")
        n = html.count('"' + old + '"')
        html = html.replace('"' + old + '"', '"' + new + '"')
        changes.append((n, old, new))

    # 3. add the bridge before the app's first module script (exactly once)
    if BRIDGE_TAG in html:
        print("bridge tag already present in the source; refusing to add it twice", file=sys.stderr)
        return 1
    i = html.find('<script type="module"')
    if i < 0:
        print("could not find the app's module script", file=sys.stderr)
        return 1
    html = html[:i] + BRIDGE_TAG + "\n" + html[i:]

    # 4. checks
    for must_be_gone in ['"Ask Claude"', '"Claude is on"', "Fluxy's AI (Claude)", '"Checking Claude…"', '"Demo answers (Claude is off here)"',
                         '"Claude is writing…"', "BY CLAUDE", '? "Claude" :']:
        if must_be_gone in html:
            problems.append(f"still present: {must_be_gone}")
    for must_stay in ["window.claude", 'id: "claude"', '"Claude (Anthropic)"']:
        if must_stay not in html:
            problems.append(f"code or factual text was changed by mistake: {must_stay}")
    if html.count(BRIDGE_TAG) != 1:
        problems.append("bridge tag count is not 1")
    if abs(len(html) - original_len) > 20000:
        problems.append("size changed by more than 20 KB; rules too broad?")
    if len(changes) < 50:
        problems.append(f"only {len(changes)} strings changed; did the Fluxus page change?")

    print(f"{len(changes)} distinct strings changed ({sum(c[0] for c in changes)} places); bridge added once.")
    if args.report:
        for n, old, new in sorted(changes, key=lambda c: -c[0]):
            print(f"  x{n}  {old[:90]!r}\n      -> {new[:90]!r}")
    if problems:
        print("PROBLEMS:\n  " + "\n  ".join(problems), file=sys.stderr)
        return 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(html):,} characters)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
