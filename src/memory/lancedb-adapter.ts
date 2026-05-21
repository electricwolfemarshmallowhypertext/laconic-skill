import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { connect, type Connection, type Table } from "@lancedb/lancedb";
import { compareCodepointStable } from "../deterministic";
import {
  HASH_EMBEDDING_DIMENSIONS,
  cosineSimilarity,
  hashEmbedText,
  normalizeMemoryText,
  textHashHex
} from "./hash-embedding";
import type {
  StyleMemoryAddInput,
  StyleMemoryAdapter,
  StyleMemoryRecord,
  StyleMemorySearchOptions,
  StyleMemorySearchResult
} from "./types";

const DEFAULT_MEMORY_DIR = ".laconic/memory";
const DEFAULT_TABLE_NAME = "style_memory";
const DISABLED_MEMORY_DIRS = new Set<string>();
const DISABLED_SENTINEL_FILE = ".lancedb-disabled";

interface LanceDbStyleMemoryAdapterOptions {
  memoryDir?: string;
  tableName?: string;
  dimensions?: number;
}

interface PersistedFallbackData {
  records: StyleMemoryRecord[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseRow(value: Record<string, unknown>): StyleMemoryRecord {
  return {
    id: String(value.id),
    text_hash: String(value.text_hash),
    input_text:
      value.input_text === undefined || value.input_text === null
        ? undefined
        : String(value.input_text),
    output_text: String(value.output_text),
    task_type: String(value.task_type) as StyleMemoryRecord["task_type"],
    outcome: String(value.outcome) as StyleMemoryRecord["outcome"],
    violations: Array.isArray(value.violations)
      ? value.violations.map((item) => String(item))
      : [],
    metrics: (value.metrics ?? {}) as StyleMemoryRecord["metrics"],
    receipt_hash: String(value.receipt_hash),
    created_at: String(value.created_at),
    vector: Array.isArray(value.vector)
      ? value.vector.map((item) => Number(item))
      : []
  };
}

function isCompatibleTask(recordTask: string, requestedTask: string | undefined): boolean {
  return requestedTask === undefined || recordTask === requestedTask;
}

function isCompatibleOutcome(
  recordOutcome: string,
  requestedOutcomes: string[] | undefined
): boolean {
  return requestedOutcomes === undefined || requestedOutcomes.includes(recordOutcome);
}

function compareScoresDesc(left: number, right: number): number {
  if (left === right) {
    return 0;
  }
  return left > right ? -1 : 1;
}

function toLanceRow(record: StyleMemoryRecord): Record<string, unknown> {
  return {
    id: record.id,
    text_hash: record.text_hash,
    input_text: record.input_text ?? null,
    output_text: record.output_text,
    task_type: record.task_type,
    outcome: record.outcome,
    violations: [...record.violations],
    metrics: clone(record.metrics),
    receipt_hash: record.receipt_hash,
    created_at: record.created_at,
    vector: [...record.vector]
  };
}

export class LanceDbStyleMemoryAdapter implements StyleMemoryAdapter {
  private readonly memoryDir: string;
  private readonly tableName: string;
  private readonly dimensions: number;
  private readonly fallbackPath: string;
  private readonly disabledSentinelPath: string;
  private connection: Connection | null = null;
  private lancedbDisabled = false;

  constructor(options: LanceDbStyleMemoryAdapterOptions = {}) {
    this.memoryDir = resolve(options.memoryDir ?? DEFAULT_MEMORY_DIR);
    this.tableName = options.tableName ?? DEFAULT_TABLE_NAME;
    this.dimensions = options.dimensions ?? HASH_EMBEDDING_DIMENSIONS;
    this.fallbackPath = join(this.memoryDir, "fallback-memory.json");
    this.disabledSentinelPath = join(this.memoryDir, DISABLED_SENTINEL_FILE);
    this.lancedbDisabled =
      DISABLED_MEMORY_DIRS.has(this.memoryDir) || existsSync(this.disabledSentinelPath);
    mkdirSync(this.memoryDir, { recursive: true });
  }

  async add(input: StyleMemoryAddInput): Promise<StyleMemoryRecord> {
    const createdAt = input.created_at ?? nowIso();
    const normalizedOutput = normalizeMemoryText(input.output_text);
    const vector = hashEmbedText(input.output_text, this.dimensions);
    const textHash = textHashHex(normalizedOutput);
    const id = textHashHex(
      `${textHash}|${input.receipt_hash}|${input.outcome}|${createdAt}`
    ).slice(0, 24);

    const record: StyleMemoryRecord = {
      id,
      text_hash: textHash,
      input_text: input.input_text,
      output_text: input.output_text,
      task_type: input.task_type,
      outcome: input.outcome,
      violations: [...input.violations],
      metrics: clone(input.metrics),
      receipt_hash: input.receipt_hash,
      created_at: createdAt,
      vector
    };

    try {
      await this.addWithLanceDb(record);
      return record;
    } catch {
      this.markLanceDbDisabled();
      this.addToFallback(record);
      return record;
    }
  }

  async search(
    query: string,
    options: StyleMemorySearchOptions = {}
  ): Promise<StyleMemorySearchResult[]> {
    const limit = options.limit ?? 5;
    const outcomes = options.outcomes;
    const taskType = options.task_type;
    const queryVector = hashEmbedText(query, this.dimensions);

    if (this.lancedbDisabled) {
      return this.searchFallback(queryVector, options);
    }

    try {
      const rows = await this.searchWithLanceDb(queryVector, Math.max(limit * 5, limit));
      const filtered = rows
        .filter((row) => isCompatibleTask(row.record.task_type, taskType))
        .filter((row) => isCompatibleOutcome(row.record.outcome, outcomes));
      if (filtered.length === 0) {
        return this.searchFallback(queryVector, options);
      }
      filtered.sort((left, right) => {
        const scoreOrder = compareScoresDesc(left.score, right.score);
        if (scoreOrder !== 0) {
          return scoreOrder;
        }
        return compareCodepointStable(left.record.id, right.record.id);
      });
      return filtered.slice(0, limit);
    } catch {
      this.markLanceDbDisabled();
      return this.searchFallback(queryVector, options);
    }
  }

  private markLanceDbDisabled(): void {
    this.lancedbDisabled = true;
    DISABLED_MEMORY_DIRS.add(this.memoryDir);
    try {
      writeFileSync(this.disabledSentinelPath, "disabled\n", "utf8");
    } catch {
      // Ignore sentinel write failures; in-process fallback still works.
    }
  }

  private async getConnection(): Promise<Connection> {
    if (this.connection !== null) {
      return this.connection;
    }
    this.connection = await connect(this.memoryDir);
    return this.connection;
  }

  private async openTable(): Promise<Table | null> {
    if (this.lancedbDisabled) {
      return null;
    }

    const connection = await this.getConnection();
    const tableNames = await connection.tableNames();
    if (!tableNames.includes(this.tableName)) {
      return null;
    }
    return connection.openTable(this.tableName);
  }

  private async addWithLanceDb(record: StyleMemoryRecord): Promise<void> {
    if (this.lancedbDisabled) {
      throw new Error("LanceDB disabled.");
    }

    const existingTable = await this.openTable();
    if (existingTable === null) {
      const connection = await this.getConnection();
      await connection.createTable(this.tableName, [toLanceRow(record)], {
        mode: "create",
        existOk: true
      });
      return;
    }
    await existingTable.add([toLanceRow(record)]);
  }

  private async searchWithLanceDb(
    queryVector: number[],
    limit: number
  ): Promise<StyleMemorySearchResult[]> {
    const table = await this.openTable();
    if (table === null) {
      return [];
    }

    const rows = (await table.search(queryVector).limit(limit).toArray()) as Array<
      Record<string, unknown>
    >;

    return rows.map((row) => {
      const distance = Number(row._distance ?? Number.POSITIVE_INFINITY);
      return {
        score: Number.isFinite(distance) ? -distance : -1,
        record: parseRow(row)
      };
    });
  }

  private addToFallback(record: StyleMemoryRecord): void {
    const data = this.loadFallback();
    data.records.push(record);
    writeFileSync(this.fallbackPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  private loadFallback(): PersistedFallbackData {
    try {
      const raw = readFileSync(this.fallbackPath, "utf8");
      const parsed = JSON.parse(raw) as PersistedFallbackData;
      if (!Array.isArray(parsed.records)) {
        return { records: [] };
      }
      return {
        records: parsed.records.map((record) => ({
          ...record,
          violations: Array.isArray(record.violations) ? [...record.violations] : [],
          vector: Array.isArray(record.vector) ? [...record.vector] : []
        }))
      };
    } catch {
      return { records: [] };
    }
  }

  private searchFallback(
    queryVector: number[],
    options: StyleMemorySearchOptions
  ): StyleMemorySearchResult[] {
    const limit = options.limit ?? 5;
    const taskType = options.task_type;
    const outcomes = options.outcomes;
    const rows = this.loadFallback().records;

    const ranked = rows
      .filter((row) => isCompatibleTask(row.task_type, taskType))
      .filter((row) => isCompatibleOutcome(row.outcome, outcomes))
      .map((row) => ({
        score: cosineSimilarity(queryVector, row.vector),
        record: row
      }));

    ranked.sort((left, right) => {
      const scoreOrder = compareScoresDesc(left.score, right.score);
      if (scoreOrder !== 0) {
        return scoreOrder;
      }
      return compareCodepointStable(left.record.id, right.record.id);
    });

    return ranked.slice(0, limit);
  }
}

export function createDefaultStyleMemoryAdapter(
  options: LanceDbStyleMemoryAdapterOptions = {}
): StyleMemoryAdapter {
  const memoryDir = options.memoryDir ?? resolve(DEFAULT_MEMORY_DIR);
  mkdirSync(dirname(memoryDir), { recursive: true });
  return new LanceDbStyleMemoryAdapter({ ...options, memoryDir });
}
