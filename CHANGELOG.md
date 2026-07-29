# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added

- structural AI-pattern detection, quality scoring, preservation metrics, and blind prose comparison benchmark

### Changed

- benchmark proof now reports measured reduction without gating on a vanity reduction percentage

## [0.1.2] - 2026-05-22

### Added

- optional local style memory via LanceDB adapter and deterministic hash embeddings
- Claude Code plugin manifest and human-facing `EXAMPLES.md`

### Changed

- fixed pipeline pass-path behavior so compliant outputs are not rewritten to empty
- tightened CLI error semantics and input validation (`--limit` requires positive integer)
- made memory writes idempotent by record id and deduplicated search results
- added release hardening checks (`prepack`, `npm pack --dry-run` in CI)
- aligned project version metadata to `0.1.2`

## [0.1.1] - 2026-05-22

### Changed

- switched license stack to `Apache-2.0` with `NOTICE` attribution
- added `INTENTION.md` and updated licensing text in docs/skill metadata
- expanded release docs and deterministic receipt positioning

## [0.1.0] - 2026-05-21

### Added

- deterministic laconic verifier, rewrite path, CLI, fixtures, tests, and benchmark corpus
- receipt generation and deterministic hash checks
- no-op correctness substrate interface and deterministic pipeline flow
