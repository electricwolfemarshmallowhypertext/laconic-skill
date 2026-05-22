# INTENTION

laconic-skill exists because asking a model to "be concise" is not enough.

Most AI style control is still treated like a preference. The user asks for brevity. The system prompt asks for brevity. The model still drifts, explains too much, repeats the question, adds caveats nobody asked for, or pads the answer with polite noise.

This project makes a narrower claim:

**Brevity should be enforceable.**

## What this is

laconic-skill is a deterministic response-style runtime.

The skill file defines what laconic output means. The verifier checks whether an output actually complied. The rewrite path trims what can be trimmed without using a model call. The receipt records what happened.

The basic loop is:

```text
input
-> draft
-> deterministic checks
-> rewrite/trim
-> pass/fail receipt
```

The model can draft. The runtime enforces.

## What this is not

This is not a general-purpose AI agent.

This is not a prompt collection.

This is not a claim that short answers are always better.

This is not a correctness engine. The current correctness substrate is reserved for future task-specific checks. laconic-skill verifies response form: length, structure, filler, preambles, repeated prompts, and related style constraints.

## Why deterministic

A style rule that cannot be checked is just a suggestion.

laconic-skill keeps verification deterministic so the same input, config, and output produce the same result. That makes it usable in CLI flows, CI, agent pipelines, and receipt-based review.

No model calls happen inside verification.

## What matters

The point is not to make every answer tiny.

The point is to remove waste.

Good laconic output should preserve the answer, remove the performance, and leave the user with the usable signal.

## Doctrine

Skills tell the model what to do.

laconic-skill proves whether it did it.

Brevity, verified.

## Attribution

Original project by Electric Wolfe Marshmallow Hypertext | Tionne Smith, 2026.

Inspired by public skill-file workflows and the broader movement toward tool-readable agent instructions. Not affiliated with Andrej Karpathy.
