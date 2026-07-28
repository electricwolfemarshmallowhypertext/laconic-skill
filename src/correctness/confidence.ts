import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { compareCodepointStable } from "../deterministic";

export const CORRECTNESS_CONFIDENCE_VERSION = "correctness-confidence/v0";

export type CorrectnessCapabilityStatus = "capable" | "marginal" | "not_capable";

export interface CapabilityThresholds {
  capable?: number;
  marginal?: number;
}

export interface CorrectnessConfidenceConfig {
  metric_name: string;
  lower_spec_limit?: number;
  upper_spec_limit?: number;
  confidence_level?: number;
  bootstrap_runs?: number;
  deterministic_seed?: number;
  strata_field?: string;
  capability_thresholds?: CapabilityThresholds;
}

export interface CorrectnessEvaluatedCase {
  id: string;
  category?: string;
  stratum?: string;
  score: number;
  passed?: boolean;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface NormalizedCorrectnessConfidenceConfig {
  metric_name: string;
  lower_spec_limit: number | null;
  upper_spec_limit: number | null;
  confidence_level: number;
  bootstrap_runs: number;
  deterministic_seed: number;
  strata_field: string | null;
  capability_thresholds: Required<CapabilityThresholds>;
}

export interface StratumSummary {
  value: string;
  n: number;
  mean: number;
}

export interface CorrectnessConfidenceReport {
  metric: string;
  n: number;
  mean: number;
  confidence_interval: [number, number];
  lower_spec_limit: number | null;
  upper_spec_limit: number | null;
  capability_index: number;
  status: CorrectnessCapabilityStatus;
  bootstrap_runs: number;
  confidence_level: number;
  deterministic_seed: number;
  strata?: {
    field: string;
    summary: StratumSummary[];
  };
}

const DEFAULT_CONFIDENCE_LEVEL = 0.95;
const DEFAULT_BOOTSTRAP_RUNS = 1000;
const DEFAULT_SEED = 1;
const DEFAULT_CAPABLE_THRESHOLD = 1;
const DEFAULT_MARGINAL_THRESHOLD = 0.67;

function round(value: number): number {
  return Number(value.toFixed(6));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeOptionalNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isFiniteNumber(value)) {
    throw new Error(`Invalid correctness config: ${field} must be numeric.`);
  }
  return value;
}

export function normalizeCorrectnessConfidenceConfig(
  config: CorrectnessConfidenceConfig
): NormalizedCorrectnessConfidenceConfig {
  if (!config || typeof config !== "object") {
    throw new Error("Invalid correctness config: config must be an object.");
  }
  if (typeof config.metric_name !== "string" || config.metric_name.trim() === "") {
    throw new Error("Invalid correctness config: metric_name is required.");
  }

  const lower_spec_limit = normalizeOptionalNumber(
    config.lower_spec_limit,
    "lower_spec_limit"
  );
  const upper_spec_limit = normalizeOptionalNumber(
    config.upper_spec_limit,
    "upper_spec_limit"
  );
  if (lower_spec_limit === null && upper_spec_limit === null) {
    throw new Error(
      "Invalid correctness config: lower_spec_limit or upper_spec_limit is required."
    );
  }
  if (
    lower_spec_limit !== null &&
    upper_spec_limit !== null &&
    lower_spec_limit >= upper_spec_limit
  ) {
    throw new Error(
      "Invalid correctness config: lower_spec_limit must be below upper_spec_limit."
    );
  }

  const confidence_level = config.confidence_level ?? DEFAULT_CONFIDENCE_LEVEL;
  if (!isFiniteNumber(confidence_level) || confidence_level <= 0 || confidence_level >= 1) {
    throw new Error("Invalid correctness config: confidence_level must be between 0 and 1.");
  }

  const bootstrap_runs = config.bootstrap_runs ?? DEFAULT_BOOTSTRAP_RUNS;
  if (!Number.isInteger(bootstrap_runs) || bootstrap_runs < 1) {
    throw new Error("Invalid correctness config: bootstrap_runs must be a positive integer.");
  }

  const deterministic_seed = config.deterministic_seed ?? DEFAULT_SEED;
  if (!Number.isInteger(deterministic_seed) || deterministic_seed < 0) {
    throw new Error(
      "Invalid correctness config: deterministic_seed must be a non-negative integer."
    );
  }

  const strata_field = config.strata_field ?? null;
  if (strata_field !== null && (typeof strata_field !== "string" || strata_field === "")) {
    throw new Error("Invalid correctness config: strata_field must be a non-empty string.");
  }

  const thresholds = config.capability_thresholds ?? {};
  const capable = thresholds.capable ?? DEFAULT_CAPABLE_THRESHOLD;
  const marginal = thresholds.marginal ?? DEFAULT_MARGINAL_THRESHOLD;
  if (!isFiniteNumber(capable) || !isFiniteNumber(marginal) || capable <= 0 || marginal < 0) {
    throw new Error("Invalid correctness config: capability thresholds must be numeric.");
  }
  if (marginal > capable) {
    throw new Error(
      "Invalid correctness config: marginal threshold must not exceed capable threshold."
    );
  }

  return {
    metric_name: config.metric_name,
    lower_spec_limit,
    upper_spec_limit,
    confidence_level,
    bootstrap_runs,
    deterministic_seed,
    strata_field,
    capability_thresholds: { capable, marginal }
  };
}

function normalizeCases(cases: CorrectnessEvaluatedCase[]): CorrectnessEvaluatedCase[] {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error("Invalid correctness input: at least one evaluated case is required.");
  }
  return cases.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Invalid correctness input: case ${index + 1} must be an object.`);
    }
    if (typeof item.id !== "string" || item.id.trim() === "") {
      throw new Error(`Invalid correctness input: case ${index + 1} id is required.`);
    }
    if (!isFiniteNumber(item.score)) {
      throw new Error(`Invalid correctness input: case ${item.id} score must be numeric.`);
    }
    if (item.passed !== undefined && typeof item.passed !== "boolean") {
      throw new Error(`Invalid correctness input: case ${item.id} passed must be boolean.`);
    }
    return { ...item };
  });
}

function nextRandom(state: { value: number }): number {
  state.value = (1664525 * state.value + 1013904223) >>> 0;
  return state.value / 0x100000000;
}

function percentile(sortedValues: number[], probability: number): number {
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }
  const index = probability * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sortedValues[lower];
  }
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function bootstrapConfidenceInterval(
  scores: number[],
  runs: number,
  confidenceLevel: number,
  seed: number
): [number, number] {
  const randomState = { value: seed >>> 0 };
  const means: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    let total = 0;
    for (let index = 0; index < scores.length; index += 1) {
      const sampleIndex = Math.floor(nextRandom(randomState) * scores.length);
      total += scores[sampleIndex];
    }
    means.push(total / scores.length);
  }

  means.sort((left, right) => left - right);
  const alpha = (1 - confidenceLevel) / 2;
  return [
    round(percentile(means, alpha)),
    round(percentile(means, 1 - alpha))
  ];
}

function safeCapability(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return numerator >= 0 ? Number.MAX_SAFE_INTEGER : -Number.MAX_SAFE_INTEGER;
  }
  return numerator / denominator;
}

function capabilityIndex(
  meanValue: number,
  ci: [number, number],
  config: NormalizedCorrectnessConfidenceConfig
): number {
  const candidates: number[] = [];
  if (config.lower_spec_limit !== null) {
    candidates.push(
      safeCapability(meanValue - config.lower_spec_limit, meanValue - ci[0])
    );
  }
  if (config.upper_spec_limit !== null) {
    candidates.push(
      safeCapability(config.upper_spec_limit - meanValue, ci[1] - meanValue)
    );
  }
  return round(Math.min(...candidates));
}

function meetsSpec(
  meanValue: number,
  config: NormalizedCorrectnessConfidenceConfig
): boolean {
  if (config.lower_spec_limit !== null && meanValue < config.lower_spec_limit) {
    return false;
  }
  if (config.upper_spec_limit !== null && meanValue > config.upper_spec_limit) {
    return false;
  }
  return true;
}

function statusForCapability(
  meanValue: number,
  capability: number,
  config: NormalizedCorrectnessConfidenceConfig
): CorrectnessCapabilityStatus {
  if (!meetsSpec(meanValue, config)) {
    return "not_capable";
  }
  if (capability >= config.capability_thresholds.capable) {
    return "capable";
  }
  if (capability >= config.capability_thresholds.marginal) {
    return "marginal";
  }
  return "not_capable";
}

function buildStrataSummary(
  cases: CorrectnessEvaluatedCase[],
  strataField: string | null
): CorrectnessConfidenceReport["strata"] | undefined {
  if (strataField === null) {
    return undefined;
  }

  const buckets = new Map<string, number[]>();
  for (const item of cases) {
    const raw = item[strataField];
    if (raw === undefined || raw === null) {
      continue;
    }
    const value = String(raw);
    const existing = buckets.get(value) ?? [];
    existing.push(item.score);
    buckets.set(value, existing);
  }
  if (buckets.size === 0) {
    return undefined;
  }

  const summary = [...buckets.entries()]
    .sort(([left], [right]) => compareCodepointStable(left, right))
    .map(([value, scores]) => ({
      value,
      n: scores.length,
      mean: round(mean(scores))
    }));

  return {
    field: strataField,
    summary
  };
}

export function analyzeCorrectnessConfidence(
  cases: CorrectnessEvaluatedCase[],
  rawConfig: CorrectnessConfidenceConfig
): CorrectnessConfidenceReport {
  const config = normalizeCorrectnessConfidenceConfig(rawConfig);
  const normalizedCases = normalizeCases(cases);
  const scores = normalizedCases.map((item) => item.score);
  const meanValue = round(mean(scores));
  const ci = bootstrapConfidenceInterval(
    scores,
    config.bootstrap_runs,
    config.confidence_level,
    config.deterministic_seed
  );
  const capability = capabilityIndex(meanValue, ci, config);

  const report: CorrectnessConfidenceReport = {
    metric: config.metric_name,
    n: normalizedCases.length,
    mean: meanValue,
    confidence_interval: ci,
    lower_spec_limit: config.lower_spec_limit,
    upper_spec_limit: config.upper_spec_limit,
    capability_index: capability,
    status: statusForCapability(meanValue, capability, config),
    bootstrap_runs: config.bootstrap_runs,
    confidence_level: config.confidence_level,
    deterministic_seed: config.deterministic_seed
  };

  const strata = buildStrataSummary(normalizedCases, config.strata_field);
  if (strata) {
    report.strata = strata;
  }

  return report;
}

export function loadCorrectnessConfigFile(filePath: string): CorrectnessConfidenceConfig {
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw) as CorrectnessConfidenceConfig;
}

export function loadCorrectnessCasesFile(filePath: string): CorrectnessEvaluatedCase[] {
  const raw = readFileSync(filePath, "utf8");
  if (extname(filePath).toLowerCase() === ".jsonl") {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as CorrectnessEvaluatedCase);
  }

  const parsed = JSON.parse(raw) as CorrectnessEvaluatedCase[] | { cases?: CorrectnessEvaluatedCase[] };
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (Array.isArray(parsed.cases)) {
    return parsed.cases;
  }
  throw new Error("Invalid correctness input: JSON file must be an array or contain cases.");
}
