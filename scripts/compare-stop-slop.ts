import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

type VerifyText = (text: string) => {
  ok: boolean;
  violations: Array<{ code: string; evidence?: string }>;
  metrics: {
    charCount: number;
    bulletCount: number;
    caveatCount: number;
    structuralPatternCount: number;
    qualityScore: number;
  };
};

const distRoot = resolve(__dirname, "..");
const { verifyText } = require(join(distRoot, "verifier.js")) as {
  verifyText: VerifyText;
};

const BLIND_PROSE_DIR = resolve(process.cwd(), "benchmarks", "blind-prose");

const STOP_SLOP_PATTERNS: Array<{ category: string; pattern: RegExp }> = [
  { category: "throat_clearing", pattern: /\bhere['\u2019]?s (?:the thing|why|what)\b/i },
  { category: "throat_clearing", pattern: /\b(?:let me be clear|let me explain|to be clear)\b/i },
  { category: "emphasis_crutch", pattern: /\b(?:make no mistake|let that sink in|full stop|period)\b/i },
  { category: "business_jargon", pattern: /\b(?:deep dive|lean into|circle back|moving forward|on the same page|take a step back)\b/i },
  { category: "meta_commentary", pattern: /\b(?:plot twist|spoiler:|hint:|let me walk you through|the rest of this|as we['\u2019]?ll see)\b/i },
  { category: "binary_contrast", pattern: /\b(?:not because\b[\s\S]{0,120}\bbecause\b|isn['\u2019]?t the problem\b[\s\S]{0,120}\bis\b|not just\b[\s\S]{0,120}\bbut also\b)/i },
  { category: "rhetorical_setup", pattern: /\b(?:what if i told you|here['\u2019]?s what i mean|think about it|and that['\u2019]?s okay)\b/i },
  { category: "dramatic_fragmentation", pattern: /\b(?:that['\u2019]?s it|that['\u2019]?s the [a-z]+|and [a-z]+\. and [a-z]+)\b/i },
  { category: "passive_voice", pattern: /\b(?:was|were|is|are|be|been|being)\s+[a-z]+ed\b/i },
  { category: "wh_sentence_starter", pattern: /(?:^|[.!?]\s+)(?:What|When|Where|Which|Who|Why|How)\b/ },
  { category: "em_dash", pattern: /\u2014/ },
  { category: "lazy_extreme", pattern: /\b(?:always|never|everyone|everybody|nobody)\b/i },
  { category: "adverb_crutch", pattern: /\b(?:really|just|literally|genuinely|honestly|simply|actually|deeply|truly|fundamentally|inherently|inevitably|interestingly|importantly|crucially)\b/i }
];

function compareCodepointStable(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  const leftChars = [...left];
  const rightChars = [...right];
  const length = Math.min(leftChars.length, rightChars.length);
  for (let index = 0; index < length; index += 1) {
    const diff = leftChars[index].codePointAt(0)! - rightChars[index].codePointAt(0)!;
    if (diff !== 0) {
      return diff;
    }
  }
  return leftChars.length - rightChars.length;
}

function scanStopSlop(text: string): {
  flagged: boolean;
  categories: string[];
  score: number;
} {
  const categories = [
    ...new Set(
      STOP_SLOP_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
        ({ category }) => category
      )
    )
  ].sort(compareCodepointStable);
  return {
    flagged: categories.length > 0,
    categories,
    score: Math.max(0, 100 - categories.length * 8)
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

function run(): void {
  const files = readdirSync(BLIND_PROSE_DIR)
    .filter((entry) => entry.endsWith(".txt"))
    .sort(compareCodepointStable);
  if (files.length === 0) {
    throw new Error("No blind prose files found.");
  }

  const rows = files.map((file) => {
    const text = readFileSync(join(BLIND_PROSE_DIR, file), "utf8");
    const laconic = verifyText(text);
    const stopSlop = scanStopSlop(text);
    return {
      file,
      input_chars: text.length,
      laconic_ok: laconic.ok,
      laconic_quality_score: laconic.metrics.qualityScore,
      laconic_violations: laconic.violations.map((violation) =>
        violation.evidence ? `${violation.code}:${violation.evidence}` : violation.code
      ),
      stop_slop_flagged: stopSlop.flagged,
      stop_slop_score: stopSlop.score,
      stop_slop_categories: stopSlop.categories
    };
  });

  const laconicFlagged = rows.filter((row) => !row.laconic_ok).length;
  const stopSlopFlagged = rows.filter((row) => row.stop_slop_flagged).length;
  const overlap = rows.filter((row) => !row.laconic_ok && row.stop_slop_flagged).length;
  const output = {
    corpus: "benchmarks/blind-prose",
    corpus_size: rows.length,
    note:
      "Stop Slop is a skill/spec, not a runtime; stop_slop_* values come from a deterministic scanner over its published pattern categories.",
    laconic: {
      flagged: laconicFlagged,
      pass: rows.length - laconicFlagged,
      avg_quality_score: average(rows.map((row) => row.laconic_quality_score))
    },
    stop_slop_pattern_scan: {
      flagged: stopSlopFlagged,
      pass: rows.length - stopSlopFlagged,
      avg_score: average(rows.map((row) => row.stop_slop_score))
    },
    overlap: {
      both_flagged: overlap,
      laconic_only: laconicFlagged - overlap,
      stop_slop_only: stopSlopFlagged - overlap
    },
    rows
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

run();
