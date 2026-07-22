# Fixtures de test — Core de Voxelfold

> **Estos archivos son SINTÉTICOS.** No son archivos de Hytale ni contienen assets propietarios. Están hechos a mano para **replicar el esquema real** de Hytale documentado en
> [`docs/spikes/2026-06-13-hytale-formato.md`](../../../docs/spikes/2026-06-13-hytale-formato.md), de modo que los tests del Core puedan ejecutarse sin depender de una instalación de Hytale ni versionar contenido del juego.

## Archivos

### `prefab_sintetico.json`
Replica el esquema real de `*.prefab.json` (versión 8): `version`, `blockIdVersion`, `anchorX/Y/Z`, y `blocks[]` con `{x, y, z, name, rotation?}`.

Contiene un cubo 2×2×2 con un hueco `Empty` y un bloque con `rotation`.

**Valores esperados para los tests:**
- Bloques totales en la lista: **8**
- Bloques reales (excluyendo `Empty`): **7**
- Conteo de materiales:
  - `Rock_Stone`: **4**
  - `Wood_Fir_Trunk`: **2**
  - `Wood_Darkwood_Stairs`: **1**
- Bounding box: X `0..1`, Y `0..1`, Z `0..1` → tamaño derivado **2×2×2**

### `catalogo_bloque_sintetico.json`
Replica la estructura de las definiciones de bloque de `Server/Item/Items/**/*.json`: `TranslationProperties.Name`, `Icon`, `Categories`, `BlockType.{Material, DrawType, Group, Textures, TextureComputedColor}`.

Incluye tres bloques con casos representativos:
- `Rock_Stone`: textura `All` con variantes por `Weight`.
- `Wood_Fir_Trunk`: texturas por cara (`Top` / `Side`).
- `Wood_Darkwood_Stairs`: `DrawType: "Stairs"` (forma no cúbica).

### `server_sintetico.lang`
Replica el formato de `Server/Languages/<locale>/server.lang` (`clave = valor`, con comentarios `#`). Sirve para el parser de nombres legibles.

**Esperado:** `items.Rock_Stone.name` → `Stone`.

## Nota sobre nombres técnicos
Los `name` usados (`Rock_Stone`, `Wood_Fir_Trunk`, `Wood_Darkwood_Stairs`) coinciden con block IDs reales de Hytale a propósito, para que las pruebas de integración contra una instalación real (opcionales, marcadas `#[ignore]`) puedan reutilizar los mismos identificadores. Los **valores** (texturas, colores, nombres legibles) son de prueba.
