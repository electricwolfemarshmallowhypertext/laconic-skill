import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

interface LabelCase {
  file: string;
  expected: "pass" | "fail";
  expected_codes?: string[];
  fixable?: boolean;
  category?: string;
  source?: string;
  notes?: string;
}

interface LabeledResult extends LabelCase {
  actual: "pass" | "fail";
  actual_codes: string[];
  check_miss: boolean;
  rewrite_actual?: "pass" | "fail";
  rewrite_codes?: string[];
  rewrite_miss?: boolean;
  exit_status: number | null;
  spawn_error: string | null;
  stderr: string;
}

const DEFAULT_MAX_MISSES = 0;
const DEFAULT_MIN_CASES = 100;
const DEFAULT_MIN_FIXABLE = 20;

function parseArgs(argv: string[]): {
  labelsPath: string;
  outPath: string;
  maxMisses: number;
  minCases: number;
  minFixable: number;
} {
  let labelsPath = "eval/prose/labels.json";
  let outPath = ".eval/labeled-prose-report.json";
  let maxMisses = DEFAULT_MAX_MISSES;
  let minCases = DEFAULT_MIN_CASES;
  let minFixable = DEFAULT_MIN_FIXABLE;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--labels") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --labels.");
      }
      labelsPath = value;
      index += 1;
      continue;
    }
    if (token === "--out") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --out.");
      }
      outPath = value;
      index += 1;
      continue;
    }
    if (token === "--max-misses") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error("--max-misses must be a non-negative integer.");
      }
      maxMisses = value;
      index += 1;
      continue;
    }
    if (token === "--min-cases") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error("--min-cases must be a non-negative integer.");
      }
      minCases = value;
      index += 1;
      continue;
    }
    if (token === "--min-fixable") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error("--min-fixable must be a non-negative integer.");
      }
      minFixable = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${token}`);
  }

  return { labelsPath, outPath, maxMisses, minCases, minFixable };
}

function loadLabels(labelsPath: string): LabelCase[] {
  const parsed = JSON.parse(readFileSync(labelsPath, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Labels file must be a JSON array.");
  }
  return parsed.map((item, index) => {
    const candidate = item as Partial<LabelCase>;
    if (!candidate.file || typeof candidate.file !== "string") {
      throw new Error(`Label ${index} missing file.`);
    }
    if (candidate.expected !== "pass" && candidate.expected !== "fail") {
      throw new Error(`Label ${index} must use expected pass|fail.`);
    }
    if (
      candidate.expected_codes !== undefined &&
      !Array.isArray(candidate.expected_codes)
    ) {
      throw new Error(`Label ${index} expected_codes must be an array.`);
    }
    return {
      file: candidate.file,
      expected: candidate.expected,
      expected_codes: candidate.expected_codes?.map(String),
      fixable: candidate.fixable,
      category: candidate.category,
      source: candidate.source,
      notes: candidate.notes
    };
  });
}

function runCli(args: string[]): {
  actual: "pass" | "fail";
  codes: string[];
  status: number | null;
  spawnError: string | null;
  stderr: string;
} {
  const run = spawnSync(process.execPath, [resolve("dist", "cli.js"), ...args], {
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

function sameCodes(actual: string[], expected: string[] | undefined): boolean {
  if (!expected) {
    return true;
  }
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function categorySummary(results: LabeledResult[]): Array<{
  category: string;
  total: number;
  misses: number;
}> {
  const counts = new Map<string, { total: number; misses: number }>();
  for (const result of results) {
    const category = result.category ?? "uncategorized";
    const current = counts.get(category) ?? { total: 0, misses: 0 };
    current.total += 1;
    if (result.check_miss || result.rewrite_miss) {
      current.misses += 1;
    }
    counts.set(category, current);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([category, value]) => ({ category, ...value }));
}

function main(): void {
  const { labelsPath, outPath, maxMisses, minCases, minFixable } = parseArgs(
    process.argv.slice(2)
  );
  const resolvedLabelsPath = resolve(labelsPath);
  const resolvedOutPath = resolve(outPath);

  if (!existsSync(resolvedLabelsPath)) {
    throw new Error(`Labels file not found: ${labelsPath}`);
  }
  if (!existsSync(resolve("dist", "cli.js"))) {
    throw new Error("dist/cli.js not found. Run npm run build first.");
  }

  const labels = loadLabels(resolvedLabelsPath);
  const labelRoot = dirname(resolvedLabelsPath);
  const results: LabeledResult[] = labels.map((label) => {
    const filePath = resolve(labelRoot, label.file);
    const checked = runCli(["check", filePath, "--receipt"]);
    const checkMiss =
      checked.actual !== label.expected || !sameCodes(checked.codes, label.expected_codes);

    const result: LabeledResult = {
      ...label,
      actual: checked.actual,
      actual_codes: checked.codes,
      check_miss: checkMiss,
      exit_status: checked.status,
      spawn_error: checked.spawnError,
      stderr: checked.stderr
    };

    if (label.expected === "fail" && label.fixable === true) {
      const rewritten = runCli(["rewrite", filePath, "--receipt"]);
      result.rewrite_actual = rewritten.actual;
      result.rewrite_codes = rewritten.codes;
      result.rewrite_miss = rewritten.actual !== "pass";
    }

    return result;
  });

  const totalMisses = results.filter(
    (result) => result.check_miss || result.rewrite_miss
  ).length;
  const fixableTotal = results.filter(
    (result) => result.expected === "fail" && result.fixable === true
  ).length;
  const gateFailures: string[] = [];
  if (results.length < minCases) {
    gateFailures.push(`total cases ${results.length} below minimum ${minCases}`);
  }
  if (fixableTotal < minFixable) {
    gateFailures.push(`fixable cases ${fixableTotal} below minimum ${minFixable}`);
  }
  if (totalMisses > maxMisses) {
    gateFailures.push(`misses ${totalMisses} above maximum ${maxMisses}`);
  }

  const summary = {
    labels: resolvedLabelsPath,
    label_policy: "pre-labeled before run; expected pass/fail is authoritative",
    total: results.length,
    expected_pass: results.filter((result) => result.expected === "pass").length,
    expected_fail: results.filter((result) => result.expected === "fail").length,
    fixable_total: fixableTotal,
    misses: totalMisses,
    false_fails: results.filter(
      (result) => result.expected === "pass" && result.actual === "fail"
    ).length,
    false_passes: results.filter(
      (result) => result.expected === "fail" && result.actual === "pass"
    ).length,
    rewrite_failures: results.filter((result) => result.rewrite_miss).length,
    max_misses: maxMisses,
    min_cases: minCases,
    min_fixable: minFixable,
    gate_failures: gateFailures,
    ok: gateFailures.length === 0,
    categories: categorySummary(results),
    results
  };

  mkdirSync(dirname(resolvedOutPath), { recursive: true });
  writeFileSync(resolvedOutPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ...summary, results: undefined }, null, 2)}\n`);

  if (!summary.ok) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
