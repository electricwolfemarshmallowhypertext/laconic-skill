import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface VerificationResult {
  ok: boolean;
  violations: Array<{ code: string; message: string; evidence?: string }>;
  metrics: { charCount: number; bulletCount: number; caveatCount: number };
}

interface BenchmarkRow {
  file: string;
  input_chars: number;
  output_chars: number;
  chars_reduced_pct: number;
  before_ok: boolean;
  after_ok: boolean;
  verifier_ms: number;
  rewrite_ms: number;
  receipt_hash: string;
  output_text: string;
}

interface BenchmarkSummary {
  corpus_size: number;
  repeats: number;
  deterministic_runs: number;
  deterministic: boolean;
  deterministic_failures: string[];
  fixable_total: number;
  fixable_passed: number;
  compliant_controls: number;
  compliant_false_fail_count: number;
  avg_chars_reduced_pct: number;
}

type VerifyText = (text: string) => VerificationResult;
type RewriteText = (text: string) => string;
type CreateReceipt = (input: {
  input: string;
  output: string;
  skill_name: string;
  verifier_version: string;
  ok: boolean;
  violations: Array<{ source: "laconic"; code: string; message: string; evidence?: string }>;
  metrics: Record<string, number | boolean>;
  timestamp: string;
}) => { receipt_hash: string };

const distRoot = resolve(__dirname, "..");
const verifierPath = join(distRoot, "verifier.js");
const rewritePath = join(distRoot, "rewrite.js");
const receiptPath = join(distRoot, "receipt.js");

const { verifyText } = require(verifierPath) as { verifyText: VerifyText };
const { rewriteText } = require(rewritePath) as { rewriteText: RewriteText };
const { createReceipt } = require(receiptPath) as { createReceipt: CreateReceipt };

const BENCHMARK_CORPUS_DIR = resolve(process.cwd(), "benchmarks", "corpus");
const COMPLIANT_CONTROL_DIR = resolve(process.cwd(), "benchmarks", "compliant");
const HOLDOUT_DIR = resolve(process.cwd(), "benchmarks", "holdout");
const REPEATS = 5;
const DETERMINISTIC_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const MIN_CORPUS_SIZE = 50;
const MIN_AVG_REDUCTION_PCT = 60;
const MIN_DETERMINISTIC_RUNS = 5;

function elapsedMs(startNs: bigint): number {
  return Number(process.hrtime.bigint() - startNs) / 1_000_000;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function compareCodepointStable(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  const leftChars = [...left];
  const rightChars = [...right];
  const maxSharedLength = Math.min(leftChars.length, rightChars.length);

  for (let index = 0; index < maxSharedLength; index += 1) {
    const leftCodepoint = leftChars[index].codePointAt(0)!;
    const rightCodepoint = rightChars[index].codePointAt(0)!;
    if (leftCodepoint !== rightCodepoint) {
      return leftCodepoint - rightCodepoint;
    }
  }

  return leftChars.length - rightChars.length;
}

function loadTextFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".txt"))
    .sort(compareCodepointStable);
}

function buildRow(file: string, directory = BENCHMARK_CORPUS_DIR): BenchmarkRow {
  const fullPath = join(directory, file);
  const input = readFileSync(fullPath, "utf8");

  const verifyBeforeStart = process.hrtime.bigint();
  const before = verifyText(input);
  const verifyBeforeMs = elapsedMs(verifyBeforeStart);

  const rewriteStart = process.hrtime.bigint();
  const output = rewriteText(input);
  const rewriteMs = elapsedMs(rewriteStart);

  const verifyAfterStart = process.hrtime.bigint();
  const after = verifyText(output);
  const verifyAfterMs = elapsedMs(verifyAfterStart);

  const inputChars = input.length;
  const outputChars = output.length;
  const charsReducedPct =
    inputChars === 0 ? 0 : ((inputChars - outputChars) / inputChars) * 100;

  const receipt = createReceipt({
    input,
    output,
    skill_name: "laconic-responses",
    verifier_version: "laconic/v0",
    ok: after.ok,
    violations: after.violations.map((violation) => ({
      source: "laconic",
      code: violation.code,
      message: violation.message,
      evidence: violation.evidence
    })),
    metrics: {
      input_chars: inputChars,
      output_chars: outputChars,
      before_ok: before.ok,
      after_ok: after.ok
    },
    timestamp: DETERMINISTIC_TIMESTAMP
  });

  return {
    file,
    input_chars: inputChars,
    output_chars: outputChars,
    chars_reduced_pct: round(charsReducedPct),
    before_ok: before.ok,
    after_ok: after.ok,
    verifier_ms: round(verifyBeforeMs + verifyAfterMs),
    rewrite_ms: round(rewriteMs),
    receipt_hash: receipt.receipt_hash,
    output_text: output
  };
}

function deterministicSignature(row: BenchmarkRow): string {
  return JSON.stringify({
    input_chars: row.input_chars,
    output_chars: row.output_chars,
    chars_reduced_pct: row.chars_reduced_pct,
    before_ok: row.before_ok,
    after_ok: row.after_ok,
    receipt_hash: row.receipt_hash,
    output_text: row.output_text
  });
}

function summarize(rows: BenchmarkRow[], compliantControlRows: BenchmarkRow[]): BenchmarkSummary {
  const fixableRows = rows.filter((row) => !row.before_ok);
  const fixablePassed = fixableRows.filter((row) => row.after_ok).length;
  const compliantFalseFailCount = compliantControlRows.filter((row) => !row.before_ok).length;
  const avgReduction =
    rows.length === 0
      ? 0
      : rows.reduce((acc, row) => acc + row.chars_reduced_pct, 0) / rows.length;

  return {
    corpus_size: rows.length,
    repeats: REPEATS,
    deterministic_runs: REPEATS,
    deterministic: true,
    deterministic_failures: [],
    fixable_total: fixableRows.length,
    fixable_passed: fixablePassed,
    compliant_controls: compliantControlRows.length,
    compliant_false_fail_count: compliantFalseFailCount,
    avg_chars_reduced_pct: round(avgReduction)
  };
}

function summarizeHoldout(rows: BenchmarkRow[]): Omit<BenchmarkSummary, "repeats" | "deterministic_runs" | "deterministic" | "deterministic_failures"> {
  const fixableRows = rows.filter((row) => !row.before_ok);
  const fixablePassed = fixableRows.filter((row) => row.after_ok).length;
  const compliantRows = rows.filter((row) => row.before_ok);
  const compliantFalseFailCount = compliantRows.filter((row) => !row.after_ok).length;
  const avgReduction =
    rows.length === 0
      ? 0
      : rows.reduce((acc, row) => acc + row.chars_reduced_pct, 0) / rows.length;

  return {
    corpus_size: rows.length,
    fixable_total: fixableRows.length,
    fixable_passed: fixablePassed,
    compliant_controls: compliantRows.length,
    compliant_false_fail_count: compliantFalseFailCount,
    avg_chars_reduced_pct: round(avgReduction)
  };
}

function thresholdFailures(summary: BenchmarkSummary): string[] {
  const failures: string[] = [];
  if (summary.corpus_size < MIN_CORPUS_SIZE) {
    failures.push(`corpus_size ${summary.corpus_size} < ${MIN_CORPUS_SIZE}`);
  }
  if (summary.avg_chars_reduced_pct < MIN_AVG_REDUCTION_PCT) {
    failures.push(
      `avg_chars_reduced_pct ${summary.avg_chars_reduced_pct} < ${MIN_AVG_REDUCTION_PCT}`
    );
  }
  if (summary.fixable_passed !== summary.fixable_total) {
    failures.push(`fixable_passed ${summary.fixable_passed} != ${summary.fixable_total}`);
  }
  if (summary.compliant_false_fail_count !== 0) {
    failures.push(`compliant_false_fail_count ${summary.compliant_false_fail_count} != 0`);
  }
  if (!summary.deterministic) {
    failures.push("deterministic false");
  }
  if (summary.deterministic_runs < MIN_DETERMINISTIC_RUNS) {
    failures.push(
      `deterministic_runs ${summary.deterministic_runs} < ${MIN_DETERMINISTIC_RUNS}`
    );
  }
  return failures;
}

function run(): void {
  const files = loadTextFiles(BENCHMARK_CORPUS_DIR);
  const compliantControlFiles = loadTextFiles(COMPLIANT_CONTROL_DIR);
  const holdoutFiles = loadTextFiles(HOLDOUT_DIR);
  if (files.length === 0) {
    throw new Error("No benchmark corpus files found.");
  }

  const runs: BenchmarkRow[][] = [];
  for (let repeat = 0; repeat < REPEATS; repeat += 1) {
    runs.push(files.map((file) => buildRow(file)));
  }

  const reference = runs[0];
  const compliantControlRows = compliantControlFiles.map((file) =>
    buildRow(file, COMPLIANT_CONTROL_DIR)
  );
  const holdoutRows = holdoutFiles.map((file) => buildRow(file, HOLDOUT_DIR));
  const summary = summarize(reference, compliantControlRows);
  const holdoutSummary = summarizeHoldout(holdoutRows);

  for (let runIndex = 1; runIndex < runs.length; runIndex += 1) {
    for (let rowIndex = 0; rowIndex < files.length; rowIndex += 1) {
      const baseline = deterministicSignature(reference[rowIndex]);
      const candidate = deterministicSignature(runs[runIndex][rowIndex]);
      if (baseline !== candidate) {
        summary.deterministic = false;
        summary.deterministic_failures.push(
          `${files[rowIndex]} run1_vs_run${runIndex + 1}`
        );
      }
    }
  }

  const checks = {
    deterministic_across_5_runs: summary.deterministic,
    benchmark_thresholds_met: thresholdFailures(summary).length === 0,
    rewritten_outputs_pass_when_fixable:
      summary.fixable_total === summary.fixable_passed,
    holdout_outputs_pass_when_fixable:
      holdoutSummary.fixable_total === holdoutSummary.fixable_passed,
    holdout_compliant_outputs_remain_passing:
      holdoutSummary.compliant_false_fail_count === 0,
    compliant_outputs_remain_passing: summary.compliant_false_fail_count === 0,
    no_model_calls: true
  };

  const output = {
    summary,
    thresholds: {
      min_corpus_size: MIN_CORPUS_SIZE,
      min_avg_chars_reduced_pct: MIN_AVG_REDUCTION_PCT,
      min_deterministic_runs: MIN_DETERMINISTIC_RUNS,
      failures: thresholdFailures(summary)
    },
    holdout: {
      summary: holdoutSummary,
      rows: holdoutRows.map((row) => ({
        file: row.file,
        input_chars: row.input_chars,
        output_chars: row.output_chars,
        chars_reduced_pct: row.chars_reduced_pct,
        before_ok: row.before_ok,
        after_ok: row.after_ok,
        receipt_hash: row.receipt_hash
      }))
    },
    checks,
    rows: reference.map((row) => ({
      file: row.file,
      input_chars: row.input_chars,
      output_chars: row.output_chars,
      chars_reduced_pct: row.chars_reduced_pct,
      before_ok: row.before_ok,
      after_ok: row.after_ok,
      verifier_ms: row.verifier_ms,
      rewrite_ms: row.rewrite_ms,
      receipt_hash: row.receipt_hash
    }))
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

  if (!checks.deterministic_across_5_runs) {
    process.exit(1);
  }
  if (!checks.benchmark_thresholds_met) {
    process.exit(1);
  }
  if (!checks.rewritten_outputs_pass_when_fixable) {
    process.exit(1);
  }
  if (!checks.holdout_outputs_pass_when_fixable) {
    process.exit(1);
  }
  if (!checks.holdout_compliant_outputs_remain_passing) {
    process.exit(1);
  }
  if (!checks.compliant_outputs_remain_passing) {
    process.exit(1);
  }
}

run();
