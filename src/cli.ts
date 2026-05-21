#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { rewriteText } from "./rewrite";
import { runPipeline, LACONIC_VERIFIER_VERSION } from "./pipeline";
import { verifyText } from "./verifier";
import { createReceipt, type ReceiptViolation } from "./receipt";
import { type CorrectnessTaskType } from "./correctness";
import { compareCodepointStable } from "./deterministic";

type Command = "check" | "rewrite" | "pipeline";
const SKILL_NAME = "laconic-responses";
const DETERMINISTIC_TIMESTAMP = "1970-01-01T00:00:00.000Z";

interface CliOptions {
  receipt: boolean;
  task?: CorrectnessTaskType;
}

function usage(message?: string): never {
  if (message) {
    process.stderr.write(`${message}\n`);
  }
  process.stderr.write(
    "Usage: laconic <check|rewrite|pipeline> <file> [--task writing|code|data|regulated] [--receipt]\n"
  );
  process.exit(1);
}

function readInputFile(filePath: string): string {
  if (filePath === "-") {
    return readFileSync(0, "utf8");
  }
  return readFileSync(resolve(process.cwd(), filePath), "utf8");
}

function isCommand(value: string): value is Command {
  return value === "check" || value === "rewrite" || value === "pipeline";
}

function isTaskType(value: string): value is CorrectnessTaskType {
  return value === "writing" || value === "code" || value === "data" || value === "regulated";
}

function parseOptions(tokens: string[]): CliOptions {
  const options: CliOptions = { receipt: false };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--receipt") {
      options.receipt = true;
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

function emitCheck(
  input: string,
  filePath: string,
  withReceipt: boolean
): number {
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

function emitRewrite(
  input: string,
  filePath: string,
  withReceipt: boolean
): number {
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
    metrics: { ...result.metrics },
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

function emitPipeline(
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
    receipt: result.receipt
  });
  return result.ok ? 0 : 1;
}

const args = process.argv.slice(2);
if (args.length < 2) {
  usage();
}

const [commandArg, filePath, ...optionTokens] = args;
if (!isCommand(commandArg)) {
  usage(`Unknown command: ${commandArg}`);
}

const options = parseOptions(optionTokens);
if (commandArg === "pipeline" && !options.task) {
  usage("pipeline requires --task writing|code|data|regulated.");
}
if (commandArg !== "pipeline" && options.task) {
  usage("--task is only supported for pipeline.");
}

const input = readInputFile(filePath);

let exitCode = 1;
if (commandArg === "check") {
  exitCode = emitCheck(input, filePath, options.receipt);
} else if (commandArg === "rewrite") {
  exitCode = emitRewrite(input, filePath, options.receipt);
} else {
  exitCode = emitPipeline(input, filePath, options.task!, options.receipt);
}

process.exit(exitCode);
