# Public assistant prose eval source

This corpus contains 200 assistant-message examples sampled from the public Hugging Face dataset `HuggingFaceH4/ultrachat_200k`, `default` config, `train_sft` split.

Dataset license metadata reported by Hugging Face: `mit`.

Labels were generated before running `laconic check` using an independent form rubric matching the documented default laconic policy: max characters, max bullets, caveat count, banned preamble opening, banned filler opening, and direct-answer opening.

`fixable: true` means the case failed only the max-character rule, so deterministic trimming is expected to fix it without inventing facts.

This is an external public assistant-prose form eval, not a correctness or truth benchmark.
