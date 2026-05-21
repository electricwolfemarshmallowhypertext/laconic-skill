import { createHash } from "node:crypto";

export const HASH_EMBEDDING_DIMENSIONS = 64;

export function normalizeMemoryText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function textHashHex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashEmbedText(
  text: string,
  dimensions: number = HASH_EMBEDDING_DIMENSIONS
): number[] {
  if (!Number.isFinite(dimensions) || dimensions <= 0) {
    throw new Error("Embedding dimensions must be a positive number.");
  }

  const normalized = normalizeMemoryText(text);
  const vector = new Array<number>(dimensions);
  let position = 0;
  let round = 0;

  while (position < dimensions) {
    const digest = createHash("sha256")
      .update(normalized, "utf8")
      .update("|", "utf8")
      .update(String(round), "utf8")
      .digest();

    for (let index = 0; index < digest.length && position < dimensions; index += 1) {
      vector[position] = (digest[index] / 255) * 2 - 1;
      position += 1;
    }
    round += 1;
  }

  const mean = vector.reduce((sum, value) => sum + value, 0) / dimensions;
  const centered = vector.map((value) => value - mean);
  const norm = Math.sqrt(centered.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    return centered;
  }

  return centered.map((value) => Number((value / norm).toFixed(10)));
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) {
    return -1;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return -1;
  }

  return dot / Math.sqrt(leftNorm * rightNorm);
}
