export interface PreservationMetrics {
  [key: string]: number | boolean | string[];
  inputSubstantiveTokens: number;
  outputSubstantiveTokens: number;
  retainedSubstantiveTokenRatio: number;
  introducedSubstantiveTokens: string[];
  outputTokensSubsetOfInput: boolean;
}

function substantiveTokens(value: string): Set<string> {
  return new Set(
    (value.toLowerCase().match(/[a-z0-9`'-]+/g) ?? []).filter(
      (token) => token.length >= 3 || /[0-9]/.test(token)
    )
  );
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

export function measurePreservation(
  input: string,
  output: string
): PreservationMetrics {
  const inputTokens = substantiveTokens(input);
  const outputTokens = substantiveTokens(output);
  const introduced = [...outputTokens]
    .filter((token) => !inputTokens.has(token))
    .sort();
  const retained = [...inputTokens].filter((token) => outputTokens.has(token));

  return {
    inputSubstantiveTokens: inputTokens.size,
    outputSubstantiveTokens: outputTokens.size,
    retainedSubstantiveTokenRatio:
      inputTokens.size === 0 ? 1 : round(retained.length / inputTokens.size),
    introducedSubstantiveTokens: introduced,
    outputTokensSubsetOfInput: introduced.length === 0
  };
}
