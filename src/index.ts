export { rewriteText } from "./rewrite";
export { verifyText } from "./verifier";
export { createReceipt, computeReceiptHash, sha256Hex } from "./receipt";
export { compareCodepointStable } from "./deterministic";
export {
  CORRECTNESS_VERIFIER_VERSION,
  listCorrectnessContracts,
  verifyCorrectness
} from "./correctness";
export {
  LACONIC_VERIFIER_VERSION,
  PIPELINE_VERIFIER_VERSION,
  runPipeline
} from "./pipeline";
export {
  HASH_EMBEDDING_DIMENSIONS,
  LanceDbStyleMemoryAdapter,
  cosineSimilarity,
  createDefaultStyleMemoryAdapter,
  hashEmbedText,
  normalizeMemoryText,
  textHashHex
} from "./memory";
export type {
  Metrics,
  VerificationResult,
  VerifierOptions,
  Violation,
  ViolationCode
} from "./verifier";
export type {
  DeterministicReceipt,
  JsonPrimitive,
  JsonValue,
  ReceiptInput,
  ReceiptViolation
} from "./receipt";
export type {
  CodeCorrectnessConfig,
  CorrectnessConfig,
  CorrectnessContract,
  CorrectnessInput,
  CorrectnessMetrics,
  CorrectnessResult,
  CorrectnessTaskType,
  CorrectnessViolation,
  DataCorrectnessConfig,
  RegulatedCorrectnessConfig,
  WritingCorrectnessConfig
} from "./correctness";
export type {
  PipelineInput,
  PipelineIteration,
  PipelineResult
} from "./pipeline";
export type {
  StyleMemoryAdapter,
  StyleMemoryAddInput,
  StyleMemoryStatus,
  StyleMemoryOutcome,
  StyleMemoryRecord,
  StyleMemorySearchOptions,
  StyleMemorySearchResult
} from "./memory";
