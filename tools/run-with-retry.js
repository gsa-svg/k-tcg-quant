#!/usr/bin/env node

/*
 * Small CI-only retry runner for transient marketplace/API failures.
 * Usage: node tools/run-with-retry.js --attempts 3 --delay-ms 10000 -- node tools/task.js
 */
const { spawn } = require("node:child_process");

const args = process.argv.slice(2);
const separator = args.indexOf("--");
const command = separator === -1 ? [] : args.slice(separator + 1);
const optionArgs = separator === -1 ? args : args.slice(0, separator);
const option = (name, fallback) => {
  const index = optionArgs.indexOf(name);
  const value = index === -1 ? null : Number(optionArgs[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const attempts = Math.min(option("--attempts", 3), 3);
const delayMs = option("--delay-ms", 10000);

if (!command.length) {
  console.error("Usage: node tools/run-with-retry.js [--attempts N] [--delay-ms N] -- command [args...]");
  process.exit(2);
}

function runOnce() {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), { stdio: "inherit", shell: false });
    child.on("error", () => resolve(1));
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function main() {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    console.log(`[retry] attempt ${attempt}/${attempts}: ${command.join(" ")}`);
    const code = await runOnce();
    if (code === 0) return;
    if (attempt === attempts) {
      console.error(`[retry] failed after ${attempts} attempts (exit ${code})`);
      process.exitCode = code || 1;
      return;
    }
    const waitMs = delayMs * attempt;
    console.warn(`[retry] retrying in ${waitMs}ms after exit ${code}`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

main();
