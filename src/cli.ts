#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifyText } from "./verifier";
import { rewriteText } from "./rewrite";
import {
  PIPELINE_VERIFIER_VERSION,
  LACONIC_VERIFIER_VERSION,
  runPipeline
} from "./pipeline";
import { createReceipt, type JsonValue, type ReceiptViolation } from "./receipt";
import { type CorrectnessTaskType } from "./correctness";
import {
  CORRECTNESS_CONFIDENCE_VERSION,
  analyzeCorrectnessConfidence,
  loadCorrectnessCasesFile,
  loadCorrectnessConfigFile
} from "./correctness/confidence";
import { compareCodepointStable } from "./deterministic";
import { measurePreservation } from "./preservation";
import {
  createDefaultStyleMemoryAdapter,
  type StyleMemoryOutcome,
  type StyleMemorySearchResult
} from "./memory";

type CoreCommand = "check" | "rewrite" | "pipeline";
const SKILL_NAME = "laconic-responses";
const DETERMINISTIC_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const DEFAULT_MEMORY_LIMIT = 5;
const MAX_MEMORY_LIMIT = 100;

interface CoreOptions {
  receipt: boolean;
  task?: CorrectnessTaskType;
  memory: boolean;
}

interface MemoryAddOptions {
  outcome?: StyleMemoryOutcome;
  task?: CorrectnessTaskType;
}

interface MemorySearchOptions {
  limit: number;
}

interface CorrectnessConfidenceOptions {
  input?: string;
  config?: string;
  receipt: boolean;
}

function usage(message?: string): never {
  if (message) {
    process.stderr.write(`${message}\n`);
  }
  process.stderr.write(
    "Usage:\n" +
      "  laconic <check|rewrite|pipeline> <file|-> [--task writing|code|data|regulated] [--receipt] [--memory]\n" +
      "  laconic correctness --input <results.json|results.jsonl> --config <config.json> [--receipt]\n" +
      "  laconic memory add <file|-> --outcome accepted|rejected|rewritten --task writing|code|data|regulated\n" +
      "  laconic memory search <query> [--limit N]\n"
  );
  process.exit(1);
}

function readInputFile(filePath: string): string {
  try {
    if (filePath === "-") {
      return readFileSync(0, "utf8");
    }
    return readFileSync(resolve(process.cwd(), filePath), "utf8");
  } catch {
    throw new Error(`Failed to read input file: ${filePath}`);
  }
}

function isCoreCommand(value: string): value is CoreCommand {
  return value === "check" || value === "rewrite" || value === "pipeline";
}

function isTaskType(value: string): value is CorrectnessTaskType {
  return value === "writing" || value === "code" || value === "data" || value === "regulated";
}

function isOutcome(value: string): value is StyleMemoryOutcome {
  return value === "accepted" || value === "rejected" || value === "rewritten";
}

function parseCoreOptions(tokens: string[]): CoreOptions {
  const options: CoreOptions = { receipt: false, memory: false };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--receipt") {
      options.receipt = true;
      continue;
    }
    if (token === "--memory") {
      options.memory = true;
      continue;
    }
    if (token === "--task") {
      const task = tokens[index + 1];
      if (!task || !isTaskType(task)) {
        usage("Invalid or missing value for --task.");
      }
      options.task = task;
      index += 1;
      continue;
    }
    usage(`Unknown option: ${token}`);
  }
  return options;
}

function parseMemoryAddOptions(tokens: string[]): MemoryAddOptions {
  const options: MemoryAddOptions = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--outcome") {
      const outcome = tokens[index + 1];
      if (!outcome || !isOutcome(outcome)) {
        usage("Invalid or missing value for --outcome.");
      }
      options.outcome = outcome;
      index += 1;
      continue;
    }
    if (token === "--task") {
      const task = tokens[index + 1];
      if (!task || !isTaskType(task)) {
        usage("Invalid or missing value for --task.");
      }
      options.task = task;
      index += 1;
      continue;
    }
    usage(`Unknown option: ${token}`);
  }
  return options;
}

function parseMemorySearchOptions(tokens: string[]): MemorySearchOptions {
  let limit = DEFAULT_MEMORY_LIMIT;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--limit") {
      const rawLimit = tokens[index + 1];
      if (!rawLimit) {
        usage("Missing value for --limit.");
      }
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_MEMORY_LIMIT) {
        usage("Invalid --limit value.");
      }
      limit = parsed;
      index += 1;
      continue;
    }
    usage(`Unknown option: ${token}`);
  }
  return { limit };
}

function parseCorrectnessConfidenceOptions(tokens: string[]): CorrectnessConfidenceOptions {
  const options: CorrectnessConfidenceOptions = { receipt: false };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--receipt") {
      options.receipt = true;
      continue;
    }
    if (token === "--input") {
      const input = tokens[index + 1];
      if (!input) {
        usage("Missing value for --input.");
      }
      options.input = input;
      index += 1;
      continue;
    }
    if (token === "--config") {
      const config = tokens[index + 1];
      if (!config) {
        usage("Missing value for --config.");
      }
      options.config = config;
      index += 1;
      continue;
    }
    usage(`Unknown option: ${token}`);
  }
  if (!options.input) {
    usage("correctness requires --input.");
  }
  if (!options.config) {
    usage("correctness requires --config.");
  }
  return options;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([leftKey], [rightKey]) => compareCodepointStable(leftKey, rightKey)
    );
    const output: Record<string, unknown> = {};
    for (const [key, child] of entries) {
      output[key] = stableValue(child);
    }
    return output;
  }
  return value;
}

function writeStableJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(stableValue(value), null, 2)}\n`);
}

function toReceiptViolations(
  violations: Array<{ code: string; message: string; evidence?: string }>
): ReceiptViolation[] {
  return violations.map((violation) => ({
    source: "laconic",
    code: violation.code,
    message: violation.message,
    evidence: violation.evidence
  }));
}

function emitCheck(input: string, filePath: string, withReceipt: boolean): number {
  const result = verifyText(input);
  if (!withReceipt) {
    writeStableJson(result);
    return result.ok ? 0 : 1;
  }

  const receipt = createReceipt({
    input,
    output: input,
    skill_name: SKILL_NAME,
    verifier_version: LACONIC_VERIFIER_VERSION,
    ok: result.ok,
    violations: toReceiptViolations(result.violations),
    metrics: { ...result.metrics },
    timestamp: DETERMINISTIC_TIMESTAMP
  });

  writeStableJson({
    file: filePath,
    ok: result.ok,
    violations: result.violations,
    metrics: result.metrics,
    receipt
  });
  return result.ok ? 0 : 1;
}

function emitRewrite(input: string, filePath: string, withReceipt: boolean): number {
  const final = rewriteText(input);
  const result = verifyText(final);
  if (!withReceipt) {
    process.stdout.write(`${final}\n`);
    return result.ok ? 0 : 1;
  }

  const receipt = createReceipt({
    input,
    output: final,
    skill_name: SKILL_NAME,
    verifier_version: LACONIC_VERIFIER_VERSION,
    ok: result.ok,
    violations: toReceiptViolations(result.violations),
    metrics: {
      ...result.metrics,
      preservation: measurePreservation(input, final)
    },
    timestamp: DETERMINISTIC_TIMESTAMP
  });

  writeStableJson({
    file: filePath,
    final,
    ok: result.ok,
    violations: result.violations,
    metrics: result.metrics,
    receipt
  });
  return result.ok ? 0 : 1;
}

function buildStyleProfile(results: StyleMemorySearchResult[]): {
  sample_count: number;
  avg_output_chars: number;
  max_chars_hint: number | null;
} {
  if (results.length === 0) {
    return {
      sample_count: 0,
      avg_output_chars: 0,
      max_chars_hint: null
    };
  }

  const totalChars = results.reduce(
    (sum, result) => sum + result.record.output_text.length,
    0
  );
  const avg = Math.round(totalChars / results.length);
  return {
    sample_count: results.length,
    avg_output_chars: avg,
    max_chars_hint: Math.max(80, Math.round(avg * 1.25))
  };
}

function emitPipelineWithoutMemory(
  input: string,
  filePath: string,
  task: CorrectnessTaskType,
  withReceipt: boolean
): number {
  const result = runPipeline({
    input,
    draft: input,
    task_type: task,
    skill_name: SKILL_NAME,
    timestamp: DETERMINISTIC_TIMESTAMP
  });

  if (!withReceipt) {
    process.stdout.write(`${result.final}\n`);
    return result.ok ? 0 : 1;
  }

  writeStableJson({
    file: filePath,
    task,
    final: result.final,
    ok: result.ok,
    violations: result.receipt.violations,
    metrics: result.receipt.metrics,
    memory: { enabled: false },
    receipt: result.receipt
  });
  return result.ok ? 0 : 1;
}

async function emitPipelineWithMemory(
  input: string,
  filePath: string,
  task: CorrectnessTaskType,
  withReceipt: boolean
): Promise<number> {
  let memoryResults: StyleMemorySearchResult[] = [];
  let styleProfile = {
    sample_count: 0,
    avg_output_chars: 0,
    max_chars_hint: null as number | null
  };

  const adapter = createDefaultStyleMemoryAdapter();
  memoryResults = await adapter.search(input, {
    limit: DEFAULT_MEMORY_LIMIT,
    task_type: task,
    outcomes: ["accepted", "rewritten"]
  });
  const memoryStatus =
    typeof adapter.getStatus === "function" ? adapter.getStatus() : undefined;
  styleProfile = buildStyleProfile(memoryResults);

  const result = runPipeline({
    input,
    draft: input,
    task_type: task,
    style_memory: {
      hits_used: memoryResults.length,
      style_target_max_chars: styleProfile.max_chars_hint
    },
    skill_name: SKILL_NAME,
    timestamp: DETERMINISTIC_TIMESTAMP
  });

  if (!withReceipt) {
    process.stdout.write(`${result.final}\n`);
    return result.ok ? 0 : 1;
  }

  writeStableJson({
    file: filePath,
    task,
    final: result.final,
    ok: result.ok,
    violations: result.receipt.violations,
    metrics: result.receipt.metrics,
      memory: {
        enabled: true,
        hits_used: memoryResults.length,
        retrieved: memoryResults.length,
        backend: memoryStatus?.backend ?? "unknown",
        degraded: memoryStatus?.degraded ?? false,
        reason: memoryStatus?.reason ?? null,
        style_profile: styleProfile,
        examples: memoryResults.map((item) => ({
        id: item.record.id,
        task_type: item.record.task_type,
        outcome: item.record.outcome,
        output_text: item.record.output_text,
        receipt_hash: item.record.receipt_hash,
        score: Number(item.score.toFixed(8))
      }))
    },
    receipt: result.receipt
  });
  return result.ok ? 0 : 1;
}

async function emitMemoryAdd(
  filePath: string,
  options: MemoryAddOptions
): Promise<number> {
  if (!options.outcome) {
    usage("memory add requires --outcome accepted|rejected|rewritten.");
  }
  if (!options.task) {
    usage("memory add requires --task writing|code|data|regulated.");
  }

  const outputText = readInputFile(filePath);
  const verification = verifyText(outputText);
  if (options.outcome === "accepted" && !verification.ok) {
    throw new Error(
      "memory add with outcome 'accepted' requires output that passes verification."
    );
  }
  const receipt = createReceipt({
    input: outputText,
    output: outputText,
    skill_name: SKILL_NAME,
    verifier_version: LACONIC_VERIFIER_VERSION,
    ok: verification.ok,
    violations: toReceiptViolations(verification.violations),
    metrics: {
      charCount: verification.metrics.charCount,
      bulletCount: verification.metrics.bulletCount,
      caveatCount: verification.metrics.caveatCount
    },
    timestamp: DETERMINISTIC_TIMESTAMP
  });

  const adapter = createDefaultStyleMemoryAdapter();
  const record = await adapter.add({
    output_text: outputText,
    task_type: options.task,
    outcome: options.outcome,
    violations: verification.violations.map((violation) => violation.code),
    metrics: {
      charCount: verification.metrics.charCount,
      bulletCount: verification.metrics.bulletCount,
      caveatCount: verification.metrics.caveatCount,
      verifier_ok: verification.ok
    },
    receipt_hash: receipt.receipt_hash,
    created_at: DETERMINISTIC_TIMESTAMP
  });
  const memoryStatus =
    typeof adapter.getStatus === "function" ? adapter.getStatus() : undefined;

  writeStableJson({
    ok: true,
    memory: {
      id: record.id,
      text_hash: record.text_hash,
      task_type: record.task_type,
      outcome: record.outcome,
      receipt_hash: record.receipt_hash,
      created_at: record.created_at,
      backend: memoryStatus?.backend ?? "unknown",
      degraded: memoryStatus?.degraded ?? false,
      reason: memoryStatus?.reason ?? null
    }
  });
  return 0;
}

async function emitMemorySearch(
  query: string,
  options: MemorySearchOptions
): Promise<number> {
  const adapter = createDefaultStyleMemoryAdapter();
  const results = await adapter.search(query, { limit: options.limit });
  const memoryStatus =
    typeof adapter.getStatus === "function" ? adapter.getStatus() : undefined;
  writeStableJson({
    ok: true,
    memory: {
      backend: memoryStatus?.backend ?? "unknown",
      degraded: memoryStatus?.degraded ?? false,
      reason: memoryStatus?.reason ?? null
    },
    results: results.map((item) => ({
      score: Number(item.score.toFixed(8)),
      id: item.record.id,
      task_type: item.record.task_type,
      outcome: item.record.outcome,
      output_text: item.record.output_text,
      violations: item.record.violations,
      receipt_hash: item.record.receipt_hash,
      created_at: item.record.created_at
    }))
  });
  return 0;
}

function emitCorrectnessConfidence(options: CorrectnessConfidenceOptions): number {
  const inputPath = resolve(process.cwd(), options.input!);
  const configPath = resolve(process.cwd(), options.config!);
  const cases = loadCorrectnessCasesFile(inputPath);
  const config = loadCorrectnessConfigFile(configPath);
  const report = analyzeCorrectnessConfidence(cases, config);
  const stableReport = stableValue(report) as JsonValue;

  if (!options.receipt) {
    writeStableJson(report);
    return 0;
  }

  const output = JSON.stringify(stableReport);
  const receipt = createReceipt({
    input: JSON.stringify(stableValue({ cases, config })),
    output,
    skill_name: "correctness-confidence",
    verifier_version: CORRECTNESS_CONFIDENCE_VERSION,
    ok: report.status === "capable",
    violations:
      report.status === "capable"
        ? []
        : [
            {
              source: "correctness",
              code: "CAPABILITY_NOT_MET",
              message: `Capability status is ${report.status}.`
            }
          ],
    metrics: stableReport,
    timestamp: DETERMINISTIC_TIMESTAMP
  });

  writeStableJson({
    ...report,
    receipt_hash: receipt.receipt_hash,
    receipt
  });
  return 0;
}

function runAsync(task: Promise<number>): void {
  task
    .then((status) => process.exit(status))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}

function main(): void {
  try {
    const args = process.argv.slice(2);
    if (args.length < 1) {
      usage();
    }

    const [commandArg, ...rest] = args;

    if (commandArg === "memory") {
      const [memorySubcommand, memoryTarget, ...optionTokens] = rest;
      if (!memorySubcommand || !memoryTarget) {
        usage("memory requires subcommand and target.");
      }
      if (memorySubcommand === "add") {
        const options = parseMemoryAddOptions(optionTokens);
        runAsync(emitMemoryAdd(memoryTarget, options));
        return;
      }
      if (memorySubcommand === "search") {
        const options = parseMemorySearchOptions(optionTokens);
        runAsync(emitMemorySearch(memoryTarget, options));
        return;
      }
      usage(`Unknown memory subcommand: ${memorySubcommand}`);
    }

    if (commandArg === "correctness") {
      const options = parseCorrectnessConfidenceOptions(rest);
      const exitCode = emitCorrectnessConfidence(options);
      process.exit(exitCode);
      return;
    }

    if (!isCoreCommand(commandArg)) {
      usage(`Unknown command: ${commandArg}`);
    }
    if (rest.length < 1) {
      usage("Missing file argument.");
    }

    const [filePath, ...optionTokens] = rest;
    const options = parseCoreOptions(optionTokens);
    if (commandArg === "pipeline" && !options.task) {
      usage("pipeline requires --task writing|code|data|regulated.");
    }
    if (commandArg !== "pipeline" && options.task) {
      usage("--task is only supported for pipeline.");
    }
    if (options.memory && commandArg !== "pipeline") {
      usage("--memory is only supported for pipeline.");
    }

    const input = readInputFile(filePath);
    let exitCode = 1;
    if (commandArg === "check") {
      exitCode = emitCheck(input, filePath, options.receipt);
    } else if (commandArg === "rewrite") {
      exitCode = emitRewrite(input, filePath, options.receipt);
    } else if (options.memory) {
      runAsync(emitPipelineWithMemory(input, filePath, options.task!, options.receipt));
      return;
    } else {
      exitCode = emitPipelineWithoutMemory(input, filePath, options.task!, options.receipt);
    }

    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

main();
