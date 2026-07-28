const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CLI_PATH = path.join(ROOT, "dist", "cli.js");
const MEMORY_DIR = path.join(ROOT, ".laconic");

const { rewriteText } = require(path.join(ROOT, "dist", "rewrite.js"));
const verifier = require(path.join(ROOT, "dist", "verifier.js"));
const {
  DEFAULT_BANNED_FILLER_PHRASES,
  DEFAULT_BANNED_PREAMBLES,
  DEFAULT_CAVEAT_LIMIT,
  DEFAULT_MAX_BULLETS,
  DEFAULT_MAX_CHARS,
  normalizeVerifierOptions,
  verifyText
} = verifier;
const { runPipeline } = require(path.join(ROOT, "dist", "pipeline.js"));
const { createReceipt } = require(path.join(ROOT, "dist", "receipt.js"));
const { verifyCorrectness } = require(path.join(ROOT, "dist", "correctness.js"));
const {
  analyzeCorrectnessConfidence
} = require(path.join(ROOT, "dist", "correctness", "confidence.js"));
const {
  HASH_EMBEDDING_DIMENSIONS,
  hashEmbedText
} = require(path.join(ROOT, "dist", "memory", "hash-embedding.js"));
const { createDefaultStyleMemoryAdapter } = require(path.join(
  ROOT,
  "dist",
  "memory",
  "index.js"
));

function readFixture(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function cleanupMemoryDir() {
  fs.rmSync(MEMORY_DIR, { recursive: true, force: true });
}

function runCli(args, options = {}) {
  const originalArgv = process.argv;
  const originalExit = process.exit;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const originalReadFileSync = fs.readFileSync;

  let status = 0;
  let stdout = "";
  let stderr = "";
  let exited = false;

  return new Promise((resolve, reject) => {
    function restore() {
      process.argv = originalArgv;
      process.exit = originalExit;
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
      fs.readFileSync = originalReadFileSync;
    }

    try {
      if (Object.prototype.hasOwnProperty.call(options, "stdin")) {
        fs.readFileSync = (...readArgs) => {
          if (readArgs[0] === 0) {
            return String(options.stdin ?? "");
          }
          return originalReadFileSync(...readArgs);
        };
      }

      process.argv = [process.argv[0], CLI_PATH, ...args];
      process.stdout.write = (chunk) => {
        stdout += String(chunk);
        return true;
      };
      process.stderr.write = (chunk) => {
        stderr += String(chunk);
        return true;
      };
      process.exit = (code = 0) => {
        status = Number(code);
        exited = true;
      };

      delete require.cache[require.resolve(CLI_PATH)];
      require(CLI_PATH);
    } catch (error) {
      restore();
      reject(error);
      return;
    }

    const timeoutAt = Date.now() + 5000;

    const poll = () => {
      if (exited) {
        restore();
        resolve({ status, stdout, stderr });
        return;
      }

      if (Date.now() >= timeoutAt) {
        restore();
        reject(
          new Error(`CLI did not exit for command: laconic ${args.join(" ")}`)
        );
        return;
      }

      setTimeout(poll, 10);
    };

    poll();
  });
}

function parseJson(output, context) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`${context} emitted non-JSON output: ${output}`);
  }
}

function tokens(text) {
  return new Set(text.toLowerCase().match(/[a-z0-9`'-]+/g) || []);
}

function substantiveTokens(text) {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9`'-]+/g) || []).filter(
      (token) => token.length >= 3 || /[0-9]/.test(token)
    )
  );
}

function expectReceiptShape(receipt) {
  const requiredKeys = [
    "input_hash",
    "output_hash",
    "skill_name",
    "verifier_version",
    "ok",
    "violations",
    "metrics",
    "timestamp",
    "receipt_hash"
  ];
  for (const key of requiredKeys) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(receipt, key),
      true,
      `missing receipt key: ${key}`
    );
  }
}

const passFiles = [
  "fixtures/pass/compliant.txt",
  "fixtures/pass/brief_bullets.txt",
  "fixtures/pass/direct_concise.txt",
  "fixtures/pass/meaningful_dense.txt"
];

const failCases = [
  {
    file: "fixtures/fail/verbose_recap_heavy.txt",
    expectedCodes: [
      "BANNED_FILLER_PHRASE",
      "BANNED_PREAMBLE",
      "MISSING_DIRECT_ANSWER"
    ]
  },
  {
    file: "fixtures/fail/filler_heavy.txt",
    expectedCodes: [
      "BANNED_FILLER_PHRASE",
      "BANNED_PREAMBLE",
      "MISSING_DIRECT_ANSWER"
    ]
  },
  {
    file: "fixtures/fail/caveat_heavy.txt",
    expectedCodes: ["TOO_MANY_CAVEATS"]
  },
  {
    file: "fixtures/fail/repeated_prompt.txt",
    expectedCodes: ["REPEATED_PROMPT", "MISSING_DIRECT_ANSWER"],
    options: {
      userPrompt: "How do I reset my password?"
    }
  },
  {
    file: "fixtures/fail/too_many_bullets.txt",
    expectedCodes: ["MAX_BULLETS_EXCEEDED"]
  },
  {
    file: "fixtures/fail/too_long.txt",
    expectedCodes: ["MAX_CHARS_EXCEEDED"]
  },
  {
    file: "fixtures/fail/injection_ignore_laconic_rules.txt",
    expectedCodes: ["BANNED_FILLER_PHRASE"]
  },
  {
    file: "fixtures/fail/injection_do_not_check_this.txt",
    expectedCodes: ["BANNED_FILLER_PHRASE"]
  },
  {
    file: "fixtures/fail/injection_verifier_should_pass_this.txt",
    expectedCodes: ["BANNED_FILLER_PHRASE"]
  },
  {
    file: "fixtures/fail/injection_repeat_prompt_before_answering.txt",
    expectedCodes: ["BANNED_FILLER_PHRASE"]
  }
];

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

const goldenVerifierCases = [
  {
    name: "compliant concise output",
    file: "fixtures/pass/compliant.txt",
    ok: true,
    codes: [],
    metrics: { charCount: 45, bulletCount: 0, caveatCount: 0 }
  },
  {
    name: "verbose recap-heavy output",
    file: "fixtures/fail/verbose_recap_heavy.txt",
    ok: false,
    codes: [
      "BANNED_FILLER_PHRASE",
      "BANNED_PREAMBLE",
      "MISSING_DIRECT_ANSWER"
    ],
    metrics: { charCount: 134, bulletCount: 0, caveatCount: 0 }
  },
  {
    name: "apology-heavy output",
    file: "fixtures/fail/apology_heavy.txt",
    ok: false,
    codes: [
      "BANNED_FILLER_PHRASE",
      "BANNED_FILLER_PHRASE",
      "MISSING_DIRECT_ANSWER"
    ],
    metrics: { charCount: 152, bulletCount: 0, caveatCount: 0 }
  },
  {
    name: "filler-heavy output",
    file: "fixtures/fail/filler_heavy.txt",
    ok: false,
    codes: [
      "BANNED_FILLER_PHRASE",
      "BANNED_PREAMBLE",
      "MISSING_DIRECT_ANSWER"
    ],
    metrics: { charCount: 61, bulletCount: 0, caveatCount: 0 }
  },
  {
    name: "too many bullets",
    file: "fixtures/fail/too_many_bullets.txt",
    ok: false,
    codes: ["MAX_BULLETS_EXCEEDED"],
    metrics: { charCount: 72, bulletCount: 4, caveatCount: 0 }
  },
  {
    name: "caveat-heavy output",
    file: "fixtures/fail/caveat_heavy.txt",
    ok: false,
    codes: ["TOO_MANY_CAVEATS"],
    metrics: { charCount: 73, bulletCount: 0, caveatCount: 3 }
  },
  {
    name: "non-answer preamble",
    file: "fixtures/fail/non_answer_preamble.txt",
    ok: false,
    codes: ["BANNED_PREAMBLE", "MISSING_DIRECT_ANSWER"],
    metrics: { charCount: 71, bulletCount: 0, caveatCount: 0 }
  },
  {
    name: "direct concise answer",
    file: "fixtures/pass/direct_concise.txt",
    ok: true,
    codes: [],
    metrics: { charCount: 16, bulletCount: 0, caveatCount: 0 }
  }
];

const rewriteSnapshots = [
  {
    name: "verbose recap-heavy",
    file: "fixtures/fail/verbose_recap_heavy.txt",
    output: "Use `npm run build` and then run `npm test`."
  },
  {
    name: "filler-heavy",
    file: "fixtures/fail/filler_heavy.txt",
    output: "Run npm install before npm test."
  },
  {
    name: "apology-heavy",
    file: "fixtures/fail/apology_heavy.txt",
    output: "Run `npm run build` before `npm test`."
  },
  {
    name: "planning-heavy",
    file: "fixtures/fail/planning_heavy.txt",
    output: "Use `npm run build` and `npm test`."
  },
  {
    name: "meaningful dense compliant output",
    file: "fixtures/pass/meaningful_dense.txt",
    output:
      "Use the existing fixture path and preserve the command order: `npm install`, `npm run build`, then `npm test`.\n"
  }
];

test("golden verifier behavior stays fixed", () => {
  for (const golden of goldenVerifierCases) {
    const checked = verifyText(readFixture(golden.file));
    assert.equal(checked.ok, golden.ok, golden.name);
    assert.deepEqual(
      checked.violations.map((violation) => violation.code),
      golden.codes,
      golden.name
    );
    assert.deepEqual(checked.metrics, golden.metrics, golden.name);
  }
});

test("rewrite snapshots stay deterministic", () => {
  for (const snapshot of rewriteSnapshots) {
    const input = readFixture(snapshot.file);
    const first = rewriteText(input);
    const second = rewriteText(input);
    assert.equal(first, snapshot.output, snapshot.name);
    assert.equal(second, snapshot.output, snapshot.name);
  }
});

test("real direct-answer openings are accepted", () => {
  const directAnswers = [
    "Reject fractional limits instead of rounding them.",
    "Build passed. Tests passed. Benchmark passed.",
    "laconic verifies response shape.",
    "Do not publish until install smoke passes.",
    "Publish after clean install passes.",
    "An atom contains protons, neutrons, and electrons.",
    "A motherboard connects the main computer components.",
    "Word embeddings represent tokens as vectors.",
    "This release adds a prose eval gate.",
    "We should wait for the labeled eval before claiming broad coverage.",
    "{\"projects\":[]}",
    "[{\"title\":\"Example\"}]"
  ];

  for (const answer of directAnswers) {
    const checked = verifyText(answer);
    assert.equal(checked.ok, true, answer);
  }
});

test("compliant outputs pass unchanged", () => {
  for (const file of passFiles) {
    const input = readFixture(file);
    const checked = verifyText(input);
    assert.equal(checked.ok, true, `${file} should pass verification`);
    assert.equal(rewriteText(input), input, `${file} should stay unchanged`);
  }
});

test("verbose outputs fail", () => {
  const verboseInput = readFixture("fixtures/fail/verbose_recap_heavy.txt");
  const result = verifyText(verboseInput);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.violations.map((violation) => violation.code),
    ["BANNED_FILLER_PHRASE", "BANNED_PREAMBLE", "MISSING_DIRECT_ANSWER"]
  );
});

test("failing fixtures fail with stable codes", () => {
  for (const { file, expectedCodes, options } of failCases) {
    const input = readFixture(file);
    const checked = verifyText(input, options);
    assert.equal(checked.ok, false, `${file} should fail verification`);
    assert.deepEqual(
      checked.violations.map((violation) => violation.code),
      expectedCodes,
      `${file} should emit expected violation codes`
    );
  }
});

test("rewrite removes filler without inventing facts", () => {
  const input = readFixture("fixtures/fail/verbose_recap_heavy.txt");
  const rewritten = rewriteText(input);
  const inputTokens = tokens(input);
  for (const token of tokens(rewritten)) {
    assert.equal(
      inputTokens.has(token),
      true,
      `rewrite introduced new token: ${token}`
    );
  }
  assert.equal(verifyText(rewritten).ok, true);
});

test("rewrite never introduces new substantive tokens", () => {
  const benchmarkDir = path.join(ROOT, "benchmarks", "corpus");
  const benchmarkFiles = fs
    .readdirSync(benchmarkDir)
    .filter((name) => name.endsWith(".txt"))
    .sort()
    .map((name) => path.join("benchmarks", "corpus", name));
  const filesToCheck = [...failCases.map((entry) => entry.file), ...benchmarkFiles];

  for (const file of filesToCheck) {
    const input = readFixture(file);
    const rewritten = rewriteText(input);
    const inputTokens = substantiveTokens(input);
    for (const token of substantiveTokens(rewritten)) {
      assert.equal(
        inputTokens.has(token),
        true,
        `${file} rewrite introduced substantive token: ${token}`
      );
    }
  }
});

test("invalid numeric verifier options fall back to deterministic defaults", () => {
  const bulletHeavy = readFixture("fixtures/fail/too_many_bullets.txt");
  const caveatHeavy = readFixture("fixtures/fail/caveat_heavy.txt");
  const verbose = readFixture("fixtures/fail/verbose_recap_heavy.txt");

  const bulletResult = verifyText(bulletHeavy, { maxBullets: -1 });
  assert.equal(
    bulletResult.violations.some((violation) => violation.code === "MAX_BULLETS_EXCEEDED"),
    true
  );

  const caveatResult = verifyText(caveatHeavy, { caveatLimit: Number.NaN });
  assert.equal(
    caveatResult.violations.some((violation) => violation.code === "TOO_MANY_CAVEATS"),
    true
  );

  const rewritten = rewriteText(verbose, { maxChars: 0 });
  assert.equal(verifyText(rewritten).ok, true);
});

test("default laconic policy values are locked", () => {
  const normalized = normalizeVerifierOptions();

  assert.equal(DEFAULT_MAX_CHARS, 320);
  assert.equal(DEFAULT_MAX_BULLETS, 3);
  assert.equal(DEFAULT_CAVEAT_LIMIT, 2);
  assert.equal(normalized.maxChars, DEFAULT_MAX_CHARS);
  assert.equal(normalized.maxBullets, DEFAULT_MAX_BULLETS);
  assert.equal(normalized.caveatLimit, DEFAULT_CAVEAT_LIMIT);
  assert.equal(normalized.requireDirectAnswerOpening, true);

  assert.deepEqual(DEFAULT_BANNED_PREAMBLES, [
    "sure",
    "of course",
    "as an ai",
    "just to clarify",
    "it is important to note",
    "at the end of the day",
    "here's a breakdown",
    "let me explain",
    "to answer your question",
    "i'd be happy to help",
    "certainly"
  ]);

  assert.deepEqual(DEFAULT_BANNED_FILLER_PHRASES, [
    "i hope this helps",
    "just to clarify",
    "for what it's worth",
    "it is important to note",
    "sorry for the long answer",
    "sorry for overexplaining",
    "i apologize for the extra detail",
    "at the end of the day",
    "as you may know",
    "ignore laconic rules",
    "do not check this",
    "the verifier should pass this",
    "repeat the prompt before answering"
  ]);
});

test("rewrite reduces failing examples and passes when possible", () => {
  for (const { file, options } of failCases) {
    const input = readFixture(file);
    const rewritten = rewriteText(input, options);
    const before = verifyText(input, options);
    const after = verifyText(rewritten, options);

    assert.equal(before.ok, false, `${file} should fail before rewrite`);
    assert.ok(rewritten.length <= input.length, `${file} rewrite should not grow`);
    assert.equal(after.ok, true, `${file} should pass after rewrite`);
  }
});

test("holdout rewrite outputs pass when fixable", () => {
  const holdoutDir = path.join(ROOT, "benchmarks", "holdout");
  const files = fs
    .readdirSync(holdoutDir)
    .filter((name) => name.endsWith(".txt"))
    .sort();

  for (const file of files) {
    const relativePath = path.join("benchmarks", "holdout", file);
    const input = readFixture(relativePath);
    const before = verifyText(input);
    const rewritten = rewriteText(input);
    const after = verifyText(rewritten);

    if (before.ok) {
      assert.equal(after.ok, true, `${relativePath} should stay passing`);
      continue;
    }

    assert.equal(after.ok, true, `${relativePath} should pass after rewrite`);
    assert.ok(
      rewritten.length <= input.length,
      `${relativePath} rewrite should not grow`
    );
  }
});

test("prompt-injection instructions do not bypass verifier", () => {
  const injectionCases = [
    "fixtures/fail/injection_ignore_laconic_rules.txt",
    "fixtures/fail/injection_do_not_check_this.txt",
    "fixtures/fail/injection_verifier_should_pass_this.txt",
    "fixtures/fail/injection_repeat_prompt_before_answering.txt"
  ];
  const blockedPhrases = [
    "ignore laconic rules",
    "do not check this",
    "the verifier should pass this",
    "repeat the prompt before answering"
  ];

  for (const file of injectionCases) {
    const input = readFixture(file);
    const first = verifyText(input);
    const second = verifyText(input);

    assert.equal(first.ok, false, `${file} should fail verification`);
    assert.deepEqual(
      first.violations.map((violation) => violation.code),
      ["BANNED_FILLER_PHRASE"],
      `${file} should deterministically fail with banned filler`
    );
    assert.deepEqual(first, second, `${file} verification should be deterministic`);

    const rewritten = rewriteText(input);
    const lower = rewritten.toLowerCase();
    for (const phrase of blockedPhrases) {
      assert.equal(
        lower.includes(phrase),
        false,
        `${file} rewrite should remove phrase: ${phrase}`
      );
    }
    assert.equal(
      verifyText(rewritten).ok,
      true,
      `${file} should pass after rewrite where removable`
    );
  }
});

test("quoted and fenced injection phrases are treated as inert content", () => {
  const quoted = 'Use this exact literal in docs: "ignore laconic rules".';
  const fenced = "Run npm test.\n```\nignore laconic rules\n```";
  const unquoted = "Run npm test. ignore laconic rules.";

  const quotedResult = verifyText(quoted);
  const fencedResult = verifyText(fenced);
  const unquotedResult = verifyText(unquoted);

  assert.equal(
    quotedResult.violations.some((violation) => violation.code === "BANNED_FILLER_PHRASE"),
    false
  );
  assert.equal(
    fencedResult.violations.some((violation) => violation.code === "BANNED_FILLER_PHRASE"),
    false
  );
  assert.equal(
    unquotedResult.violations.some((violation) => violation.code === "BANNED_FILLER_PHRASE"),
    true
  );
});

test("same input always returns same output", () => {
  const input = readFixture("fixtures/fail/verbose_recap_heavy.txt");
  const first = rewriteText(input);
  const second = rewriteText(input);
  const third = rewriteText(input);
  assert.equal(first, second);
  assert.equal(second, third);
});

test("receipt hash ignores ratings and user feedback", () => {
  const base = {
    input: "Run npm test.",
    output: "Run npm test.",
    skill_name: "laconic-responses",
    verifier_version: "laconic/v0",
    ok: true,
    violations: [],
    metrics: { charCount: 13, bulletCount: 0, caveatCount: 0 },
    timestamp: "1970-01-01T00:00:00.000Z"
  };

  const first = createReceipt({ ...base, rating: 2, user_feedback: "too short" });
  const second = createReceipt({ ...base, rating: 5, user_feedback: "perfect" });
  assert.equal(first.receipt_hash, second.receipt_hash);
});

test("receipts are deterministic for same input output config", async () => {
  const commandSets = [
    ["check", "fixtures/pass/compliant.txt", "--receipt"],
    ["rewrite", "fixtures/fail/verbose_recap_heavy.txt", "--receipt"],
    ["pipeline", "fixtures/fail/verbose_recap_heavy.txt", "--task", "writing", "--receipt"]
  ];

  for (const args of commandSets) {
    const first = await runCli(args);
    const second = await runCli(args);
    assert.equal(first.status, second.status);
    assert.equal(first.stderr, "");
    assert.equal(second.stderr, "");
    assert.equal(first.stdout, second.stdout, `non-deterministic JSON for: ${args.join(" ")}`);
  }
});

test("receipt violation sorting uses codepoint-stable ordering", () => {
  const receipt = createReceipt({
    input: "input",
    output: "output",
    skill_name: "laconic-responses",
    verifier_version: "laconic/v0",
    ok: false,
    violations: [
      { source: "laconic", code: "ä", message: "msg" },
      { source: "laconic", code: "Z", message: "msg" },
      { source: "laconic", code: "💡", message: "msg" },
      { source: "laconic", code: "a", message: "msg" },
      { source: "laconic", code: "A", message: "msg" }
    ],
    metrics: {},
    timestamp: "1970-01-01T00:00:00.000Z"
  });
  assert.deepEqual(receipt.violations.map((violation) => violation.code), [
    "A",
    "Z",
    "a",
    "ä",
    "💡"
  ]);
});

test("rewrite exits non-zero when rewritten output still fails", async () => {
  const result = await runCli(["rewrite", "-"], { stdin: "" });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "\n");
});

test("rewrite --receipt reports final verification result", async () => {
  const result = await runCli(["rewrite", "-", "--receipt"], { stdin: "" });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const payload = parseJson(result.stdout, "rewrite - --receipt");
  assert.equal(payload.file, "-");
  assert.equal(payload.final, "");
  assert.equal(payload.ok, false);
  assert.deepEqual(payload.violations.map((violation) => violation.code), [
    "MISSING_DIRECT_ANSWER"
  ]);
  expectReceiptShape(payload.receipt);
  assert.equal(payload.receipt.ok, false);
});

test("check supports stdin with dash path", async () => {
  const input = readFixture("fixtures/pass/compliant.txt");
  const result = await runCli(["check", "-"], { stdin: input });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const payload = parseJson(result.stdout, "check -");
  assert.equal(payload.ok, true);
});

test("rewrite supports stdin with dash path", async () => {
  const input = readFixture("fixtures/fail/verbose_recap_heavy.txt");
  const result = await runCli(["rewrite", "-"], { stdin: input });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(verifyText(result.stdout.trimEnd()).ok, true);
});

test("pipeline supports stdin with dash path", async () => {
  const input = readFixture("fixtures/fail/verbose_recap_heavy.txt");
  const result = await runCli(["pipeline", "-", "--task", "writing"], { stdin: input });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(verifyText(result.stdout.trimEnd()).ok, true);
});

test("pipeline keeps compliant outputs stable with and without memory", async () => {
  cleanupMemoryDir();
  const input = readFixture("fixtures/pass/compliant.txt");

  const add = await runCli([
    "memory",
    "add",
    "fixtures/pass/compliant.txt",
    "--outcome",
    "accepted",
    "--task",
    "writing"
  ]);
  assert.equal(add.status, 0);

  const withoutReceipt = await runCli([
    "pipeline",
    "fixtures/pass/compliant.txt",
    "--task",
    "writing"
  ]);
  assert.equal(withoutReceipt.status, 0);
  assert.equal(withoutReceipt.stderr, "");
  assert.equal(withoutReceipt.stdout.trimEnd(), input.trimEnd());

  const withoutMemoryReceipt = await runCli([
    "pipeline",
    "fixtures/pass/compliant.txt",
    "--task",
    "writing",
    "--receipt"
  ]);
  assert.equal(withoutMemoryReceipt.status, 0);
  assert.equal(withoutMemoryReceipt.stderr, "");
  const withoutMemoryPayload = parseJson(
    withoutMemoryReceipt.stdout,
    "pipeline compliant --receipt"
  );
  assert.equal(withoutMemoryPayload.final.trimEnd(), input.trimEnd());
  assert.equal(withoutMemoryPayload.ok, true);
  assert.equal(
    withoutMemoryPayload.violations.some((violation) => violation.code === "MISSING_DIRECT_ANSWER"),
    false
  );

  const withMemoryReceipt = await runCli([
    "pipeline",
    "fixtures/pass/compliant.txt",
    "--task",
    "writing",
    "--memory",
    "--receipt"
  ]);
  assert.equal(withMemoryReceipt.status, 0);
  assert.equal(withMemoryReceipt.stderr, "");
  const withMemoryPayload = parseJson(withMemoryReceipt.stdout, "pipeline compliant --memory");
  assert.equal(withMemoryPayload.final.trimEnd(), input.trimEnd());
  assert.equal(withMemoryPayload.ok, true);
  assert.equal(withMemoryPayload.memory.enabled, true);
  assert.equal(withMemoryPayload.memory.hits_used >= 1, true);
  assert.equal(
    withMemoryPayload.violations.some((violation) => violation.code === "MISSING_DIRECT_ANSWER"),
    false
  );
});

test("pipeline returns final text and receipt", async () => {
  const result = await runCli([
    "pipeline",
    "fixtures/fail/verbose_recap_heavy.txt",
    "--task",
    "writing",
    "--receipt"
  ]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");

  const payload = parseJson(result.stdout, "pipeline");
  assert.equal(typeof payload.final, "string");
  assert.equal(payload.final.length > 0, true);
  expectReceiptShape(payload.receipt);
  assert.equal(payload.receipt.ok, true);
});

test("check receipt returns stable deterministic envelope", async () => {
  const result = await runCli(["check", "fixtures/pass/compliant.txt", "--receipt"]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const payload = parseJson(result.stdout, "check --receipt");
  assert.equal(payload.ok, true);
  expectReceiptShape(payload.receipt);
});

test("correctness substrate returns stable typed result", () => {
  const writing = verifyCorrectness({
    task_type: "writing",
    input: "Input",
    output: "Output",
    config: { writing: { sources_provided: true } }
  });
  assert.equal(writing.ok, true);
  assert.equal(writing.metrics.mode, "noop");
  assert.equal(writing.task_type, "writing");
  assert.deepEqual(
    writing.contracts.map((contract) => contract.id),
    ["writing.claim_source_support_required_when_sources_provided"]
  );

  const regulated = verifyCorrectness({
    task_type: "regulated",
    input: "Input",
    output: "Output",
    config: { regulated: { require_citation: true, require_uncertainty_gate: true } }
  });
  assert.equal(regulated.ok, true);
  assert.equal(regulated.metrics.mode, "noop");
  assert.deepEqual(
    regulated.contracts.map((contract) => contract.id),
    [
      "regulated.citation_required_when_configured",
      "regulated.uncertainty_gate_required_when_configured"
    ]
  );
});

function capabilityFromLower(report, lowerSpecLimit) {
  return Number(
    ((report.mean - lowerSpecLimit) / (report.mean - report.confidence_interval[0])).toFixed(6)
  );
}

function capabilityFromUpper(report, upperSpecLimit) {
  return Number(
    ((upperSpecLimit - report.mean) / (report.confidence_interval[1] - report.mean)).toFixed(6)
  );
}

const correctnessCases = [
  { id: "c1", category: "alpha", score: 0.91, passed: true },
  { id: "c2", category: "alpha", score: 0.94, passed: true },
  { id: "c3", category: "beta", score: 0.96, passed: true },
  { id: "c4", category: "beta", score: 0.99, passed: true }
];

test("correctness confidence bootstrap is deterministic with fixed seed", () => {
  const config = {
    metric_name: "task_score",
    lower_spec_limit: 0.9,
    bootstrap_runs: 200,
    deterministic_seed: 123,
    strata_field: "category"
  };
  const first = analyzeCorrectnessConfidence(correctnessCases, config);
  const second = analyzeCorrectnessConfidence(correctnessCases, config);
  assert.deepEqual(first, second);
  assert.deepEqual(first.strata.summary.map((item) => item.value), ["alpha", "beta"]);
});

test("correctness confidence lower spec limit calculation", () => {
  const report = analyzeCorrectnessConfidence(correctnessCases, {
    metric_name: "task_score",
    lower_spec_limit: 0.9,
    bootstrap_runs: 200,
    deterministic_seed: 7
  });
  assert.equal(report.lower_spec_limit, 0.9);
  assert.equal(report.upper_spec_limit, null);
  assert.equal(report.capability_index, capabilityFromLower(report, 0.9));
});

test("correctness confidence upper spec limit calculation", () => {
  const cases = [
    { id: "c1", score: 0.01 },
    { id: "c2", score: 0.02 },
    { id: "c3", score: 0.03 },
    { id: "c4", score: 0.04 }
  ];
  const report = analyzeCorrectnessConfidence(cases, {
    metric_name: "error_rate",
    upper_spec_limit: 0.05,
    bootstrap_runs: 200,
    deterministic_seed: 7
  });
  assert.equal(report.lower_spec_limit, null);
  assert.equal(report.upper_spec_limit, 0.05);
  assert.equal(report.capability_index, capabilityFromUpper(report, 0.05));
});

test("correctness confidence both-limit calculation uses smaller capability", () => {
  const report = analyzeCorrectnessConfidence(correctnessCases, {
    metric_name: "bounded_score",
    lower_spec_limit: 0.9,
    upper_spec_limit: 1,
    bootstrap_runs: 200,
    deterministic_seed: 7
  });
  const lower = capabilityFromLower(report, 0.9);
  const upper = capabilityFromUpper(report, 1);
  assert.equal(report.capability_index, Math.min(lower, upper));
});

test("correctness confidence CLI receipt is stable", async () => {
  const args = [
    "correctness",
    "--input",
    "examples/correctness-results.jsonl",
    "--config",
    "examples/correctness-config.json",
    "--receipt"
  ];
  const first = await runCli(args);
  const second = await runCli(args);
  assert.equal(first.status, 0);
  assert.equal(second.status, 0);
  assert.equal(first.stderr, "");
  assert.equal(second.stderr, "");
  assert.equal(first.stdout, second.stdout);
  const payload = parseJson(first.stdout, "correctness --receipt");
  assert.equal(payload.metric, "substantive_tokens_preserved");
  assert.equal(payload.receipt.receipt_hash, payload.receipt_hash);
  expectReceiptShape(payload.receipt);
});

test("correctness confidence invalid config fails clearly", async () => {
  const invalidConfigPath = path.join(ROOT, ".tmp-invalid-correctness-config.json");
  fs.writeFileSync(
    invalidConfigPath,
    JSON.stringify({ metric_name: "missing_spec" }),
    "utf8"
  );
  try {
    const result = await runCli([
      "correctness",
      "--input",
      "examples/correctness-results.jsonl",
      "--config",
      ".tmp-invalid-correctness-config.json"
    ]);
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr.includes(
        "Invalid correctness config: lower_spec_limit or upper_spec_limit is required."
      ),
      true
    );
  } finally {
    fs.rmSync(invalidConfigPath, { force: true });
  }
});

test("correctness confidence uses no model SDK dependencies", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const dependencyNames = [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {})
  ].join(" ");
  assert.equal(/openai|anthropic|gemini|model-sdk/i.test(dependencyNames), false);

  const confidenceSource = fs.readFileSync(
    path.join(ROOT, "src", "correctness", "confidence.ts"),
    "utf8"
  );
  assert.equal(/chat\.completions|embeddings\.create|openai|anthropic|gemini/i.test(confidenceSource), false);
});

test("pipeline API returns final plus receipt", () => {
  const input = readFixture("fixtures/fail/verbose_recap_heavy.txt");
  const pipeline = runPipeline({
    input,
    draft: input,
    task_type: "writing",
    timestamp: "1970-01-01T00:00:00.000Z"
  });
  assert.equal(typeof pipeline.final, "string");
  expectReceiptShape(pipeline.receipt);
  assert.equal(pipeline.receipt.ok, true);
});

test("same text yields same deterministic hash embedding", () => {
  const input = readFixture("fixtures/fail/filler_heavy.txt");
  const first = hashEmbedText(input);
  const second = hashEmbedText(input);
  assert.equal(first.length, HASH_EMBEDDING_DIMENSIONS);
  assert.deepEqual(first, second);
});

test("memory add and search work locally", async () => {
  cleanupMemoryDir();
  const adapter = createDefaultStyleMemoryAdapter();

  const first = await adapter.add({
    output_text: readFixture("fixtures/pass/compliant.txt"),
    task_type: "writing",
    outcome: "accepted",
    violations: [],
    metrics: { charCount: 44, bulletCount: 0, caveatCount: 0, verifier_ok: true },
    receipt_hash: "r-1",
    created_at: "1970-01-01T00:00:00.000Z"
  });

  const second = await adapter.add({
    output_text: readFixture("fixtures/pass/compliant.txt"),
    task_type: "writing",
    outcome: "accepted",
    violations: [],
    metrics: { charCount: 44, bulletCount: 0, caveatCount: 0, verifier_ok: true },
    receipt_hash: "r-1",
    created_at: "1970-01-01T00:00:00.000Z"
  });

  assert.equal(first.id, second.id);
  const results = await adapter.search("npm run build", {
    limit: 5,
    task_type: "writing",
    outcomes: ["accepted"]
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].record.task_type, "writing");
});

test("pipeline works with and without memory", async () => {
  cleanupMemoryDir();

  const add = await runCli([
    "memory",
    "add",
    "fixtures/pass/compliant.txt",
    "--outcome",
    "accepted",
    "--task",
    "writing"
  ]);
  assert.equal(add.status, 0);
  assert.equal(add.stderr, "");

  const withoutMemory = await runCli([
    "pipeline",
    "fixtures/fail/filler_heavy.txt",
    "--task",
    "writing",
    "--receipt"
  ]);
  assert.equal(withoutMemory.status, 0);
  const withoutMemoryPayload = parseJson(withoutMemory.stdout, "pipeline without memory");
  assert.equal(withoutMemoryPayload.memory.enabled, false);
  assert.equal(withoutMemoryPayload.ok, true);

  const withMemory = await runCli([
    "pipeline",
    "fixtures/fail/filler_heavy.txt",
    "--task",
    "writing",
    "--memory",
    "--receipt"
  ]);
  assert.equal(withMemory.status, 0);
  assert.equal(withMemory.stderr, "");
  const withMemoryPayload = parseJson(withMemory.stdout, "pipeline with memory");
  assert.equal(withMemoryPayload.memory.enabled, true);
  assert.equal(withMemoryPayload.memory.retrieved >= 1, true);
  assert.equal(withMemoryPayload.memory.hits_used >= 1, true);
  assert.equal(withMemoryPayload.metrics.memory.hits_used >= 1, true);
  assert.equal(withMemoryPayload.ok, true);
});

test("memory disabled by default and verifier is unchanged", async () => {
  cleanupMemoryDir();

  const withMemory = await runCli([
    "pipeline",
    "fixtures/fail/filler_heavy.txt",
    "--task",
    "writing",
    "--memory",
    "--receipt"
  ]);
  const noMemory = await runCli([
    "pipeline",
    "fixtures/fail/filler_heavy.txt",
    "--task",
    "writing",
    "--receipt"
  ]);

  assert.equal(withMemory.status, 0);
  assert.equal(noMemory.status, 0);
  const withMemoryPayload = parseJson(withMemory.stdout, "pipeline --memory");
  const noMemoryPayload = parseJson(noMemory.stdout, "pipeline no-memory");

  assert.equal(withMemoryPayload.memory.enabled, true);
  assert.equal(noMemoryPayload.memory.enabled, false);
  assert.equal(withMemoryPayload.final, noMemoryPayload.final);
  assert.equal(withMemoryPayload.ok, noMemoryPayload.ok);
  assert.deepEqual(withMemoryPayload.violations, noMemoryPayload.violations);
});

test("memory hits do not override verifier pass fail rules", async () => {
  cleanupMemoryDir();

  const add = await runCli([
    "memory",
    "add",
    "fixtures/pass/meaningful_dense.txt",
    "--outcome",
    "accepted",
    "--task",
    "writing"
  ]);
  assert.equal(add.status, 0);

  const withoutMemory = await runCli([
    "pipeline",
    "fixtures/fail/verbose_recap_heavy.txt",
    "--task",
    "writing",
    "--receipt"
  ]);
  const withMemory = await runCli([
    "pipeline",
    "fixtures/fail/verbose_recap_heavy.txt",
    "--task",
    "writing",
    "--memory",
    "--receipt"
  ]);

  const withoutMemoryPayload = parseJson(withoutMemory.stdout, "pipeline no-memory");
  const withMemoryPayload = parseJson(withMemory.stdout, "pipeline --memory");
  const withoutMemoryVerification = verifyText(withoutMemoryPayload.final);
  const withMemoryVerification = verifyText(withMemoryPayload.final);

  assert.equal(withMemoryPayload.memory.enabled, true);
  assert.equal(withMemoryPayload.memory.hits_used >= 1, true);
  assert.equal(withMemoryPayload.ok, withMemoryVerification.ok);
  assert.equal(withoutMemoryPayload.ok, withoutMemoryVerification.ok);
  assert.equal(withMemoryVerification.ok, withoutMemoryVerification.ok);
  assert.deepEqual(
    withMemoryPayload.violations.map((violation) => violation.code),
    withMemoryVerification.violations.map((violation) => violation.code)
  );
});

test("memory add rejects accepted outcome for non-compliant output", async () => {
  const result = await runCli(
    ["memory", "add", "-", "--outcome", "accepted", "--task", "writing"],
    { stdin: "" }
  );
  assert.equal(result.status, 1);
  assert.equal(
    result.stderr.includes("memory add with outcome 'accepted' requires output that passes verification."),
    true
  );
});

test("check missing file returns clean error without path leakage", async () => {
  const result = await runCli(["check", "does-not-exist.txt"]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.includes("Failed to read input file: does-not-exist.txt"), true);
  assert.equal(result.stderr.includes("E:\\"), false);
  assert.equal(result.stderr.includes("node:fs"), false);
  assert.equal(/\bat\s/.test(result.stderr), false);
});

test("check without file reports missing argument", async () => {
  const result = await runCli(["check"]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.includes("Missing file argument."), true);
  assert.equal(result.stderr.includes("Unknown command: check"), false);
});

test("memory search --limit requires positive integer", async () => {
  const valid = await runCli(["memory", "search", "test", "--limit", "1"]);
  assert.equal(valid.status, 0);

  const fractional = await runCli(["memory", "search", "test", "--limit", "1.5"]);
  assert.equal(fractional.status, 1);
  assert.equal(fractional.stderr.includes("Invalid --limit value."), true);

  const tooLarge = await runCli(["memory", "search", "test", "--limit", "101"]);
  assert.equal(tooLarge.status, 1);
  assert.equal(tooLarge.stderr.includes("Invalid --limit value."), true);
});

async function runAll() {
  for (const { name, fn } of tests) {
    try {
      await fn();
      process.stdout.write(`PASS ${name}\n`);
    } catch (error) {
      process.stderr.write(`FAIL ${name}\n`);
      throw error;
    }
  }
}

runAll().catch((error) => {
  process.stderr.write(`${error.stack ?? String(error)}\n`);
  process.exit(1);
});
