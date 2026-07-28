# Public assistant prose eval source

This corpus contains 120 assistant-output examples sampled from the public Hugging Face dataset `tatsu-lab/alpaca`, train split.

Labels were generated before running `laconic check` using an independent form rubric matching the documented default laconic policy: max characters, max bullets, caveat count, banned preamble opening, and direct-answer opening.

`fixable: true` means the case failed only the max-character rule, so deterministic trimming is expected to fix it without inventing facts.

This is an external public assistant-prose eval, not a correctness or truth benchmark.
