![laconic-skill banner](imgs/laconic-skill.png)

# laconic-skill

AI agents write too much.

laconic-skill checks AI output after it is written. It can pass, fail, rewrite, and emit receipts for concise-output checks without calling a model during verification.

The model drafts.
The runtime verifies.

Use it for:

- AI-generated pull request descriptions
- code review comments
- agent status updates
- documentation drafts
- any workflow where verbose AI output wastes reviewer time

## Why This Exists

Prompting can ask an AI to be brief. It cannot prove the output stayed brief.

laconic-skill runs outside the model. It applies deterministic rules, returns pass/fail results, and can emit a JSON receipt for the check.

## 60-Second Proof

Install and build once:

```bash
npm install
npm run build
```

Check a concise output:

```bash
node dist/cli.js check fixtures/pass/compliant.txt --receipt
```

Rewrite a verbose output:

```bash
node dist/cli.js rewrite fixtures/fail/verbose_recap_heavy.txt --receipt
```

Run the full pipeline:

```bash
node dist/cli.js pipeline fixtures/fail/filler_heavy.txt --task writing --receipt
```

Emit a receipt from stdin:

```bash
cat output.txt | node dist/cli.js check - --receipt
```

## Proof

- `50` corpus files: the benchmark runs against realistic verbose AI outputs in `benchmarks/corpus/*.txt`.
- `63.477%` average character reduction: the benchmark reports average shrinkage after deterministic rewrite.
- `50/50` fixable outputs passed after rewrite: every benchmark output that started failing passed after rewrite.
- `0` compliant false fails: short compliant controls in `benchmarks/compliant/*.txt` stayed passing.
- Deterministic across `5` runs: the benchmark repeats and compares stable output signatures.
- No model calls during verification: the verifier runs locally and deterministically; `package.json` includes no model SDK dependency.
- Receipt hash determinism: tests verify the same input/output/config produces the same receipt hash.

## What This Is

A local verification runtime for concise AI output.

## What It Does

- checks output
- rewrites verbose output
- runs pipelines
- emits receipts
- optionally uses local style memory
- integrates with Claude Code

## Architecture

```text
input
-> draft text
-> laconic verifier
-> optional deterministic rewrite
-> final text
-> receipt
```

Core pieces:

- `skills/laconic-responses/SKILL.md` defines the laconic response behavior.
- `src/verifier.ts` checks length, bullets, filler, preambles, repeated prompts, answer-first opening, and caveat limits.
- `src/rewrite.ts` trims output without inventing facts.
- `src/receipt.ts` creates hash-bound receipts.
- `src/pipeline.ts` connects draft text, verification, optional rewrite, placeholder correctness checks, and receipts.
- `src/memory/` contains optional local style memory.

## Local Memory Boundary

![Local style memory flow](imgs/laconic-skill-arch.png)

Memory can guide style.
Memory does not decide verifier pass/fail.

Memory can affect style retrieval, preferred phrasing, and rewrite suggestions. It does not override deterministic checks or rule enforcement.

Memory-enabled pipeline receipts may include memory metrics so the receipt identifies the exact run context. Core verifier receipts do not require memory.

## Examples

- Full walkthroughs: `EXAMPLES.md`
- Basic check: `examples/basic-check.md`
- Rewrite before/after: `examples/rewrite-before-after.md`
- Pipeline receipt: `examples/pipeline-receipt.json`

## Claude Code Plugin

Local test:

```bash
claude --plugin-dir .
```

Invoke the skill:

```text
/laconic-skill:laconic-responses
```

Validate the plugin:

```bash
claude plugin validate .
```

## CLI Usage

Check output:

```bash
node dist/cli.js check fixtures/pass/compliant.txt --receipt
```

Rewrite verbose output:

```bash
node dist/cli.js rewrite fixtures/fail/verbose_recap_heavy.txt --receipt
```

Run the pipeline:

```bash
node dist/cli.js pipeline fixtures/fail/filler_heavy.txt --task writing --receipt
```

Use local style memory:

```bash
node dist/cli.js memory add fixtures/pass/compliant.txt --outcome accepted --task writing
node dist/cli.js memory search "npm run build" --limit 5
node dist/cli.js pipeline fixtures/fail/filler_heavy.txt --task writing --memory --receipt
```

## License

laconic-skill is open source under the Apache License 2.0.

Attribution is preserved through the project NOTICE file:

Electric Wolfe Marshmallow Hypertext | Tionne Smith, 2026.

The software is Apache-2.0 licensed. Project names, marks, and branding are reserved separately.

Inspired by Karpathy's public skill-file. Not affiliated with Andrej Karpathy.
