# Provenance

## Current release baseline

- npm version: 0.1.4
- git tag: v0.1.4
- commit: 67b8cd6bc8befbf2d2eb223ded41e31ced52fa22
- status: includes unreleased hardening changes after v0.1.4; commit hash updates with the next release tag.

## Benchmark proof

- benchmark result date: 2026-07-29
- command: `npm run benchmark`
- corpus: `benchmarks/corpus/*.txt`
- compliant controls: `benchmarks/compliant/*.txt`
- holdout set: `benchmarks/holdout/*.txt`, reported separately from proof numbers

## Release proof summary

- 50 main corpus files
- 48.028% average character reduction in the unreleased hardening proof run
- 50/50 fixable outputs passed after rewrite in the unreleased hardening proof run
- 0 compliant false fails in the unreleased hardening proof run
- deterministic across 5 runs
- no model calls during verification

## Package boundary

The benchmark corpus is repo/tag-backed proof material. It is not necessarily included in the npm tarball. Use the git tag when auditing benchmark files and the npm package when auditing install/runtime behavior.
