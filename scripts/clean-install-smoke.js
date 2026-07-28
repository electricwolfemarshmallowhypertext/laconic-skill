const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const tarballName = `${packageJson.name}-${packageJson.version}.tgz`;
const tarballPath = path.join(root, tarballName);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "laconic-install-"));
const npmCli = process.env.npm_execpath;
const binPath = path.join(
  tempRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "laconic.cmd" : "laconic"
);
const cliPath = path.join(tempRoot, "node_modules", packageJson.name, "dist", "cli.js");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe"
  });
}

function runNpm(args, options = {}) {
  if (npmCli) {
    return run(process.execPath, [npmCli, ...args], options);
  }
  return run(process.platform === "win32" ? "npm.cmd" : "npm", args, options);
}

function runCli(args) {
  return run(process.execPath, [cliPath, ...args], { cwd: tempRoot });
}

try {
  runNpm(["pack", "--silent"]);
  runNpm(["install", tarballPath, "--silent"], { cwd: tempRoot });
  assert.equal(fs.existsSync(binPath), true);

  const concisePath = path.join(tempRoot, "concise.txt");
  const verbosePath = path.join(tempRoot, "verbose.txt");
  fs.writeFileSync(concisePath, "Run `npm test`.\n", "utf8");
  fs.writeFileSync(
    verbosePath,
    "Sure, I'd be happy to help.\nTo recap, you asked for validation steps.\nUse `npm run build` and then run `npm test`.\nI hope this helps.\n",
    "utf8"
  );

  const check = JSON.parse(runCli(["check", concisePath, "--receipt"]));
  assert.equal(check.ok, true);
  assert.equal(typeof check.receipt.receipt_hash, "string");

  const rewrite = JSON.parse(runCli(["rewrite", verbosePath, "--receipt"]));
  assert.equal(rewrite.ok, true);
  assert.equal(typeof rewrite.final, "string");
  assert.equal(typeof rewrite.receipt.receipt_hash, "string");

  const pipeline = JSON.parse(
    runCli(["pipeline", verbosePath, "--task", "writing", "--receipt"])
  );
  assert.equal(pipeline.ok, true);
  assert.equal(typeof pipeline.final, "string");
  assert.equal(typeof pipeline.receipt.receipt_hash, "string");

  process.stdout.write("clean install smoke passed\n");
} finally {
  fs.rmSync(tarballPath, { force: true });
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
