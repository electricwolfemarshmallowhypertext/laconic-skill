# Provenance

## Current release baseline

- npm version: 0.1.4
- git tag: v0.1.4
- commit: 67b8cd6bc8befbf2d2eb223ded41e31ced52fa22
- status: this document may include uncommitted hardening changes until the next commit/tag.

## Benchmark proof

- benchmark result date: 2026-07-01
- command: `npm run benchmark`
- corpus: `benchmarks/corpus/*.txt`
- compliant controls: `benchmarks/compliant/*.txt`
- holdout set: `benchmarks/holdout/*.txt`, reported separately from proof numbers

## Release proof summary

- 50 main corpus files
- 63.477% average character reduction in the v0.1.4 proof run
- 50/50 fixable outputs passed after rewrite in the v0.1.4 proof run
- 0 compliant false fails in the v0.1.4 proof run
- deterministic across 5 runs
- no model calls during verification

## Package boundary

The benchmark corpus is repo/tag-backed proof material. It is not necessarily included in the npm tarball. Use the git tag when auditing benchmark files and the npm package when auditing install/runtime behavior.