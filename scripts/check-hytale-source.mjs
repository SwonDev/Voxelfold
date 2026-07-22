#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = resolve(root, "hytale-source-contract.json");
const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const { repository, branch, revision } = contract.mirror;
const remote = `${repository}.git`;
const ref = `refs/heads/${branch}`;

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const suppliedRevision = process.argv
  .find((argument) => argument.startsWith("--remote-revision="))
  ?.slice("--remote-revision=".length);
let remoteRevision = suppliedRevision;
if (!remoteRevision) {
  let output;
  try {
    // No acepta ni almacena tokens: Git usa el helper de credenciales del desarrollador o CI.
    output = execFileSync("git", ["ls-remote", remote, ref], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = error?.stderr?.toString().trim();
    fail(
      `No se pudo consultar ${repository}#${branch}. `
        + `Configura acceso de solo lectura mediante el helper de Git.${detail ? `\n${detail}` : ""}`,
    );
  }
  remoteRevision = output.split(/\s+/)[0];
}
if (!/^[0-9a-f]{40}$/i.test(remoteRevision)) {
  fail(`La rama ${branch} no devolvió una revisión válida.`);
}

const result = {
  canonical: contract.canonical.repository,
  mirror: repository,
  branch,
  integrated_revision: revision,
  remote_revision: remoteRevision,
  current: remoteRevision === revision,
};

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else if (result.current) {
  process.stdout.write(`Hytale Shared Source está al día (${remoteRevision.slice(0, 12)}).\n`);
} else {
  process.stderr.write(
    `Hytale Shared Source avanzó: ${revision.slice(0, 12)} → ${remoteRevision.slice(0, 12)}.\n`
      + "Ejecuta la auditoría de compatibilidad antes de actualizar hytale-source-contract.json.\n",
  );
}

process.exit(result.current ? 0 : 2);
