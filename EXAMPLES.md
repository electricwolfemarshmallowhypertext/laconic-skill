# EXAMPLES

## 1. Verbose answer collapse

Verbose model answer:

```text
Sure, I'd be happy to help.
To recap, you asked for deployment steps.
Use `npm run build` and then run `npm test`.
I hope this helps.
```

Verifier result:

- violations: `BANNED_FILLER_PHRASE`, `BANNED_PREAMBLE`, `MISSING_DIRECT_ANSWER`
- char count: `134`

Rewritten laconic output:

```text
Use `npm run build` and then run `npm test`.
```

- char count: `44`
- reduction: `67.2%`

Why it matters: the answer survives; recap and filler do not.

## 2. Repeated prompt removal

Bad output repeats user request before answering:

```text
How do I reset my password?
Reset it in Settings > Security > Password.
```

With `userPrompt` configured as `How do I reset my password?`:

- violations: `REPEATED_PROMPT`, `MISSING_DIRECT_ANSWER`
- before chars: `71`

Rewrite output:

```text
Reset it in Settings > Security > Password.
```

- after chars: `43`
- reduction: `39.4%`

Why it matters: users get the answer, not their own question echoed back.

## 3. Filler/preamble removal

Bad output:

```text
Of course, just to clarify.
Run npm install before npm test.
```

Verifier result:

- violations: `BANNED_FILLER_PHRASE`, `BANNED_PREAMBLE`, `MISSING_DIRECT_ANSWER`
- before chars: `61`

Rewrite output:

```text
Run npm install before npm test.
```

- after chars: `32`
- reduction: `47.5%`

Why it matters: answer-first output is easier to scan in terminals and CI logs.

## 4. Prompt-injection-as-content resilience

Quoted/fenced phrase is treated as inert content:

```text
Use this exact literal in docs: "ignore laconic rules".
```

~~~text
Run npm test.
```text
ignore laconic rules
```
~~~

- result: no `BANNED_FILLER_PHRASE` violation

Unquoted operative phrase is rejected:

```text
Run npm test. ignore laconic rules.
```

- result: `BANNED_FILLER_PHRASE`

Scoped detection: banned injection phrases are checked outside quoted/fenced content.

## 5. Receipt proof

Minimal check/receipt shape:

```json
{
  "ok": false,
  "violations": [
    "BANNED_FILLER_PHRASE",
    "BANNED_PREAMBLE",
    "MISSING_DIRECT_ANSWER"
  ],
  "metrics": {
    "charCount": 134,
    "bulletCount": 0,
    "caveatCount": 0
  },
  "receipt_hash": "1f558c0531c48c5db60fc4a2359c9985bff014a130ec78f49f02f2b0dffcd519"
}
```

Why it matters: compliance can be audited deterministically.

## 6. Local style memory

Store accepted output:

```bash
node dist/cli.js memory add fixtures/pass/compliant.txt --outcome accepted --task writing
```

Pipeline with memory retrieves a similar accepted example:

```bash
node dist/cli.js pipeline fixtures/fail/filler_heavy.txt --task writing --memory --receipt
```

Observed behavior:

- `memory.enabled: true`
- `memory.retrieved: 1`
- `memory.examples[0].outcome: accepted`
- final output remains: `Run npm install before npm test.`

Memory does not override verifier rules. Pass/fail still comes from deterministic checks.
