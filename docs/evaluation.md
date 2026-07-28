# Evaluation

laconic-skill has separate proof gates for separate claims.

## Curated benchmark

Command:

```bash
npm run benchmark
```

What it proves:

- deterministic rewrite behavior on the repo benchmark corpus
- character reduction on known verbose AI-style outputs
- no false fails on compliant controls
- holdout rewrite behavior on a small non-tuned set

What it does not prove:

- arbitrary real-world assistant prose coverage
- factual correctness
- schema correctness

## Pre-labeled messy prose eval

Command:

```bash
npm run eval:labeled -- --labels eval/prose/labels.json --out .eval/labeled-prose-report.json
```

Use this for real agent logs, PR comments, status updates, review comments, and documentation drafts.

Labels must be written before the run. The runner exits nonzero on pass/fail misses. If a failing case has `fixable: true`, rewrite must also pass.

Label format:

```json
[
  {
    "file": "case001.txt",
    "expected": "fail",
    "expected_codes": ["BANNED_PREAMBLE", "MISSING_DIRECT_ANSWER"],
    "fixable": true,
    "category": "agent status update",
    "source": "real agent output"
  }
]
```

## ScrapeGraphAI structured-output eval

Pull rows:

```bash
python -c "import requests, pathlib; r=requests.get('https://datasets-server.huggingface.co/rows', params={'dataset':'scrapegraphai/scrapegraphai-100k','config':'default','split':'train','offset':0,'length':100}, timeout=60); pathlib.Path('rows.json').write_text(r.text, encoding='utf-8')"
```

Run:

```bash
npm run eval:scrapegraphai
```

What it proves:

- concise JSON/object/array outputs are accepted as direct output
- long structured outputs fail length policy
- the eval is repeatable from local `rows.json`

It also writes a correctness-confidence report from the dataset's `response_is_valid` field. That report measures schema-validity confidence only. It is not generic truth checking.

## Required claim discipline

Do not claim broad messy-prose robustness unless a pre-labeled messy-prose eval passes.

Do not claim correctness unless a task-specific evaluator supplies measured scores and spec limits.