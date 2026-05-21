import { verifyText, type VerificationResult, type VerifierOptions } from "./verifier";
import { rewriteText } from "./rewrite";
import {
  CORRECTNESS_VERIFIER_VERSION,
  verifyCorrectness,
  type CorrectnessConfig,
  type CorrectnessResult,
  type CorrectnessTaskType
} from "./correctness";
import {
  createReceipt,
  type DeterministicReceipt,
  type JsonValue,
  type ReceiptViolation
} from "./receipt";

export const LACONIC_VERIFIER_VERSION = "laconic/v0";
export const PIPELINE_VERIFIER_VERSION = `${LACONIC_VERIFIER_VERSION}+${CORRECTNESS_VERIFIER_VERSION}`;

export interface PipelineInput {
  input: string;
  draft: string;
  task_type?: CorrectnessTaskType;
  correctness_config?: CorrectnessConfig;
  verifier_options?: VerifierOptions;
  max_fix_loops?: number;
  skill_name?: string;
  timestamp?: string;
}

export interface PipelineIteration {
  loop: number;
  output: string;
  laconic: VerificationResult;
  correctness: CorrectnessResult;
}

export interface PipelineResult {
  final: string;
  ok: boolean;
  laconic: VerificationResult;
  correctness: CorrectnessResult;
  iterations: PipelineIteration[];
  receipt: DeterministicReceipt;
}

function normalizeLoopCount(max_fix_loops: number | undefined): number {
  if (max_fix_loops === undefined) {
    return 2;
  }

  if (!Number.isFinite(max_fix_loops) || max_fix_loops < 0) {
    return 0;
  }

  return Math.floor(max_fix_loops);
}

function toReceiptViolations(
  laconic: VerificationResult,
  correctness: CorrectnessResult
): ReceiptViolation[] {
  const laconicViolations: ReceiptViolation[] = laconic.violations.map((violation) => ({
    source: "laconic",
    code: violation.code,
    message: violation.message,
    evidence: violation.evidence
  }));

  const correctnessViolations: ReceiptViolation[] = correctness.violations.map(
    (violation) => ({
      source: "correctness",
      code: violation.code,
      message: violation.message,
      evidence: violation.evidence
    })
  );

  return [...laconicViolations, ...correctnessViolations];
}

function toReceiptMetrics(
  iterations: PipelineIteration[],
  laconic: VerificationResult,
  correctness: CorrectnessResult
): JsonValue {
  const laconicMetrics = {
    charCount: laconic.metrics.charCount,
    bulletCount: laconic.metrics.bulletCount,
    caveatCount: laconic.metrics.caveatCount
  };

  const correctnessMetrics = {
    mode: correctness.metrics.mode,
    contracts_checked: correctness.metrics.contracts_checked,
    violation_count: correctness.metrics.violation_count
  };

  return {
    iterations: iterations.length,
    laconic: laconicMetrics,
    correctness: correctnessMetrics
  };
}

export function runPipeline(input: PipelineInput): PipelineResult {
  const maxFixLoops = normalizeLoopCount(input.max_fix_loops);
  const taskType = input.task_type ?? "writing";
  const skillName = input.skill_name ?? "laconic-skill";
  const verifierOptions: VerifierOptions = {
    ...input.verifier_options,
    userPrompt: input.verifier_options?.userPrompt ?? input.input
  };

  let working = input.draft;
  let laconic = verifyText(working, verifierOptions);
  let correctness = verifyCorrectness({
    task_type: taskType,
    input: input.input,
    output: working,
    config: input.correctness_config
  });

  const iterations: PipelineIteration[] = [
    {
      loop: 0,
      output: working,
      laconic,
      correctness
    }
  ];

  for (let loop = 1; loop <= maxFixLoops; loop += 1) {
    if (laconic.ok && correctness.ok) {
      break;
    }

    working = rewriteText(working, verifierOptions);
    laconic = verifyText(working, verifierOptions);
    correctness = verifyCorrectness({
      task_type: taskType,
      input: input.input,
      output: working,
      config: input.correctness_config
    });

    iterations.push({
      loop,
      output: working,
      laconic,
      correctness
    });
  }

  const ok = laconic.ok && correctness.ok;
  const receipt = createReceipt({
    input: input.input,
    output: working,
    skill_name: skillName,
    verifier_version: PIPELINE_VERIFIER_VERSION,
    ok,
    violations: toReceiptViolations(laconic, correctness),
    metrics: toReceiptMetrics(iterations, laconic, correctness),
    timestamp: input.timestamp
  });

  return {
    final: working,
    ok,
    laconic,
    correctness,
    iterations,
    receipt
  };
}
