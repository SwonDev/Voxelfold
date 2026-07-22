import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const tauriConfig = JSON.parse(await readFile(new URL("src-tauri/tauri.conf.json", root), "utf8"));
const cargoToml = await readFile(new URL("src-tauri/Cargo.toml", root), "utf8");
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const versions = {
  "package.json": packageJson.version,
  "src-tauri/Cargo.toml": cargoVersion,
  "src-tauri/tauri.conf.json": tauriConfig.version,
};
const uniqueVersions = new Set(Object.values(versions));
if (uniqueVersions.size !== 1 || uniqueVersions.has(undefined)) {
  throw new Error(`Versiones incoherentes: ${JSON.stringify(versions)}`);
}

if (tauriConfig.identifier !== "com.swondev.voxelfold") {
  throw new Error(`Identificador inesperado: ${tauriConfig.identifier}`);
}
if (tauriConfig.bundle?.createUpdaterArtifacts !== true) {
  throw new Error("bundle.createUpdaterArtifacts debe estar activado");
}
const updater = tauriConfig.plugins?.updater;
if (!updater?.pubkey || !Array.isArray(updater.endpoints) || updater.endpoints.length === 0) {
  throw new Error("El actualizador necesita public key y al menos un endpoint");
}
if (!updater.endpoints.every((endpoint) => endpoint.startsWith("https://"))) {
  throw new Error("Todos los endpoints del actualizador deben usar HTTPS");
}

const expectedTag = `v${packageJson.version}`;
const currentTag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined;
if (currentTag && currentTag !== expectedTag) {
  throw new Error(`El tag ${currentTag} no coincide con la versión ${expectedTag}`);
}

console.log(`Voxelfold ${packageJson.version}: configuración de release coherente.`);
