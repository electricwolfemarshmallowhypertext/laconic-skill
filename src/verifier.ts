export type ViolationCode =
  | "MAX_CHARS_EXCEEDED"
  | "MAX_BULLETS_EXCEEDED"
  | "BANNED_FILLER_PHRASE"
  | "BANNED_PREAMBLE"
  | "REPEATED_PROMPT"
  | "MISSING_DIRECT_ANSWER"
  | "TOO_MANY_CAVEATS"
  | "STRUCTURAL_AI_PATTERN";

export interface Violation {
  code: ViolationCode;
  message: string;
  evidence?: string;
}

export interface Metrics {
  charCount: number;
  bulletCount: number;
  caveatCount: number;
  structuralPatternCount: number;
  qualityScore: number;
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
  "sorry for the long answer",
  "sorry for overexplaining",
  "i apologize for the extra detail",
  "at the end of the day",
  "as you may know",
  "absolutely",
  "here's the thing",
  "here's why",
  "here's what",
  "let me be clear",
  "to be clear",
  "make no mistake",
  "let that sink in",
  "this matters because",
  "at its core",
  "in today's",
  "when it comes to",
  "in a world where",
  "the reality is",
  "it's worth noting",
  "moving forward",
  "circle back",
  "deep dive",
  "lean into",
  "take a step back",
  "on the same page",
  "spoiler:",
  "plot twist",
  "hint:",
  "let me walk you through",
  "the rest of this",
  "as we'll see",
  "i want to explore",
  "full stop",
  "ignore laconic rules",
  "do not check this",
  "the verifier should pass this",
  "repeat the prompt before answering"
];

export const DEFAULT_BANNED_PREAMBLES = [
  "sure",
  "of course",
  "as an ai",
  "just to clarify",
  "it is important to note",
  "at the end of the day",
  "here's a breakdown",
  "here's the thing",
  "here's why",
  "here's what",
  "let me explain",
  "let me be clear",
  "to be clear",
  "make no mistake",
  "at its core",
  "in today's",
  "when it comes to",
  "in a world where",
  "the reality is",
  "it's worth noting",
  "moving forward",
  "let me walk you through",
  "to answer your question",
  "i'd be happy to help",
  "certainly",
  "absolutely"
];

const DIRECT_ANSWER_PATTERN =
  /^(yes|Yes|no|No|use|Use|set|Set|run|Run|add|Add|remove|Remove|update|Update|create|Create|install|Install|keep|Keep|avoid|Avoid|reject|Reject|build|Build|do|Do|make|Make|ship|Ship|publish|Publish|reset|Reset|restart|Restart|enable|Enable|disable|Disable|verify|Verify|laconic|Laconic|short answer:|Short answer:|the|The|a|A|an|An|this|This|these|These|that|That|those|Those|it|It|i|I|we|We|you|You|there|There|[A-Z][a-z0-9-]+|[0-9]|\{|\[)/;
const BULLET_LINE_PATTERN = /^\s*(?:[-*+]|(?:\d+\.))\s+/;
const CAVEAT_WORD_PATTERN =
  /\b(maybe|depends|perhaps|possibly|likely|generally|typically|might|could|probably)\b/gi;
const STRUCTURAL_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: "binary_contrast",
    pattern: /\b(?:not because\b[\s\S]{0,120}\bbecause\b|isn['\u2019]?t the problem\b[\s\S]{0,120}\bis\b|the answer isn['\u2019]?t\b[\s\S]{0,120}\bit['\u2019]?s\b|not just\b[\s\S]{0,120}\bbut also\b)/i
  },
  {
    name: "rhetorical_setup",
    pattern: /\b(?:what if i told you|here['\u2019]?s what i mean|think about it|and that['\u2019]?s okay)\b/i
  },
  {
    name: "dramatic_fragmentation",
    pattern: /\b(?:that['\u2019]?s it|that['\u2019]?s the [a-z]+|and [a-z]+\. and [a-z]+)\b/i
  },
  {
    name: "passive_voice",
    pattern: /\b(?:was|were|is|are|be|been|being)\s+[a-z]+ed\b/i
  },
  {
    name: "lazy_extreme",
    pattern: /\b(?:always|never|everyone|everybody|nobody)\b/i
  },
  {
    name: "wh_sentence_starter",
    pattern: /(?:^|[.!?]\s+)(?:What|When|Where|Which|Who|Why|How)\b/
  },
  {
    name: "em_dash",
    pattern: /\u2014/
  }
];

function stripQuotedAndFencedContent(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/"[^"\n]*"/g, " ")
    .replace(/(^|[^A-Za-z0-9])'[^'\n]+'(?=$|[^A-Za-z0-9])/g, "$1 ");
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

function isBannedFillerOpening(line: string, fillerPhrases: string[]): boolean {
  const candidate = line.trimStart().toLowerCase();
  return fillerPhrases.some((phrase) => {
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

function structuralPatternNames(value: string): string[] {
  return STRUCTURAL_PATTERNS.filter(({ pattern }) => pattern.test(value)).map(
    ({ name }) => name
  );
}

function qualityScore(
  metrics: Metrics,
  violationCount: number,
  maxChars: number,
  maxBullets: number,
  caveatLimit: number | null
): number {
  const lengthPenalty = Math.max(0, metrics.charCount - maxChars) / 8;
  const bulletPenalty = Math.max(0, metrics.bulletCount - maxBullets) * 8;
  const caveatPenalty =
    caveatLimit === null ? 0 : Math.max(0, metrics.caveatCount - caveatLimit) * 8;
  const structuralPenalty = metrics.structuralPatternCount * 10;
  const violationPenalty = violationCount * 8;
  return Math.max(
    0,
    Math.round(
      100 -
        lengthPenalty -
        bulletPenalty -
        caveatPenalty -
        structuralPenalty -
        violationPenalty
    )
  );
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
    caveatCount: countCaveatWords(response),
    structuralPatternCount: structuralPatternNames(
      stripQuotedAndFencedContent(response)
    ).length,
    qualityScore: 100
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
    if (
      !opening ||
      isBannedPreamble(opening, bannedPreambles) ||
      isBannedFillerOpening(opening, bannedFillerPhrases) ||
      Boolean(
        options.userPrompt && hasRepeatedPrompt(opening, response, options.userPrompt)
      ) ||
      !DIRECT_ANSWER_PATTERN.test(opening)
    ) {
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

  for (const name of structuralPatternNames(scopedResponse)) {
    if (name === "passive_voice" && metrics.charCount <= maxChars) {
      continue;
    }
    violations.push({
      code: "STRUCTURAL_AI_PATTERN",
      message: "Response includes a formulaic AI-style structure.",
      evidence: name
    });
  }

  metrics.qualityScore = qualityScore(
    metrics,
    violations.length,
    maxChars,
    maxBullets,
    caveatLimit
  );

  return {
    ok: violations.length === 0,
    violations,
    metrics
  };
}
