# laconic-skill v0.1.2

**Brevity, verified. With local style memory.**

laconic-skill turns “be concise” from a prompt preference into a deterministic contract:

```text
verify → rewrite → receipt
```

## What is included

* Deterministic laconic verifier
* Deterministic rewrite path
* Hash-bound compliance receipts
* Local style memory
* Claude Code plugin manifest
* `EXAMPLES.md`
* `INTENTION.md`
* Apache-2.0 license + NOTICE attribution
* Benchmark proof
* CLI + stdin support
* CI-ready command semantics

## Proof

Benchmark result:

```text
20 verbose AI outputs
55.594% average character reduction
deterministic across 3 repeated runs
no model calls inside verification
```

## Claude Code

```bash
claude --plugin-dir .
claude plugin validate .
```

Skill invocation:

```text
/laconic-skill:laconic-responses
```

## CLI

```bash
laconic check output.txt --receipt
laconic rewrite output.txt --receipt
laconic pipeline output.txt --task writing --memory --receipt
cat output.txt | laconic check - --receipt
```

## Doctrine

Skills tell the model what to do.
laconic-skill proves whether it did it.

**Brevity, verified.**

## Attribution

Original project by Electric Wolfe Marshmallow Hypertext | Tionne Smith, 2026.
