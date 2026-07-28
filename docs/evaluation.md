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
npm run eval:labeled
```

The default checked-in eval uses `200` public assistant messages sampled from the MIT-licensed `HuggingFaceH4/ultrachat_200k` `train_sft` split. Labels are stored in `eval/prose/labels.json`.

Current expected mix:

- `18` expected pass
- `182` expected fail
- `70` trimming-fixable failures

The runner exits nonzero on pass/fail misses. If a failing case has `fixable: true`, rewrite must also pass. The default gate requires at least `100` cases and `20` fixable cases.

Use custom labels for real agent logs, PR comments, status updates, review comments, and documentation drafts:

```bash
npm run eval:labeled -- --labels path/to/labels.json --out .eval/custom-report.json --min-cases 100 --min-fixable 20
```

Labels must be written before the run.

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

The checked-in public prose eval proves behavior against that frozen public corpus. It does not prove all arbitrary assistant prose.
