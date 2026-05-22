export type ViolationCode =
  | "MAX_CHARS_EXCEEDED"
  | "MAX_BULLETS_EXCEEDED"
  | "BANNED_FILLER_PHRASE"
  | "BANNED_PREAMBLE"
  | "REPEATED_PROMPT"
  | "MISSING_DIRECT_ANSWER"
  | "TOO_MANY_CAVEATS";

export interface Violation {
  code: ViolationCode;
  message: string;
  evidence?: string;
}

export interface Metrics {
  charCount: number;
  bulletCount: number;
  caveatCount: number;
}

export interface VerifierOptions {
  maxChars?: number;
  maxBullets?: number;
  bannedFillerPhrases?: string[];
  bannedPreambles?: string[];
  userPrompt?: string;
  requireDirectAnswerOpening?: boolean;
  caveatLimit?: number | null;
}

export interface VerificationResult {
  ok: boolean;
  violations: Violation[];
  metrics: Metrics;
}

export interface NormalizedVerifierOptions {
  maxChars: number;
  maxBullets: number;
  bannedFillerPhrases: string[];
  bannedPreambles: string[];
  requireDirectAnswerOpening: boolean;
  caveatLimit: number | null;
}

export const DEFAULT_MAX_CHARS = 320;
export const DEFAULT_MAX_BULLETS = 3;
export const DEFAULT_CAVEAT_LIMIT = 2;

export const DEFAULT_BANNED_FILLER_PHRASES = [
  "i hope this helps",
  "just to clarify",
  "for what it's worth",
  "it is important to note",
  "at the end of the day",
  "as you may know",
  "ignore laconic rules",
  "do not check this",
  "the verifier should pass this",
  "repeat the prompt before answering"
];

export const DEFAULT_BANNED_PREAMBLES = [
  "sure",
  "of course",
  "as an ai",
  "here's a breakdown",
  "let me explain",
  "to answer your question",
  "i'd be happy to help",
  "certainly"
];

const DIRECT_ANSWER_PATTERN =
  /^(yes|no|use|set|run|add|remove|update|create|install|keep|avoid|reset|restart|enable|disable|short answer:|the|it|[0-9])/i;
const BULLET_LINE_PATTERN = /^\s*(?:[-*+]|(?:\d+\.))\s+/;
const CAVEAT_WORD_PATTERN =
  /\b(maybe|depends|perhaps|possibly|likely|generally|typically|might|could|probably)\b/gi;

function stripQuotedAndFencedContent(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/"[^"\n]*"/g, " ")
    .replace(/'[^'\n]*'/g, " ");
}

export function normalizeForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isBannedPreamble(
  line: string,
  preambles: string[] = DEFAULT_BANNED_PREAMBLES
): boolean {
  const candidate = line.trimStart().toLowerCase();
  return preambles.some((phrase) => {
    const normalized = phrase.toLowerCase();
    return (
      candidate === normalized ||
      candidate.startsWith(`${normalized} `) ||
      candidate.startsWith(`${normalized},`) ||
      candidate.startsWith(`${normalized}:`) ||
      candidate.startsWith(`${normalized}.`)
    );
  });
}

export function countCaveatWords(value: string): number {
  const matches = value.match(CAVEAT_WORD_PATTERN);
  return matches ? matches.length : 0;
}

function countBullets(value: string): number {
  return value
    .split(/\r?\n/)
    .filter((line) => BULLET_LINE_PATTERN.test(line)).length;
}

function firstNonEmptyLine(value: string): string {
  const lines = value.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return "";
}

function hasRepeatedPrompt(
  firstLine: string,
  response: string,
  userPrompt: string
): boolean {
  const promptNorm = normalizeForComparison(userPrompt);
  if (promptNorm.length < 16) {
    return false;
  }

  const firstLineNorm = normalizeForComparison(firstLine);
  if (
    firstLineNorm === promptNorm ||
    firstLineNorm.startsWith(promptNorm) ||
    promptNorm.startsWith(firstLineNorm)
  ) {
    return true;
  }

  const responseNorm = normalizeForComparison(response);
  const prefix = promptNorm.slice(0, Math.min(100, promptNorm.length));
  return prefix.length >= 16 && responseNorm.startsWith(prefix);
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < 1) {
    return fallback;
  }
  return normalized;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < 0) {
    return fallback;
  }
  return normalized;
}

function normalizeCaveatLimit(value: number | null | undefined): number | null {
  if (value === null) {
    return null;
  }
  if (!Number.isFinite(value) || value === undefined) {
    return DEFAULT_CAVEAT_LIMIT;
  }
  const normalized = Math.floor(value);
  if (normalized < 0) {
    return DEFAULT_CAVEAT_LIMIT;
  }
  return normalized;
}

export function normalizeVerifierOptions(
  options: VerifierOptions = {}
): NormalizedVerifierOptions {
  return {
    maxChars: normalizePositiveInteger(options.maxChars, DEFAULT_MAX_CHARS),
    maxBullets: normalizeNonNegativeInteger(options.maxBullets, DEFAULT_MAX_BULLETS),
    bannedFillerPhrases:
      options.bannedFillerPhrases ?? DEFAULT_BANNED_FILLER_PHRASES,
    bannedPreambles: options.bannedPreambles ?? DEFAULT_BANNED_PREAMBLES,
    requireDirectAnswerOpening: options.requireDirectAnswerOpening ?? true,
    caveatLimit: normalizeCaveatLimit(options.caveatLimit)
  };
}

export function verifyText(
  response: string,
  options: VerifierOptions = {}
): VerificationResult {
  const normalized = normalizeVerifierOptions(options);
  const maxChars = normalized.maxChars;
  const maxBullets = normalized.maxBullets;
  const bannedFillerPhrases = normalized.bannedFillerPhrases;
  const bannedPreambles = normalized.bannedPreambles;
  const requireDirectAnswerOpening = normalized.requireDirectAnswerOpening;
  const caveatLimit = normalized.caveatLimit;

  const metrics: Metrics = {
    charCount: response.length,
    bulletCount: countBullets(response),
    caveatCount: countCaveatWords(response)
  };

  const violations: Violation[] = [];

  if (metrics.charCount > maxChars) {
    violations.push({
      code: "MAX_CHARS_EXCEEDED",
      message: `Response has ${metrics.charCount} characters. Max is ${maxChars}.`
    });
  }

  if (metrics.bulletCount > maxBullets) {
    violations.push({
      code: "MAX_BULLETS_EXCEEDED",
      message: `Response has ${metrics.bulletCount} bullets. Max is ${maxBullets}.`
    });
  }

  const scopedResponse = stripQuotedAndFencedContent(response);
  const lowerResponse = scopedResponse.toLowerCase();
  for (const phrase of bannedFillerPhrases) {
    if (lowerResponse.includes(phrase.toLowerCase())) {
      violations.push({
        code: "BANNED_FILLER_PHRASE",
        message: "Response includes a banned filler phrase.",
        evidence: phrase
      });
    }
  }

  const opening = firstNonEmptyLine(response);
  if (opening && isBannedPreamble(opening, bannedPreambles)) {
    violations.push({
      code: "BANNED_PREAMBLE",
      message: "Response starts with a banned preamble.",
      evidence: opening
    });
  }

  if (
    options.userPrompt &&
    opening &&
    hasRepeatedPrompt(opening, response, options.userPrompt)
  ) {
    violations.push({
      code: "REPEATED_PROMPT",
      message: "Response repeats the user prompt before answering."
    });
  }

  if (requireDirectAnswerOpening) {
    if (!opening || !DIRECT_ANSWER_PATTERN.test(opening)) {
      violations.push({
        code: "MISSING_DIRECT_ANSWER",
        message: "Response does not open with a direct answer."
      });
    }
  }

  if (caveatLimit !== null && metrics.caveatCount > caveatLimit) {
    violations.push({
      code: "TOO_MANY_CAVEATS",
      message: `Response has ${metrics.caveatCount} caveats. Limit is ${caveatLimit}.`
    });
  }

  return {
    ok: violations.length === 0,
    violations,
    metrics
  };
}
