import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const MAX_PUBLIC_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_SCAN_BYTES = 5 * 1024 * 1024;

const forbiddenPaths = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:node_modules|dist|target|\.playwright-mcp|\.local-artifacts)(\/|$)/i,
  /(^|\/)\.DS_Store$/i,
  /hytale-shared-source/i,
  /(^|\/)(?:public\/hytale|public\/realbuild)(\/|$)/i,
  /\.(?:p12|pfx|mobileprovision|key|pem|sqlite|sqlite3|db|dmg|app|zip|7z|rar|tar|gz)$/i,
  /(^|\/)(?:env_|ui-|v2-).+\.png$/i,
  /(^|\/)voxelfold-guide-precision\.png$/i,
  /(^|\/)blockbench-snapshot\.md$/i,
  /\.(?:blockymodel|blockyanim|dds|ktx|ktx2|hybundle)$/i,
];

const forbiddenText = [
  { label: "ruta personal absoluta", pattern: /\/Users\/[A-Za-z0-9._-]+\// },
  { label: "clave privada", pattern: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/ },
  { label: "token de GitHub", pattern: /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/ },
  { label: "token de acceso", pattern: /\b(?:sk|xox[baprs])-[_A-Za-z0-9-]{20,}\b/ },
  { label: "trailer de coautoría", pattern: /^Co-authored-by:/im },
  { label: "atribución de asistente", pattern: /\b(?:Cl[a]ude|Cod[e]x|ChatG[P]T)\b/i },
];

const allowedEmail = /@users\.noreply\.github\.com$/i;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z][A-Z0-9.-]*\.[A-Z]{2,}\b/gi;

const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  encoding: "utf8",
});
const files = [...new Set(listed.split("\0").filter(Boolean))].sort();
const failures = [];

for (const path of files) {
  let info;
  try {
    info = statSync(path);
  } catch {
    continue;
  }
  if (!info.isFile()) continue;

  if (forbiddenPaths.some((pattern) => pattern.test(path))) {
    failures.push(`${path}: ruta o tipo de archivo no publicable`);
    continue;
  }
  if (info.size > MAX_PUBLIC_FILE_BYTES) {
    failures.push(`${path}: supera el límite público de 15 MiB`);
    continue;
  }
  if (info.size > MAX_TEXT_SCAN_BYTES) continue;

  const buffer = readFileSync(path);
  if (buffer.includes(0)) continue;
  const text = buffer.toString("utf8");
  for (const rule of forbiddenText) {
    if (rule.pattern.test(text)) failures.push(`${path}: contiene ${rule.label}`);
  }
  for (const email of text.match(emailPattern) ?? []) {
    if (!allowedEmail.test(email)) {
      failures.push(`${path}: contiene una dirección de correo publicable no autorizada`);
      break;
    }
  }
}

if (failures.length) {
  console.error("La auditoría pública ha bloqueado estos archivos:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Auditoría pública superada: ${files.length} archivos revisados.`);
