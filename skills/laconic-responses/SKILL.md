---
name: laconic-responses
description: Enforces concise, answer-first AI responses with deterministic checks.
license: Apache-2.0
---

# Laconic Responses

Rules:
- answer first
- no recap
- no filler
- no AI-tell throat clearing
- no unnecessary caveats
- no unsolicited options
- max chars unless overridden
- preserve factual accuracy over brevity

Laconic output removes waste, not meaning. Prefer direct nouns and verbs over announcements, apologies, discourse markers, and performative emphasis.

Reference files:
- `references/anti-slop.md` lists concrete phrase and structure patterns to avoid.
- `references/examples.md` shows before/after laconic rewrites.

Runtime:
- Use the deterministic CLI for checks, rewrites, pipelines, and receipts.
- From this repo after `npm run build`, run `node dist/cli.js`.
- If installed from npm, run `laconic`.
- Do not use model calls to verify, rewrite, or generate receipts.
