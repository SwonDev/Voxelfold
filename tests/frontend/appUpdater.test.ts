import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDownloadEvent,
  appUpdateErrorMessage,
  downloadPercent,
  shouldCheckForAppUpdate,
  type UpdateProgress,
} from "../../src/lib/appUpdater.ts";
import { toastDuration } from "../../src/lib/toast.ts";

test("limita el sondeo automático a una vez al día", () => {
  const now = 2_000_000_000_000;
  assert.equal(shouldCheckForAppUpdate(null, now), true);
  assert.equal(shouldCheckForAppUpdate(String(now - 60_000), now), false);
  assert.equal(shouldCheckForAppUpdate(String(now - 24 * 60 * 60 * 1000), now), true);
  assert.equal(shouldCheckForAppUpdate("valor-corrupto", now), true);
});

test("acumula el progreso de descarga y nunca supera el 100 %", () => {
  let progress: UpdateProgress = { downloaded: 0, finished: false };
  progress = applyDownloadEvent(progress, {
    event: "Started",
    data: { contentLength: 100 },
  });
  progress = applyDownloadEvent(progress, { event: "Progress", data: { chunkLength: 35 } });
  assert.equal(downloadPercent(progress), 35);
  progress = applyDownloadEvent(progress, { event: "Progress", data: { chunkLength: 80 } });
  assert.equal(downloadPercent(progress), 100);
  progress = applyDownloadEvent(progress, { event: "Finished" });
  assert.equal(progress.finished, true);
  assert.equal(downloadPercent(progress), 100);
});

test("representa como indeterminada una descarga sin tamaño anunciado", () => {
  let progress: UpdateProgress = { downloaded: 0, finished: false };
  progress = applyDownloadEvent(progress, { event: "Started", data: {} });
  progress = applyDownloadEvent(progress, { event: "Progress", data: { chunkLength: 42 } });
  assert.equal(downloadPercent(progress), null);
  progress = applyDownloadEvent(progress, { event: "Finished" });
  assert.equal(downloadPercent(progress), 100);
});

test("traduce fallos técnicos del actualizador sin ocultar un rechazo de firma", () => {
  assert.equal(
    appUpdateErrorMessage("Could not fetch a valid release JSON from the remote"),
    "No se pudo contactar con el canal de actualizaciones. Comprueba tu conexión e inténtalo de nuevo.",
  );
  assert.match(appUpdateErrorMessage("invalid signature"), /firma no es válida/i);
});

test("los errores permanecen visibles el tiempo suficiente para poder leerlos", () => {
  assert.ok(toastDuration("error") > toastDuration("info"));
  assert.ok(toastDuration("error") >= 7_000);
});
