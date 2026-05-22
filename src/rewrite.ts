import {
  VerifierOptions,
  countCaveatWords,
  isBannedPreamble,
  normalizeVerifierOptions,
  normalizeForComparison,
  verifyText
} from "./verifier";

const REDUNDANT_CLOSERS = [
  "hope this helps",
  "let me know if you have any questions",
  "happy to help",
  "thanks for asking"
];

const RECAP_OPENINGS = [/^to recap[,:\s]/i, /^in summary[,:\s]/i];
const CAVEAT_WORD_GLOBAL =
  /\b(maybe|depends|perhaps|possibly|likely|generally|typically|might|could|probably)\b/gi;
const BULLET_PATTERN = /^\s*(?:[-*+]|(?:\d+\.))\s+/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesPromptLine(line: string, prompt: string | undefined): boolean {
  if (!prompt) {
    return false;
  }

  const lineNorm = normalizeForComparison(line);
  const promptNorm = normalizeForComparison(prompt);
  if (promptNorm.length < 16) {
    return false;
  }

  return (
    lineNorm === promptNorm ||
    lineNorm.startsWith(promptNorm) ||
    promptNorm.startsWith(lineNorm)
  );
}

function stripLeadingNoise(
  lines: string[],
  bannedPreambles: string[],
  userPrompt: string | undefined
): string[] {
  const working = [...lines];
  while (working.length > 0) {
    const line = working[0].trim();
    if (!line) {
      working.shift();
      continue;
    }

    const recap = RECAP_OPENINGS.some((pattern) => pattern.test(line));
    if (recap || isBannedPreamble(line, bannedPreambles) || matchesPromptLine(line, userPrompt)) {
      working.shift();
      continue;
    }

    break;
  }
  return working;
}

function removeFillerPhrases(text: string, bannedFillerPhrases: string[]): string {
  let next = text;
  for (const phrase of bannedFillerPhrases) {
    const pattern = new RegExp(escapeRegExp(phrase), "gi");
    next = next.replace(pattern, "");
  }

  return next
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?]){2,}/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+\n/g, "\n\n");
}

function removeRedundantClosers(text: string): string {
  const lines = text.split("\n");
  while (lines.length > 0) {
    const last = lines[lines.length - 1].trim().toLowerCase();
    if (!last) {
      lines.pop();
      continue;
    }

    const isCloser = REDUNDANT_CLOSERS.some(
      (closer) =>
        last === closer ||
        last.startsWith(`${closer}.`) ||
        last.startsWith(`${closer}!`)
    );

    if (!isCloser) {
      break;
    }
    lines.pop();
  }
  return lines.join("\n");
}

function capBullets(text: string, maxBullets: number): string {
  if (maxBullets < 0) {
    return text;
  }

  const lines = text.split("\n");
  let seenBullets = 0;
  const kept: string[] = [];
  for (const line of lines) {
    if (BULLET_PATTERN.test(line)) {
      seenBullets += 1;
      if (seenBullets > maxBullets) {
        continue;
      }
    }
    kept.push(line);
  }
  return kept.join("\n");
}

function enforceCaveatLimit(text: string, caveatLimit: number | null): string {
  if (caveatLimit === null || caveatLimit < 0) {
    return text;
  }

  const lines = text.split("\n");
  let seenCaveats = 0;
  const kept: string[] = [];

  for (const line of lines) {
    const caveatsInLine = countCaveatWords(line);
    if (caveatsInLine === 0) {
      kept.push(line);
      continue;
    }

    if (seenCaveats + caveatsInLine <= caveatLimit) {
      kept.push(line);
      seenCaveats += caveatsInLine;
      continue;
    }

    if (seenCaveats < caveatLimit) {
      const trimmedLine = line.replace(CAVEAT_WORD_GLOBAL, (match) => {
        if (seenCaveats < caveatLimit) {
          seenCaveats += 1;
          return match;
        }
        return "";
      });
      const normalized = trimmedLine
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\s+([,.;:!?])/g, "$1")
        .trim();
      if (normalized) {
        kept.push(normalized);
      }
    }
  }

  return kept.join("\n");
}

function trimToMaxChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  const head = text.slice(0, maxChars);
  const sentenceBreak = Math.max(
    head.lastIndexOf(". "),
    head.lastIndexOf("! "),
    head.lastIndexOf("? "),
    head.lastIndexOf("\n")
  );

  if (sentenceBreak >= Math.floor(maxChars * 0.5)) {
    return head.slice(0, sentenceBreak + 1).trimEnd();
  }

  let safeHead = head.trimEnd();
  const nextChar = text[safeHead.length] ?? "";
  const lastChar = safeHead[safeHead.length - 1] ?? "";
  const cutInsideToken = /\S/.test(lastChar) && /\S/.test(nextChar);
  if (cutInsideToken) {
    const lastWhitespace = safeHead.search(/\s\S*$/);
    if (lastWhitespace > 0) {
      safeHead = safeHead.slice(0, lastWhitespace).trimEnd();
    }
  }
  return safeHead;
}

function cleanup(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?]){2,}/g, "$1")
    .trim();
}

export function rewriteText(
  response: string,
  options: VerifierOptions = {}
): string {
  if (verifyText(response, options).ok) {
    return response;
  }

  const normalizedOptions = normalizeVerifierOptions(options);
  const maxChars = normalizedOptions.maxChars;
  const maxBullets = normalizedOptions.maxBullets;
  const caveatLimit = normalizedOptions.caveatLimit;
  const bannedFillerPhrases = normalizedOptions.bannedFillerPhrases;
  const bannedPreambles = normalizedOptions.bannedPreambles;

  let working = response.replace(/\r\n/g, "\n").trim();
  if (!working) {
    return working;
  }

  let lines = stripLeadingNoise(
    working.split("\n"),
    bannedPreambles,
    options.userPrompt
  );
  working = lines.join("\n");
  working = removeFillerPhrases(working, bannedFillerPhrases);
  working = removeRedundantClosers(working);
  working = capBullets(working, maxBullets);
  working = enforceCaveatLimit(working, caveatLimit);
  working = trimToMaxChars(working, maxChars);
  working = cleanup(working);

  lines = stripLeadingNoise(working.split("\n"), bannedPreambles, options.userPrompt);
  working = cleanup(lines.join("\n"));

  return working;
}
