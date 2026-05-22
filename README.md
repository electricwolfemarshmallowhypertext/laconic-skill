![laconic-skill banner](imgs/laconic-skill.png)

# laconic-skill

## Positioning

Brevity, verified - with local style memory.

Skills tell the model what to do. laconic-skill deterministically checks whether output conforms to laconic rules.

A deterministic skill runtime that makes laconic AI responses enforceable.

The model can draft; the runtime enforces laconic output.

No model calls inside verification.

Style memory is optional and local-only. Core verifier pass/fail stays deterministic and memory-free.

## Model

- skill = behavior spec
- verifier = deterministic form enforcement
- receipt = proof of laconic-rule compliance
- correctness-substrate interface is reserved for task-specific checks.

## Local style memory

![Local style memory flow](imgs/laconic-skill-arch.png)

Memory stores accepted outputs, rejected outputs, rewrite patterns, violation codes, metrics, and receipt hashes. It informs style retrieval only. It does not override deterministic verifier rules.

## Install

```bash
npm install
npm run build
```

## Demo Commands

```bash
npm install
npm run build
node dist/cli.js check fixtures/pass/compliant.txt --receipt
node dist/cli.js rewrite fixtures/fail/verbose_recap_heavy.txt --receipt
node dist/cli.js pipeline fixtures/fail/filler_heavy.txt --task writing --receipt
node dist/cli.js memory add fixtures/pass/compliant.txt --outcome accepted --task writing
node dist/cli.js memory search "npm run build" --limit 5
node dist/cli.js pipeline fixtures/fail/filler_heavy.txt --task writing --memory --receipt
```

## Examples

- `examples/basic-check.md`
- `examples/rewrite-before-after.md`
- `examples/pipeline-receipt.json`

## Claude Code plugin

Local test:

```bash
claude --plugin-dir .
```

Then invoke:

```text
/laconic-skill:laconic-responses
```

Validate:

```bash
claude plugin validate .
```

## Adoption Hooks

GitHub Action snippet:

```yaml
name: laconic-check

on:
  pull_request:

jobs:
  laconic:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run build
      - run: cat output.txt | laconic check - --receipt
```

Pipe example:

```bash
cat output.txt | laconic check - --receipt
```

## License

laconic-skill is open source under the Apache License 2.0.

Attribution is preserved through the project NOTICE file:

Electric Wolfe Marshmallow Hypertext | Tionne Smith, 2026.

The software is Apache-2.0 licensed. Project names, marks, and branding are reserved separately.

## Release Checklist

- Apache-2.0 license and NOTICE included
- build passes
- tests pass
- CLI fixture checks pass
- receipt hash determinism confirmed
- no Laco dependency
- no database
- no web app
- no model calls in verifier

## Attribution

Inspired by Karpathy's public skill-file. Not affiliated with Andrej Karpathy.
