import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

interface DatasetRowEnvelope {
  rows: Array<{
    row_idx: number;
    row: {
      response?: unknown;
      response_is_valid?: unknown;
      id?: unknown;
    };
  }>;
}

interface EvalLabel {
  file: string;
  expected: "pass" | "fail";
  reason: string;
  source_row_idx: number;
  source_id: unknown;
  response_is_valid: boolean | null;
  response_chars: number;
}

interface EvalResult extends EvalLabel {
  actual: "pass" | "fail";
  miss: boolean;
  codes: string[];
  exit_status: number | null;
  spawn_error: string | null;
  stderr: string;
}

const DEFAULT_INPUT = "rows.json";
const DEFAULT_OUT_DIR = ".eval/scrapegraphai-form";
const MAX_CHARS = 320;

const distRoot = resolve(__dirname, "..");
const confidencePath = join(distRoot, "correctness", "confidence.js");
const { analyzeCorrectnessConfidence } = require(confidencePath) as {
  analyzeCorrectnessConfidence: (
    cases: Array<{
      id: string;
      score: number;
      passed: boolean;
      stratum: string;
      metadata: Record<string, unknown>;
    }>,
    config: Record<string, unknown>
  ) => unknown;
};

function parseArgs(argv: string[]): { input: string; outDir: string } {
  let input = DEFAULT_INPUT;
  let outDir = DEFAULT_OUT_DIR;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --input.");
      }
      input = value;
      index += 1;
      continue;
    }
    if (token === "--out") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --out.");
      }
      outDir = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${token}`);
  }

  return { input, outDir };
}

function readDatasetRows(inputPath: string): DatasetRowEnvelope["rows"] {
  const parsed = JSON.parse(readFileSync(inputPath, "utf8")) as DatasetRowEnvelope;
  if (!Array.isArray(parsed.rows)) {
    throw new Error("Input JSON must contain a rows array from Hugging Face datasets-server.");
  }
  return parsed.rows;
}

function expectedForResponse(response: string): Pick<EvalLabel, "expected" | "reason"> {
  if (response.length > MAX_CHARS) {
    return { expected: "fail", reason: "too_long" };
  }
  return { expected: "pass", reason: "structured_output_within_max_chars" };
}

function freezeCases(rows: DatasetRowEnvelope["rows"], outDir: string): EvalLabel[] {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const labels: EvalLabel[] = rows.map((item, index) => {
    const response = String(item.row.response ?? "");
    const file = `case${String(index + 1).padStart(3, "0")}.txt`;
    const expected = expectedForResponse(response);
    writeFileSync(join(outDir, file), response, "utf8");
    return {
      file,
      expected: expected.expected,
      reason: expected.reason,
      source_row_idx: item.row_idx,
      source_id: item.row.id ?? null,
      response_is_valid:
        typeof item.row.response_is_valid === "boolean"
          ? item.row.response_is_valid
          : null,
      response_chars: response.length
    };
  });

  writeFileSync(join(outDir, "labels.json"), `${JSON.stringify(labels, null, 2)}\n`, "utf8");
  return labels;
}

function runCheck(filePath: string): {
  actual: "pass" | "fail";
  codes: string[];
  status: number | null;
  spawnError: string | null;
  stderr: string;
} {
  const cliPath = resolve("dist", "cli.js");
  const run = spawnSync(process.execPath, [cliPath, "check", filePath, "--receipt"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });

  let actual: "pass" | "fail" = "fail";
  let codes: string[] = [];
  try {
    const payload = JSON.parse(String(run.stdout ?? "")) as {
      ok?: boolean;
      violations?: Array<{ code?: string }>;
    };
    actual = payload.ok ? "pass" : "fail";
    codes = Array.isArray(payload.violations)
      ? payload.violations.map((violation) => String(violation.code))
      : [];
  } catch {
    actual = "fail";
  }

  return {
    actual,
    codes,
    status: run.status,
    spawnError: run.error instanceof Error ? run.error.message : null,
    stderr: String(run.stderr ?? "").trim()
  };
}

function runEval(labels: EvalLabel[], outDir: string): EvalResult[] {
  return labels.map((label) => {
    const checked = runCheck(join(outDir, label.file));
    return {
      ...label,
      actual: checked.actual,
      miss: checked.actual !== label.expected,
      codes: checked.codes,
      exit_status: checked.status,
      spawn_error: checked.spawnError,
      stderr: checked.stderr
    };
  });
}

function writeCorrectnessConfidence(
  rows: DatasetRowEnvelope["rows"],
  outDir: string
): unknown {
  const cases = rows
    .filter((item) => typeof item.row.response_is_valid === "boolean")
    .map((item) => ({
      id: String(item.row.id ?? item.row_idx),
      score: item.row.response_is_valid === true ? 1 : 0,
      passed: item.row.response_is_valid === true,
      stratum: "schema_validity",
      metadata: {
        source_row_idx: item.row_idx,
        response_chars: String(item.row.response ?? "").length
      }
    }));

  const config = {
    metric_name: "scrapegraphai_response_schema_validity",
    lower_spec_limit: 0.95,
    confidence_level: 0.95,
    bootstrap_runs: 1000,
    deterministic_seed: 20260728,
    strata_field: "stratum",
    capability_thresholds: {
      capable: 1,
      marginal: 0.67
    }
  };

  const jsonl = cases.map((item) => JSON.stringify(item)).join("\n");
  writeFileSync(join(outDir, "correctness-results.jsonl"), `${jsonl}\n`, "utf8");
  writeFileSync(
    join(outDir, "correctness-config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8"
  );

  const report = analyzeCorrectnessConfidence(cases, config) as unknown;
  writeFileSync(
    join(outDir, "correctness-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  return report;
}

function main(): void {
  const { input, outDir } = parseArgs(process.argv.slice(2));
  const inputPath = resolve(input);
  const outputPath = resolve(outDir);

  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${input}`);
  }
  if (!existsSync(resolve("dist", "cli.js"))) {
    throw new Error("dist/cli.js not found. Run npm run build first.");
  }

  const rows = readDatasetRows(inputPath);
  const labels = freezeCases(rows, outputPath);
  const results = runEval(labels, outputPath);
  const correctnessConfidence = writeCorrectnessConfidence(rows, outputPath);
  const summary = {
    dataset: "scrapegraphai/scrapegraphai-100k",
    input: inputPath,
    out_dir: outputPath,
    label_policy: "form-only: response length <= 320 passes; longer responses fail; schema validity is not a laconic-form rule",
    total: results.length,
    expected_pass: results.filter((result) => result.expected === "pass").length,
    expected_fail: results.filter((result) => result.expected === "fail").length,
    misses: results.filter((result) => result.miss).length,
    false_fails: results.filter(
      (result) => result.expected === "pass" && result.actual === "fail"
    ).length,
    false_passes: results.filter(
      (result) => result.expected === "fail" && result.actual === "pass"
    ).length,
    correctness_confidence: correctnessConfidence,
    results
  };

  writeFileSync(
    join(outputPath, "actual-results.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write(`${JSON.stringify({ ...summary, results: undefined }, null, 2)}\n`);

  if (summary.misses > 0) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
