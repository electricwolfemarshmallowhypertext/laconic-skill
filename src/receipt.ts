import { createHash } from "node:crypto";
import { compareCodepointStable } from "./deterministic";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ReceiptViolation {
  source: "laconic" | "correctness";
  code: string;
  message: string;
  evidence?: string;
}

export interface ReceiptInput {
  input: string;
  output: string;
  skill_name: string;
  verifier_version: string;
  ok: boolean;
  violations: ReceiptViolation[];
  metrics: JsonValue;
  timestamp?: string;
  rating?: number;
  user_feedback?: string;
}

export interface DeterministicReceipt {
  input_hash: string;
  output_hash: string;
  skill_name: string;
  verifier_version: string;
  ok: boolean;
  violations: ReceiptViolation[];
  metrics: JsonValue;
  timestamp: string;
  receipt_hash: string;
  rating?: number;
  user_feedback?: string;
}

interface ReceiptHashPayload {
  input_hash: string;
  output_hash: string;
  verifier_version: string;
  violations: ReceiptViolation[];
  metrics: unknown;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "null";
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort((left, right) =>
    compareCodepointStable(left, right)
  );
  const pairs = keys.map((key) => {
    const nested = objectValue[key];
    return `${JSON.stringify(key)}:${stableStringify(nested)}`;
  });
  return `{${pairs.join(",")}}`;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sortViolations(violations: ReceiptViolation[]): ReceiptViolation[] {
  return [...violations].sort((a, b) => {
    const left = `${a.source}|${a.code}|${a.message}|${a.evidence ?? ""}`;
    const right = `${b.source}|${b.code}|${b.message}|${b.evidence ?? ""}`;
    return compareCodepointStable(left, right);
  });
}

function buildHashPayload(receipt: {
  input_hash: string;
  output_hash: string;
  verifier_version: string;
  violations: ReceiptViolation[];
  metrics: unknown;
}): ReceiptHashPayload {
  return {
    input_hash: receipt.input_hash,
    output_hash: receipt.output_hash,
    verifier_version: receipt.verifier_version,
    violations: sortViolations(receipt.violations),
    metrics: cloneJson(receipt.metrics)
  };
}

export function computeReceiptHash(receipt: {
  input_hash: string;
  output_hash: string;
  verifier_version: string;
  violations: ReceiptViolation[];
  metrics: unknown;
}): string {
  return sha256Hex(stableStringify(buildHashPayload(receipt)));
}

export function createReceipt(input: ReceiptInput): DeterministicReceipt {
  const input_hash = sha256Hex(input.input);
  const output_hash = sha256Hex(input.output);
  const violations = sortViolations(input.violations);
  const metrics = cloneJson(input.metrics);
  const timestamp = input.timestamp ?? "1970-01-01T00:00:00.000Z";

  const receipt_hash = computeReceiptHash({
    input_hash,
    output_hash,
    verifier_version: input.verifier_version,
    violations,
    metrics
  });

  return {
    input_hash,
    output_hash,
    skill_name: input.skill_name,
    verifier_version: input.verifier_version,
    ok: input.ok,
    violations,
    metrics,
    timestamp,
    receipt_hash,
    rating: input.rating,
    user_feedback: input.user_feedback
  };
}
