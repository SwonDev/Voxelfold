# Plan 1 — Spike de formato de Hytale (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Descubrir y documentar los formatos REALES de la instalación de Hytale en el Mac del usuario (ruta de instalación, estructura del `Assets.zip`, esquema del `prefab.json`, convención de nombres de texturas/iconos) y producir fixtures sintéticos verificables para los tests del Core, sin versionar ningún asset propietario.

**Architecture:** Spike de descubrimiento ejecutado con comandos de shell (lectura) sobre la instalación local. Los hallazgos se documentan en `docs/spikes/`. Para los tests posteriores no se versionan archivos reales de Hytale: a partir del esquema real descubierto se construye un fixture **sintético** mínimo que replica la estructura. Los assets reales solo se inspeccionan in situ.

**Tech Stack:** Shell (zsh), `unzip`/`ditto`, `jq`, `python3` (para inspección JSON si hace falta). Sin Tauri/Rust todavía.

> **Nota sobre la naturaleza del plan:** este es un spike de DESCUBRIMIENTO, no TDD. Los resultados (rutas, esquemas) son desconocidos hasta ejecutarlo. Cada tarea produce un artefacto documentado y verificable. Donde una tarea dependa de un hallazgo previo, se indica explícitamente.

> **REGLA LEGAL INVIOLABLE de este plan:** NO copiar, mover al repo, ni commitear ningún archivo de assets reales de Hytale (texturas, iconos, prefabs del juego base, fuentes). Solo se documentan rutas, nombres y esquemas. Los únicos archivos versionados son: notas en `docs/`, y fixtures **sintéticos** creados a mano.

---

### Task 1: Localizar la instalación de Hytale en macOS

**Files:**
- Create: `docs/spikes/2026-06-13-hytale-formato.md` (nota de hallazgos)

- [ ] **Step 1: Buscar la carpeta de datos de Hytale en rutas estándar de macOS**

Run:
```bash
ls -la "$HOME/Library/Application Support/" | grep -i hytale || echo "no en Application Support"
ls -la "$HOME/Library/Application Support/Hytale" 2>/dev/null || true
```
Expected: localizar un directorio `Hytale` (o similar). Si no aparece, continuar con el Step 2.

- [ ] **Step 2: Búsqueda amplia por si corre vía capa de compatibilidad (CrossOver/Whisky/Wine) o ruta no estándar**

Run:
```bash
mdfind -name "Hytale" 2>/dev/null | head -50
find "$HOME" -iname "*hytale*" -maxdepth 6 -type d 2>/dev/null | head -50
```
Expected: una o más rutas candidatas. Anotar la que contenga datos del juego (no el repo Voxelfold).

- [ ] **Step 3: Localizar el `Assets.zip` (o carpeta de assets) y el directorio de instalación**

Run:
```bash
find "$HOME" -iname "Assets.zip" 2>/dev/null | head -20
mdfind -name "prefab" 2>/dev/null | grep -i hytale | head -20
```
Expected: ruta(s) al `Assets.zip` y a algún `prefab`. Si la app guarda assets descomprimidos, anotar la carpeta equivalente.

- [ ] **Step 4: Documentar las rutas encontradas en la nota de spike**

Escribir en `docs/spikes/2026-06-13-hytale-formato.md` una sección "Rutas reales (macOS)" con: ruta del directorio de datos, ruta del `Assets.zip` (o carpeta), ruta donde viven los prefabs, y si la instalación es nativa o vía capa de compatibilidad.

- [ ] **Step 5: Commit**

```bash
git add docs/spikes/2026-06-13-hytale-formato.md
git commit -m "spike: rutas reales de instalación de Hytale en macOS"
```

---

### Task 2: Inspeccionar la estructura del `Assets.zip`

**Files:**
- Modify: `docs/spikes/2026-06-13-hytale-formato.md`

> Usar la ruta del `Assets.zip` hallada en Task 1. Sustituir `<ASSETS_ZIP>` por esa ruta real.

- [ ] **Step 1: Listar el contenido del zip sin extraerlo**

Run:
```bash
unzip -l "<ASSETS_ZIP>" | head -80
echo "--- total entradas ---"
unzip -l "<ASSETS_ZIP>" | tail -1
```
Expected: ver el árbol de carpetas. Confirmar (o corregir) la presencia de `Common/BlockTextures/`, `Common/Icons/ItemsGenerated/`, `Common/Models/`, `Server/Item/Items/`, `manifest.json`.

- [ ] **Step 2: Listar específicamente texturas de bloques, iconos y definiciones de items**

Run:
```bash
unzip -l "<ASSETS_ZIP>" | grep -iE "BlockTextures/.*\.png" | head -30
unzip -l "<ASSETS_ZIP>" | grep -iE "Icons/ItemsGenerated/.*\.png" | head -30
unzip -l "<ASSETS_ZIP>" | grep -iE "Item/Items/.*\.json" | head -30
```
Expected: ejemplos de nombres reales de PNG de texturas, PNG de iconos y JSON de items. Anotar la **convención de nombres** (¿coincide el nombre del PNG con el `block_id`? ¿hay sufijos por cara: `_top`, `_side`?).

- [ ] **Step 3: Extraer a un directorio TEMPORAL (fuera del repo) una definición de item y mirar su JSON**

Run:
```bash
TMP="$(mktemp -d)"; echo "tmp=$TMP"
ITEM="$(unzip -l "<ASSETS_ZIP>" | grep -iE "Item/Items/.*\.json" | awk '{print $4}' | head -1)"; echo "item=$ITEM"
ditto -x -k "<ASSETS_ZIP>" "$TMP" 2>/dev/null || unzip -o "<ASSETS_ZIP>" "$ITEM" -d "$TMP"
echo "--- contenido del JSON de item ---"
cat "$TMP/$ITEM" 2>/dev/null | head -120
```
Expected: ver el esquema real de una definición de bloque/item (campos: id, nombre legible, textura(s), props). Anotar los campos relevantes para el catálogo (`block_id → display_name, texture refs, icon ref, props`).

- [ ] **Step 4: Documentar la estructura de assets y la convención de nombres en la nota de spike**

Escribir en la nota una sección "Estructura del Assets.zip" con: árbol de carpetas confirmado, convención de nombres PNG↔block_id, y el esquema de un JSON de item (campos y ejemplo recortado).

- [ ] **Step 5: Limpiar el temporal y commit (sin assets en el repo)**

```bash
rm -rf "$TMP"
git status --short   # verificar que NO hay PNG/JSON de Hytale añadidos
git add docs/spikes/2026-06-13-hytale-formato.md
git commit -m "spike: estructura del Assets.zip y convención de nombres de bloques"
```
Expected: `git status` no debe mostrar ningún archivo dentro de `Common/` ni assets de Hytale.

---

### Task 3: Capturar el esquema real de un `prefab.json`

**Files:**
- Modify: `docs/spikes/2026-06-13-hytale-formato.md`

> Usar una ruta de prefab hallada en Task 1 (`<PREFAB_JSON>`). Preferir un prefab de ejemplo del juego/usuario solo para LECTURA; no se versiona.

- [ ] **Step 1: Volcar la estructura de claves de alto nivel del prefab**

Run:
```bash
python3 -c "import json,sys; d=json.load(open('<PREFAB_JSON>')); print('top keys:', list(d.keys())); print({k:(type(d[k]).__name__) for k in d})"
```
Expected: confirmar las claves reales (esperado: `Type`, `Id`, `Size`, `Origin`, `Palette`, y el campo con la matriz de bloques). Anotar nombres EXACTOS (mayúsculas, etc.).

- [ ] **Step 2: Inspeccionar `Size`, `Origin` y `Palette`**

Run:
```bash
python3 -c "import json; d=json.load(open('<PREFAB_JSON>')); print('Size=',d.get('Size')); print('Origin=',d.get('Origin')); pal=d.get('Palette'); print('Palette type=',type(pal).__name__); print('Palette sample=', list(pal.items())[:10] if isinstance(pal,dict) else pal[:10])"
```
Expected: dimensiones, origen y el mapeo paleta (carácter/índice → `namespace:block_id`). Anotar si la paleta es dict de caracteres o lista indexada.

- [ ] **Step 3: Inspeccionar cómo se codifica la matriz de bloques (el dato voxel)**

Run:
```bash
python3 -c "import json; d=json.load(open('<PREFAB_JSON>')); \
keys=[k for k in d if k.lower() in ('blocks','data','voxels','layers','grid','structure')]; \
print('candidate block keys:', keys); \
import pprint; pprint.pprint({k: (type(d[k]).__name__, (len(d[k]) if hasattr(d[k],'__len__') else '?')) for k in keys})"
```
Expected: identificar el campo de la matriz y su forma (¿lista de filas de caracteres? ¿array plano? ¿RLE? ¿por capas Y?). Volcar un recorte pequeño para entender el orden de ejes.

- [ ] **Step 4: Documentar el esquema completo del `prefab.json` en la nota de spike**

Escribir una sección "Esquema real de prefab.json" con: lista de claves exactas, tipo de `Palette`, forma y codificación de la matriz, y el **orden de ejes** (x/y/z) inferido. Incluir un ejemplo recortado y ANOTADO (no el prefab completo, para no volcar contenido propietario extenso).

- [ ] **Step 5: Commit**

```bash
git add docs/spikes/2026-06-13-hytale-formato.md
git commit -m "spike: esquema real de prefab.json (paleta, matriz, ejes)"
```

---

### Task 4: Construir un fixture sintético de `prefab.json` (legal, versionable)

**Files:**
- Create: `src-tauri/tests/fixtures/prefab_sintetico.json`
- Create: `src-tauri/tests/fixtures/README.md`

> Este fixture NO es un archivo de Hytale: es una réplica MÍNIMA hecha a mano que respeta el esquema real descubierto en Task 3. Sirve para los tests TDD del parser sin versionar contenido propietario.

- [ ] **Step 1: Crear un prefab sintético 2x2x2 que respete el esquema real**

Crear `src-tauri/tests/fixtures/prefab_sintetico.json` con un cubo pequeño que use los nombres de clave EXACTOS hallados (ajustar a lo real; el siguiente es un ejemplo a adaptar tras Task 3):

```json
{
  "Type": "prefab",
  "Id": "voxelfold:fixture_cubo_2x2x2",
  "Size": [2, 2, 2],
  "Origin": [0, 0, 0],
  "Palette": { "S": "hytale:stone", "W": "hytale:oak_planks" },
  "Blocks": [
    ["S", "S", "S", "S"],
    ["W", "W", "W", "W"]
  ]
}
```
> Importante: ADAPTAR claves/forma a lo que diga la nota de spike (Task 3). El comentario en el README documenta el mapeo.

- [ ] **Step 2: Documentar el fixture y su correspondencia con el esquema real**

Crear `src-tauri/tests/fixtures/README.md` explicando: que es sintético (no propietario), qué esquema real replica (enlace a `docs/spikes/2026-06-13-hytale-formato.md`), y los conteos esperados (p. ej. 4× stone, 4× oak_planks) para los tests de materiales.

- [ ] **Step 3: Validar que el fixture es JSON correcto**

Run:
```bash
python3 -c "import json; d=json.load(open('src-tauri/tests/fixtures/prefab_sintetico.json')); print('OK', d['Size'], list(d['Palette'].keys()))"
```
Expected: `OK [2, 2, 2] ['S', 'W']` (o lo equivalente al esquema real adaptado).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tests/fixtures/prefab_sintetico.json src-tauri/tests/fixtures/README.md
git commit -m "test: fixture sintético de prefab que replica el esquema real de Hytale"
```

---

### Task 5: Construir un fixture sintético de catálogo de bloques

**Files:**
- Create: `src-tauri/tests/fixtures/catalogo_sintetico.json`

> Réplica mínima del esquema de `Server/Item/Items/*.json` descubierto en Task 2, para testear el Asset Reader sin assets reales.

- [ ] **Step 1: Crear 2-3 definiciones de bloque sintéticas con el esquema real**

Crear `src-tauri/tests/fixtures/catalogo_sintetico.json` (adaptar campos a lo hallado en Task 2):

```json
{
  "hytale:stone":      { "display_name": "Stone",      "texture": "stone.png",      "icon": "stone_icon.png" },
  "hytale:oak_planks": { "display_name": "Oak Planks", "texture": "oak_planks.png", "icon": "oak_planks_icon.png" }
}
```

- [ ] **Step 2: Validar el JSON**

Run:
```bash
python3 -c "import json; d=json.load(open('src-tauri/tests/fixtures/catalogo_sintetico.json')); print('bloques:', list(d.keys()))"
```
Expected: `bloques: ['hytale:stone', 'hytale:oak_planks']`.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tests/fixtures/catalogo_sintetico.json
git commit -m "test: fixture sintético de catálogo de bloques"
```

---

### Task 6: Cerrar cuestiones abiertas y actualizar el spec

**Files:**
- Modify: `docs/superpowers/specs/2026-06-13-voxelfold-mvp-design.md` (§17 Cuestiones abiertas)
- Modify: `docs/spikes/2026-06-13-hytale-formato.md`

- [ ] **Step 1: Resolver en la nota de spike las cuestiones abiertas del spec**

Para cada punto de §17 del spec (ruta macOS, esquema de la matriz, mapeo block_id→textura/icono, tamaños típicos), escribir la respuesta concreta hallada. Para el "formato definitivo del VoxelModel", anotar una recomendación basada en los tamaños reales observados (binario compacto si los prefabs superan ~varios miles de bloques; JSON comprimido si son pequeños).

- [ ] **Step 2: Actualizar §17 del spec marcando cada cuestión como resuelta (con enlace a la nota de spike)**

Editar la sección 17 del spec: cambiar cada punto abierto por "Resuelto: <respuesta> (ver docs/spikes/2026-06-13-hytale-formato.md)".

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-13-voxelfold-mvp-design.md docs/spikes/2026-06-13-hytale-formato.md
git commit -m "spike: cierre de cuestiones abiertas y actualización del spec con formato real"
```

---

### Task 7: Verificación final del spike

- [ ] **Step 1: Confirmar que no se ha colado ningún asset propietario en el repo**

Run:
```bash
git log --stat | grep -iE "BlockTextures|ItemsGenerated|\.png|Assets\.zip" && echo "ALERTA: revisar" || echo "OK: sin assets de Hytale versionados"
git ls-files | grep -iE "\.png$|Assets\.zip$" || echo "OK: no hay PNG/zip versionados"
```
Expected: `OK` en ambos. Si aparece algo, eliminarlo del índice y del historial antes de continuar.

- [ ] **Step 2: Verificar que los fixtures sintéticos son parseables y que la nota de spike responde a las 5 incógnitas del spec**

Run:
```bash
python3 -c "import json; [json.load(open(f)) for f in ['src-tauri/tests/fixtures/prefab_sintetico.json','src-tauri/tests/fixtures/catalogo_sintetico.json']]; print('fixtures OK')"
test -f docs/spikes/2026-06-13-hytale-formato.md && echo "nota de spike OK"
```
Expected: `fixtures OK` y `nota de spike OK`.

- [ ] **Step 3: Marcar el spike como completado (resumen al final de la nota)**

Añadir al final de la nota de spike un bloque "Resumen / siguiente paso": confirmar que el formato real está documentado y que se puede redactar el Plan 2 (Fundación del Core) con TDD basado en estos fixtures.

- [ ] **Step 4: Commit**

```bash
git add docs/spikes/2026-06-13-hytale-formato.md
git commit -m "spike: completado — formato de Hytale documentado, listo para Plan 2"
```

---

## Definición de "hecho" (Plan 1)

- [ ] Rutas reales de Hytale en macOS documentadas.
- [ ] Estructura del `Assets.zip` y convención de nombres documentadas.
- [ ] Esquema real del `prefab.json` (paleta, matriz, ejes) documentado.
- [ ] Fixtures sintéticos (`prefab_sintetico.json`, `catalogo_sintetico.json`) creados y validados.
- [ ] §17 del spec cerrada con respuestas reales.
- [ ] Cero assets propietarios versionados.
- [ ] Nota de spike lista para informar el Plan 2.
