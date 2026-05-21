# laconic-skill

## Positioning

Brevity, enforced.

Skills tell the model what to do. laconic-skill deterministically checks whether output conforms to laconic rules.

A deterministic skill runtime that makes laconic AI responses enforceable.

The model can draft; the runtime enforces laconic output.

No model calls inside verification.

## Model

- skill = behavior spec
- verifier = deterministic form enforcement
- receipt = proof of laconic-rule compliance
- correctness-substrate interface is reserved for task-specific checks.

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
```

## Examples

- `examples/basic-check.md`
- `examples/rewrite-before-after.md`
- `examples/pipeline-receipt.json`

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

This project is source-available software, not open source.

License: Business Source License 1.1 (`BUSL-1.1`).

Production, SaaS, hosted, embedded, commercial, or competitive use requires a separate commercial license.

See [LICENSE](LICENSE) for full terms and the 2030-05-21 change date to Apache License, Version 2.0.

## Release Checklist

- source-available, not open source
- build passes
- tests pass
- CLI fixture checks pass
- receipt hash determinism confirmed
- no Laco dependency
- no database
- no web app
- no model calls in verifier

## Attribution

Inspired by public skill-file workflows. Not affiliated with Andrej Karpathy.
