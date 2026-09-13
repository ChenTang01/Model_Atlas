import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { run as verifyAuthoringPlan } from "./plan-model-note-authoring.mjs";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PLAN = "research/ledger/authoring-plan.release-v20.json";
const RECEIPT_SCHEMA_VERSION = 1;
const FAILURE_STATUSES = new Set(["blocked", "stale", "failed"]);
const RECEIPT_STATES = new Set(["complete", "failed", "stale", "missing"]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

export function parseCli(argv) {
  const options = {
    root: "",
    plan: DEFAULT_PLAN,
    batches: [],
    fromBatch: null,
    throughBatch: null,
    maxConcurrent: null,
    status: false,
    check: false,
    json: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const take = () => {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      return value;
    };
    if (argument === "--root") options.root = take();
    else if (argument === "--plan") options.plan = take();
    else if (argument === "--batch") {
      for (const value of take().split(",")) options.batches.push(positiveInteger(value.trim(), "--batch"));
    } else if (argument === "--from-batch") options.fromBatch = positiveInteger(take(), "--from-batch");
    else if (argument === "--through-batch") options.throughBatch = positiveInteger(take(), "--through-batch");
    else if (argument === "--max-concurrent") options.maxConcurrent = positiveInteger(take(), "--max-concurrent");
    else if (argument === "--status") options.status = true;
    else if (argument === "--check") options.check = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.status && options.check) throw new Error("--status and --check are mutually exclusive");
  if (options.batches.length && (options.fromBatch || options.throughBatch)) {
    throw new Error("--batch cannot be combined with --from-batch or --through-batch");
  }
  if (options.fromBatch && options.throughBatch && options.fromBatch > options.throughBatch) {
    throw new Error("--from-batch must not exceed --through-batch");
  }
  return options;
}

function resolveWithinRoot(root, requestedPath, label) {
  if (typeof requestedPath !== "string" || !requestedPath.trim()) throw new Error(`${label} must not be blank`);
  const absolute = path.resolve(root, requestedPath);
  const relative = path.relative(root, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the project root`);
  }
  return absolute;
}

async function atomicWrite(filename, content) {
  await mkdir(path.dirname(filename), { recursive: true });
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
  const temporary = `${filename}.${process.pid}-${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    await rename(temporary, filename);
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function atomicWriteJson(filename, value) {
  await atomicWrite(filename, `${JSON.stringify(value, null, 2)}\n`);
}

function batchIds(plan, batch) {
  return plan.paperIds.slice(batch.startIndex, batch.endIndexExclusive);
}

function selectedBatches(plan, options) {
  const maximum = plan.batches.length;
  let ordinals;
  if (options.batches.length) ordinals = [...new Set(options.batches)].sort((left, right) => left - right);
  else {
    const from = options.fromBatch || 1;
    const through = options.throughBatch || maximum;
    ordinals = Array.from({ length: through - from + 1 }, (_unused, index) => from + index);
  }
  for (const ordinal of ordinals) {
    if (ordinal > maximum) throw new Error(`Batch ${ordinal} is outside the saved plan (1-${maximum})`);
  }
  return ordinals.map((ordinal) => plan.batches[ordinal - 1]);
}

function expectedCommand(batch, jobs) {
  return `node scripts/author-model-notes.mjs --from ${JSON.stringify(batch.fromId)} --limit ${batch.limit} --jobs ${jobs} --json`;
}

function deriveInvocation(plan, batch) {
  const command = expectedCommand(batch, plan.configuration.jobsPerProcess);
  if (batch.command !== command) throw new Error(`${batch.ordinal}: saved command does not match frozen batch metadata`);
  if (plan.authoringEntry !== "scripts/author-model-notes.mjs") {
    throw new Error(`Unsupported authoring entry: ${plan.authoringEntry}`);
  }
  return {
    command,
    executable: process.execPath,
    args: [
      plan.authoringEntry,
      "--from", batch.fromId,
      "--limit", String(batch.limit),
      "--jobs", String(plan.configuration.jobsPerProcess),
      "--json"
    ]
  };
}

function countStatuses(results) {
  const counts = {};
  for (const result of results) counts[result.status] = (counts[result.status] || 0) + 1;
  return counts;
}

export function countReceiptStates(results) {
  const counts = {};
  for (const [index, result] of results.entries()) {
    if (!result || !RECEIPT_STATES.has(result.state)) {
      const ordinal = Number.isInteger(result?.ordinal) ? ` ordinal=${result.ordinal}` : "";
      const keys = result && typeof result === "object" ? Object.keys(result).sort().join(",") : typeof result;
      throw new Error(`invalid-receipt-inspection-row index=${index}${ordinal} keys=${keys}`);
    }
    counts[result.state] = (counts[result.state] || 0) + 1;
  }
  return counts;
}

function equalCounts(left, right) {
  const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  return [...keys].every((key) => (left?.[key] || 0) === (right?.[key] || 0));
}

function validateAuthoringResult(plan, batch, value) {
  if (!value || typeof value !== "object") return "authoring stdout is not a JSON object";
  if (value.selected !== batch.limit) return `authoring selected ${value.selected}; expected ${batch.limit}`;
  if (!Array.isArray(value.results) || value.results.length !== batch.limit) {
    return `authoring returned ${value.results?.length ?? "no"} paper results; expected ${batch.limit}`;
  }
  const expectedIds = batchIds(plan, batch);
  for (let index = 0; index < expectedIds.length; index += 1) {
    if (value.results[index]?.id !== expectedIds[index]) {
      return `paper result ${index + 1} is ${value.results[index]?.id || "missing"}; expected ${expectedIds[index]}`;
    }
    if (typeof value.results[index]?.status !== "string" || !value.results[index].status) {
      return `${expectedIds[index]} has no status`;
    }
  }
  if (!equalCounts(value.counts, countStatuses(value.results))) return "authoring status counts do not match its result rows";
  return "";
}

async function readOptional(filename) {
  try {
    return await readFile(filename);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function receiptPaths(root, batch) {
  return {
    log: resolveWithinRoot(root, batch.logPath, `batch ${batch.ordinal} log path`),
    exit: resolveWithinRoot(root, batch.exitCodePath, `batch ${batch.ordinal} exit-code path`),
    result: resolveWithinRoot(root, batch.resultPath, `batch ${batch.ordinal} result path`),
    lock: resolveWithinRoot(root, `${batch.resultPath}.lock`, `batch ${batch.ordinal} lock path`)
  };
}

export async function inspectReceipt({ root, plan, batch }) {
  const files = receiptPaths(root, batch);
  const resultBytes = await readOptional(files.result);
  if (!resultBytes) return { ordinal: batch.ordinal, label: path.basename(batch.resultPath, ".result.json"), state: "missing" };
  let receipt;
  try {
    receipt = JSON.parse(resultBytes.toString("utf8"));
  } catch (error) {
    return { ordinal: batch.ordinal, label: path.basename(batch.resultPath, ".result.json"), state: "stale", reason: `invalid receipt JSON: ${error.message}` };
  }
  const mismatch = (reason) => ({ ordinal: batch.ordinal, label: receipt.label, state: "stale", reason });
  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION || receipt.kind !== "model-note-authoring-batch-result") return mismatch("unsupported receipt schema or kind");
  if (receipt.planSha256 !== plan.planSha256 || receipt.freezeSha256 !== plan.freezeSha256) return mismatch("receipt is bound to a different frozen plan");
  if (receipt.batchOrdinal !== batch.ordinal || receipt.paperIdsSha256 !== batch.paperIdsSha256) return mismatch("receipt batch identity does not match the plan");
  if (receipt.command !== batch.command) return mismatch("receipt command does not match the plan");
  const [logBytes, exitBytes] = await Promise.all([readOptional(files.log), readOptional(files.exit)]);
  if (!logBytes || !exitBytes) return mismatch("receipt log or exit-code artifact is missing");
  if (receipt.logSha256 !== sha256(logBytes) || receipt.exitCodeSha256 !== sha256(exitBytes)) return mismatch("receipt artifact hash mismatch");
  const expectedExitText = receipt.signal ? `signal:${receipt.signal}\n` : `${receipt.exitCode}\n`;
  if (exitBytes.toString("utf8") !== expectedExitText) return mismatch("exit-code artifact does not match receipt");
  const resultIssue = validateAuthoringResult(plan, batch, receipt.authoringResult);
  if (resultIssue) return mismatch(resultIssue);
  const failedPapers = receipt.authoringResult.results.filter((entry) => FAILURE_STATUSES.has(entry.status));
  const success = receipt.exitCode === 0 && !receipt.signal && failedPapers.length === 0;
  if (receipt.success !== success) return mismatch("receipt success flag is inconsistent");
  return {
    ordinal: batch.ordinal,
    label: receipt.label,
    state: success ? "complete" : "failed",
    exitCode: receipt.exitCode,
    signal: receipt.signal,
    counts: receipt.authoringResult.counts,
    failedPaperIds: failedPapers.map((entry) => entry.id),
    receiptPath: batch.resultPath
  };
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function acquireLock(filename, payload) {
  await mkdir(path.dirname(filename), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(filename, "wx");
      await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let existing = null;
      try {
        existing = JSON.parse(await readFile(filename, "utf8"));
      } catch {}
      if (processAlive(existing?.pid)) throw new Error(`Batch ${payload.batchOrdinal} is already claimed by process ${existing.pid}`);
      await rm(filename, { force: true });
    }
  }
  throw new Error(`Could not acquire batch ${payload.batchOrdinal} lock`);
}

function runChild(executable, args, root) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode, signal) => resolve({
      exitCode,
      signal: signal || "",
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8")
    }));
  });
}

export async function executeBatch({ root, plan, batch, spawnChild = runChild }) {
  const prior = await inspectReceipt({ root, plan, batch });
  if (prior.state === "complete") return { ...prior, action: "skipped" };
  const files = receiptPaths(root, batch);
  const invocation = deriveInvocation(plan, batch);
  const startedAt = new Date().toISOString();
  await acquireLock(files.lock, {
    schemaVersion: 1,
    kind: "model-note-authoring-batch-lock",
    pid: process.pid,
    planSha256: plan.planSha256,
    batchOrdinal: batch.ordinal,
    startedAt
  });
  try {
    const child = await spawnChild(invocation.executable, invocation.args, root);
    let authoringResult = null;
    let parseError = "";
    try {
      authoringResult = JSON.parse(child.stdout.trim());
    } catch (error) {
      parseError = `Could not parse authoring JSON: ${error.message}`;
    }
    const resultIssue = authoringResult ? validateAuthoringResult(plan, batch, authoringResult) : parseError;
    const failedPaperIds = authoringResult?.results
      ?.filter((entry) => FAILURE_STATUSES.has(entry.status))
      .map((entry) => entry.id) || [];
    const success = child.exitCode === 0 && !child.signal && !resultIssue && failedPaperIds.length === 0;
    const logText = [
      `planSha256=${plan.planSha256}`,
      `batch=${batch.ordinal}`,
      `command=${invocation.command}`,
      `startedAt=${startedAt}`,
      `finishedAt=${new Date().toISOString()}`,
      "--- stdout ---",
      child.stdout,
      "--- stderr ---",
      child.stderr
    ].join("\n");
    const exitText = child.signal ? `signal:${child.signal}\n` : `${child.exitCode}\n`;
    await atomicWrite(files.log, logText);
    await atomicWrite(files.exit, exitText);
    const receipt = {
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      kind: "model-note-authoring-batch-result",
      planSha256: plan.planSha256,
      freezeSha256: plan.freezeSha256,
      batchOrdinal: batch.ordinal,
      label: path.basename(batch.resultPath, ".result.json"),
      paperIdsSha256: batch.paperIdsSha256,
      command: invocation.command,
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode: child.exitCode,
      signal: child.signal,
      success,
      resultIssue,
      failedPaperIds,
      logPath: batch.logPath,
      logSha256: sha256(logText),
      exitCodePath: batch.exitCodePath,
      exitCodeSha256: sha256(exitText),
      authoringResult
    };
    await atomicWriteJson(files.result, receipt);
    const checked = await inspectReceipt({ root, plan, batch });
    return { ...checked, action: "ran" };
  } finally {
    await rm(files.lock, { force: true }).catch(() => {});
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runWorker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index]);
      } catch (error) {
        results[index] = { ordinal: items[index].ordinal, state: "failed", action: "runner-error", reason: error?.message || String(error) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runWorker));
  return results;
}

export async function run(options = {}, dependencies = {}) {
  const root = path.resolve(options.root || DEFAULT_ROOT);
  const planPath = options.plan || DEFAULT_PLAN;
  const verifier = dependencies.verifyAuthoringPlan || verifyAuthoringPlan;
  const verified = await verifier({ root, output: planPath, check: true });
  const plan = verified.plan;
  const batches = selectedBatches(plan, options);
  if (options.status || options.check) {
    const results = await Promise.all(batches.map((batch) => inspectReceipt({ root, plan, batch })));
    const ok = results.every((entry) => entry.state === "complete");
    if (options.check && !ok) {
      const counts = countReceiptStates(results);
      throw Object.assign(new Error(`Authoring batch receipts are incomplete: ${JSON.stringify(counts)}`), { results });
    }
    return { mode: options.check ? "check" : "status", ok, planSha256: plan.planSha256, selectedBatches: batches.length, results };
  }

  const maximum = options.maxConcurrent || plan.configuration.maxConcurrentProcessesAfterBootstrap;
  if (maximum > plan.configuration.maxConcurrentProcessesAfterBootstrap) {
    throw new Error(`--max-concurrent cannot exceed the frozen limit ${plan.configuration.maxConcurrentProcessesAfterBootstrap}`);
  }
  const selectedOrdinals = new Set(batches.map((batch) => batch.ordinal));
  if ([...selectedOrdinals].some((ordinal) => ordinal > 1)) {
    const bootstrap = await inspectReceipt({ root, plan, batch: plan.batches[0] });
    if (bootstrap.state !== "complete" && !selectedOrdinals.has(1)) {
      throw new Error("Batch 1 must have a verified successful receipt before later batches may run");
    }
  }
  const results = [];
  let remaining = batches;
  if (selectedOrdinals.has(1)) {
    const bootstrap = await executeBatch({ root, plan, batch: plan.batches[0], spawnChild: dependencies.spawnChild });
    results.push(bootstrap);
    if (bootstrap.state !== "complete") {
      return { mode: "run", ok: false, planSha256: plan.planSha256, selectedBatches: batches.length, results };
    }
    remaining = batches.filter((batch) => batch.ordinal !== 1);
  }
  results.push(...await mapLimit(remaining, maximum, (batch) => executeBatch({ root, plan, batch, spawnChild: dependencies.spawnChild })));
  return {
    mode: "run",
    ok: results.every((entry) => entry.state === "complete"),
    planSha256: plan.planSha256,
    selectedBatches: batches.length,
    results: results.sort((left, right) => left.ordinal - right.ordinal)
  };
}

function usage() {
  return `Usage:
  node scripts/run-model-note-authoring-plan.mjs [--plan PATH] [--batch N[,N]] [--from-batch N] [--through-batch N] [--max-concurrent N] [--json]
  node scripts/run-model-note-authoring-plan.mjs --status [--plan PATH] [batch selectors] [--json]
  node scripts/run-model-note-authoring-plan.mjs --check [--plan PATH] [batch selectors] [--json]

The saved, hash-verified plan is authoritative. Batch 1 is a serial bootstrap; later batches run with at most the plan's frozen concurrency. A successful hash-bound receipt is skipped. Missing, stale, interrupted, or failed batches are safe to rerun because authoring commits one paper atomically and reuses current checkpoints.`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = parseCli(process.argv.slice(2));
  if (options.help) console.log(usage());
  else run(options).then((result) => {
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Authoring plan ${result.mode}: ${result.ok ? "complete" : "incomplete"}; ${result.selectedBatches} batch(es).`);
      for (const entry of result.results) {
        const suffix = entry.reason ? `: ${entry.reason}` : entry.failedPaperIds?.length ? `: ${entry.failedPaperIds.join(", ")}` : "";
        console.log(`batch-${String(entry.ordinal).padStart(2, "0")}: ${entry.state}${entry.action ? ` (${entry.action})` : ""}${suffix}`);
      }
    }
    if (!result.ok && result.mode !== "status") process.exitCode = 1;
  }).catch((error) => {
    if (options.json) console.error(JSON.stringify({ ok: false, error: error.message, results: error.results || [] }, null, 2));
    else console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
