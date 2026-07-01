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
- no unnecessary caveats
- no unsolicited options
- max chars unless overridden
- preserve factual accuracy over brevity

Runtime:
- Use the deterministic CLI for checks, rewrites, pipelines, and receipts.
- From this repo after `npm run build`, run `node dist/cli.js`.
- If installed from npm, run `laconic`.
- Do not use model calls to verify, rewrite, or generate receipts.
