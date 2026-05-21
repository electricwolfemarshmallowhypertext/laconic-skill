import type { CorrectnessTaskType } from "../correctness";
import type { JsonValue } from "../receipt";

export type StyleMemoryOutcome = "accepted" | "rejected" | "rewritten";

export interface StyleMemoryRecord {
  id: string;
  text_hash: string;
  input_text?: string;
  output_text: string;
  task_type: CorrectnessTaskType;
  outcome: StyleMemoryOutcome;
  violations: string[];
  metrics: JsonValue;
  receipt_hash: string;
  created_at: string;
  vector: number[];
}

export interface StyleMemoryAddInput {
  input_text?: string;
  output_text: string;
  task_type: CorrectnessTaskType;
  outcome: StyleMemoryOutcome;
  violations: string[];
  metrics: JsonValue;
  receipt_hash: string;
  created_at?: string;
}

export interface StyleMemorySearchOptions {
  limit?: number;
  task_type?: CorrectnessTaskType;
  outcomes?: StyleMemoryOutcome[];
}

export interface StyleMemorySearchResult {
  score: number;
  record: StyleMemoryRecord;
}

export interface StyleMemoryAdapter {
  add(input: StyleMemoryAddInput): Promise<StyleMemoryRecord>;
  search(
    query: string,
    options?: StyleMemorySearchOptions
  ): Promise<StyleMemorySearchResult[]>;
}
