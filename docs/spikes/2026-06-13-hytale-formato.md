# Spike — Formato real de Hytale (Early Access, Update 5)

- **Fecha:** 2026-06-13
- **Máquina:** macOS (instalación nativa del usuario; NO capa de compatibilidad)
- **Objetivo:** Fijar rutas y esquemas reales de Hytale para el Core de Voxelfold, sin versionar assets propietarios.
- **Resultado:** ✅ Formatos confirmados sobre archivos reales. La documentación web pública estaba **desactualizada** (describía un `prefab.json` con `Palette` de caracteres que **no** corresponde al formato real v8).

> **IMPORTANTE (legal):** este documento contiene solo fragmentos pequeños y anotados con fines de documentación de formato. No se ha copiado ni versionado ningún asset real (texturas, iconos, prefabs completos, fuentes) en el repositorio.

---

## 1. Rutas reales (macOS)

| Qué | Ruta |
|---|---|
| Raíz de datos | `~/Library/Application Support/Hytale/` |
| Instalación del juego | `~/Library/Application Support/Hytale/install/release/package/game/latest/` |
| **Assets.zip** | `.../latest/Assets.zip` (**3,2 GB, 60.148 archivos**) |
| Cliente | `.../latest/Client/Hytale.app` (app nativa macOS) |
| Servidor | `.../latest/Server/` |
| Datos de usuario | `~/Library/Application Support/Hytale/UserData/` |
| Caché de prefabs (binaria) | `.../UserData/PrefabCache/Hytale_Hytale/Server/Prefabs/**/*.prefab.json.lpf` |
| Launcher | `/Applications/Hytale Launcher.app` |

**Detección multiplataforma (para el Hytale Locator):**
- macOS: `~/Library/Application Support/Hytale/install/release/package/game/latest/Assets.zip`
- Windows (documentado): `%AppData%/Hytale/Install/release/package/game/latest/` (validar `Roaming` vs no, mayúsculas)
- Fallback SIEMPRE: selección manual de la carpeta `latest/` o del `Assets.zip` por el usuario.

## 2. Estructura del `Assets.zip`

Top-level: `Common/`, `Cosmetics/`, `Server/`, `manifest.json`, `CommonAssetsIndex.hashes`, `Name`.

`manifest.json` es trivial: `{ "Group": "Hytale", "Name": "Hytale" }`.

**Decisión de diseño:** con 60k entradas y 3,2 GB, el Asset Reader **NO** debe extraer el zip entero. Debe abrir el `Assets.zip` y leer **entradas individuales bajo demanda** (el crate `zip` de Rust permite acceso por nombre). Cachear en disco solo los PNG que se vayan necesitando.

### Rutas relevantes dentro del zip
- **Texturas de bloque:** `Common/BlockTextures/*.png` — nombres CamelCase con sufijos de cara: `Rock_Stone.png`, `Calcite_Top.png`, `Calcite_Brick_Side02.png`, `Bone_Side.png`.
- **Iconos de UI (renderizados):** `Common/Icons/ItemsGenerated/<name>.png` — p. ej. `Rock_Stone.png`, `Wood_Fir_Trunk.png`. **Correspondencia directa** con el campo `Icon` de la definición del bloque.
- **Definiciones de bloque/item:** `Server/Item/Items/**/*.json`.
- **Listas/agrupaciones de bloques:** `Server/BlockTypeList/*.json` (Rock, Soils, Ores, TreeWood, PlantsAndTrees, ...).
- **Nombres legibles (i18n):** `Server/Languages/<locale>/server.lang`. Locales presentes: `en-US`, `pt-BR`, `ru-RU`, `uk-UA`, `zh-CN`. **No hay `es-ES`** → Voxelfold usará `en-US` como base para el ID/nombre técnico y aportará su propia capa de español.
- **Prefabs del juego base:** `Server/Prefabs/**/*.prefab.json` (**7.839** en JSON plano) + 2 `*.minigame.prefab.json`.

## 3. Esquema REAL de `*.prefab.json` (versión 8)

> **Difiere de la doc web.** No hay `Palette`, ni `Size`, ni `Type`/`Id`. Es una lista explícita de bloques con coordenadas absolutas.

```json
{
  "version": 8,
  "blockIdVersion": 11,
  "anchorX": 0,
  "anchorY": 4,
  "anchorZ": 0,
  "blocks": [
    { "x": -2, "y": 0, "z": 0, "name": "Wood_Fir_Trunk" },
    { "x": -1, "y": 2, "z": 0, "name": "Wood_Darkwood_Stairs", "rotation": 2 },
    { "x": -1, "y": 3, "z": 0, "name": "Empty" }
  ]
}
```

**Reglas confirmadas:**
- `blocks` = lista de objetos `{ x, y, z, name, rotation? }`.
- Coordenadas **absolutas**, **pueden ser negativas**. El bounding box (min/max por eje) da el tamaño real; no hay campo `Size`.
- `name` = block ID técnico directo (= nombre de fichero de la definición en `Server/Item/Items`, p. ej. `Rock_Stone`).
- `rotation` = entero opcional (orientación; relevante para formas no cúbicas como escaleras).
- `"Empty"` = hueco explícito → **se excluye** del conteo de materiales y del render.
- `version` / `blockIdVersion` = versionado del formato → el parser debe leerlos y tolerar futuras versiones (advertir si `version` desconocida).
- **Ejes:** X, Y (altura), Z. Y es la vertical (coincide con `anchorY` mayor en prefabs altos).

**Materiales** = contar `blocks[].name` con `name != "Empty"`, agrupado por nombre.

## 4. Esquema REAL de definición de bloque (`Server/Item/Items/**/*.json`)

Ejemplo (`Server/Item/Items/Rock/Stone/Rock_Stone.json`, abreviado):

```json
{
  "TranslationProperties": { "Name": "server.items.Rock_Stone.name" },
  "Icon": "Icons/ItemsGenerated/Rock_Stone.png",
  "Categories": ["Blocks.Rocks"],
  "Set": "Rock_Stone",
  "BlockType": {
    "Material": "Solid",
    "DrawType": "Cube",
    "Group": "Stone",
    "Textures": [
      { "All": "BlockTextures/Rock_Stone.png", "Weight": 2 },
      { "All": "BlockTextures/Rock_Stone_2.png", "Weight": 1 }
    ],
    "ParticleColor": "#737055",
    "TextureComputedColor": "#79785A",
    "Aliases": ["stone", "stone00"]
  }
}
```

**Mapeo `block.name` → datos (para el catálogo del Asset Reader):**
- **Icono UI:** `Icon` → ruta dentro de `Common/` → `Common/Icons/ItemsGenerated/Rock_Stone.png`. (verificado que existe)
- **Texturas del visor:** `BlockType.Textures[]`. Cada entrada puede usar `All` (todas las caras) o caras concretas (`Top`, `Side`, `Bottom`, etc.) y un `Weight` (variantes aleatorias). Ruta relativa a `Common/`: `Common/BlockTextures/Rock_Stone.png`.
- **Nombre legible:** `TranslationProperties.Name` (clave i18n) → resolver en `server.lang`. (El `.lang` usa claves `items.<name>.name`; la def usa `server.items.<name>.name` — el Asset Reader debe normalizar el prefijo `server.` al resolver.)
- **Forma:** `BlockType.DrawType` (`Cube` y otros: escaleras, slabs, cross para plantas...). Determina cómo renderiza el visor.
- **Color fallback:** `TextureComputedColor` (color promedio) → útil para representar bloques en el visor antes de cargar la textura, o como fallback si falta.
- **Categoría:** `Categories` / `BlockType.Group` / `Tags` → clasificación.

## 5. Nombres legibles (`server.lang`)

Formato de texto plano `clave = valor`:

```
items.Rock_Calcite.name = Calcite
items.Rock_Calcite_Brick.name = Calcite Brick
items.Rock_Calcite_Brick_Half.name = Calcite Brick - Half Slab
```

El parser de `.lang` es trivial (ignorar líneas `#` comentario y vacías; partir por el primer `=`).

## 6. Formato `.lpf` (caché de prefabs) — NO necesario

`UserData/PrefabCache/**/*.prefab.json.lpf` es un **formato binario propietario** (no gzip/zlib/zstd) con strings de longitud-prefijada (u16 big-endian). Es la versión compilada/cacheada del prefab. **Voxelfold NO lo usa**: trabajamos con los `*.prefab.json` planos (7.839 en el zip + los que exporte el Prefab Editor). Documentado por completitud, sin necesidad de ingeniería inversa.

## 7. Impacto en el diseño (correcciones al spec)

1. **Prefab Parser (spec §6.3):** parsea `{version, blockIdVersion, anchorX/Y/Z, blocks:[{x,y,z,name,rotation?}]}`. No hay paleta de caracteres.
2. **VoxelModel (spec §7):** lista de `{x,y,z, block_name, rotation}` con coords absolutas; el tamaño se deriva del bounding box; `Empty` se descarta. La `phase_index` se añade en curación.
3. **Materials Calc (spec §6.4):** conteo por `name != "Empty"`.
4. **Asset Reader (spec §6.2):** lectura por entrada del zip (no extracción total); catálogo desde `Server/Item/Items/**/*.json` + `server.lang`; iconos/texturas vía rutas `Common/...`.
5. **i18n:** no hay español en el juego → capa propia de español en Voxelfold; usar `en-US` como fuente del nombre técnico/base.

## 8. Cierre de cuestiones abiertas del spec (§17)

1. **Ruta macOS:** ✅ `~/Library/Application Support/Hytale/install/release/package/game/latest/Assets.zip` (nativa).
2. **Esquema de la matriz:** ✅ lista explícita `blocks[]` con coords absolutas + `rotation` opcional + `Empty`; ejes X/Y(alto)/Z; sin Size (bounding box).
3. **Mapeo `block_id`→textura/icono:** ✅ vía `Server/Item/Items/**/*.json` (`Icon`, `BlockType.Textures`), rutas relativas a `Common/`.
4. **Formato del `VoxelModel`:** recomendación → **JSON comprimido** por build para el MVP (los prefabs base rondan 1–25 KB; el mayor visto, `Blocksets_08.prefab.json`, ~4,2 MB es un caso atípico de "blockset"). Reevaluar binario solo si aparecen builds con >100k bloques.
5. **`rusqlite` vs `sqlx`:** recomendación → **`rusqlite`** (síncrono, simple, sin runtime async; suficiente para una app de escritorio local). Reevaluar `sqlx` solo si se añade backend remoto.

## 9. Resumen / siguiente paso

Formato real de Hytale documentado y verificado sobre la instalación del usuario. Fixtures sintéticos creados en `src-tauri/tests/fixtures/` replicando el esquema real. **Listo para redactar el Plan 2 (Fundación del Core Rust)** con TDD basado en estos fixtures y en estos hallazgos.
