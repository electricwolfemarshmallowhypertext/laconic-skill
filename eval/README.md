# Evaluation

Use this folder for pre-labeled eval sets.

The important rule: labels must be written before running the checker.

## Public assistant prose eval

The checked-in `eval/prose/` corpus contains `200` public assistant messages sampled from the MIT-licensed Hugging Face dataset `HuggingFaceH4/ultrachat_200k`, `train_sft` split.

Current label mix:

- `16` expected pass
- `184` expected fail
- `56` trimming-fixable failures

Run:

```bash
npm run eval:labeled
```

The default command requires at least `100` cases and `20` fixable cases.

## Custom messy prose eval

Create a folder outside `.eval/`, for example:

```text
eval/prose/
  case001.txt
  case002.txt
  labels.json
```

`labels.json` format:

```json
[
  {
    "file": "case001.txt",
    "expected": "fail",
    "expected_codes": ["BANNED_PREAMBLE", "MISSING_DIRECT_ANSWER"],
    "fixable": true,
    "category": "agent status update",
    "source": "real agent output"
  },
  {
    "file": "case002.txt",
    "expected": "pass",
    "category": "direct answer",
    "source": "real assistant output"
  }
]
```

Run:

```bash
npm run eval:labeled -- --labels path/to/labels.json --out .eval/custom-report.json --min-cases 100 --min-fixable 20
```

The command exits nonzero if any expected pass/fail label is missed. If `fixable` is `true`, rewrite must also pass.

## ScrapeGraphAI structured-output eval

Pull 100 rows:

```bash
python -c "import requests, pathlib; r=requests.get('https://datasets-server.huggingface.co/rows', params={'dataset':'scrapegraphai/scrapegraphai-100k','config':'default','split':'train','offset':0,'length':100}, timeout=60); pathlib.Path('rows.json').write_text(r.text, encoding='utf-8')"
```

Run:

```bash
npm run eval:scrapegraphai
```

This is a form eval for structured LLM output. It labels responses with `response.length <= 320` as expected pass and longer responses as expected fail. `response_is_valid` is schema correctness, not laconic form.
