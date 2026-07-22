# Compatibilidad con Hytale Shared Source

Última auditoría: **2026-07-22** · rama `pre-release` del fork de SwonDev · commit
`ac086418f75543ab4dcaccb9ebaba63500aeea83` (sincronización de 2026-07-17).

La fuente canónica es el repositorio privado
[`HypixelStudios/hytale-shared-source`](https://github.com/HypixelStudios/hytale-shared-source). La
rama [`SwonDev/hytale-shared-source#pre-release`](https://github.com/SwonDev/hytale-shared-source/tree/pre-release)
es el espejo autenticado usado para auditar los cambios. Esta relación y la revisión compatible
quedan fijadas en `hytale-source-contract.json`; no se confunde el espejo con el origen oficial.

## Contrato de compatibilidad

Voxelfold trata `Assets.zip` como una dependencia externa versionada y no da por hecho que todas
las definiciones seguirán teniendo el mismo schema. La pantalla **Ajustes → Compatibilidad de
assets** muestra cuántas definiciones se procesaron, los fallos de lectura/parseo y una muestra
acotada de los archivos incompatibles.

El mismo control puede ejecutarse sin abrir la interfaz:

```bash
cd src-tauri
cargo run --example asset_audit -- "/ruta/a/Assets.zip"
```

El comando termina con código `2` cuando alguna definición queda fuera del catálogo, por lo que se
puede usar como puerta de calidad al actualizar el juego.

Para detectar si el código fuente oficial sincronizado en el espejo ha avanzado:

```bash
npm run source:check
```

La comprobación no guarda credenciales. Usa el helper de Git del equipo y termina con código `2`
si existe una revisión todavía no auditada. En tiempo de ejecución, Voxelfold reescanea la
instalación local al arrancar, cada cinco minutos y al recuperar el foco; una versión nueva se abre,
se analiza y se publica de forma transaccional. Su revisión invalida las cachés de modelos,
texturas, iconos, vegetación, audio y chrome de interfaz, por lo que una actualización no mezcla
recursos nuevos y antiguos.

El workflow `Vigilar Hytale Shared Source` repite la comprobación cada seis horas. Como el espejo es
privado, el repositorio de Voxelfold debe disponer de un secreto de Actions
`HYTALE_SHARED_SOURCE_TOKEN` con acceso de **solo lectura**; el token se entrega como secreto de
entorno al cliente oficial `gh`, no se guarda en el código ni en el contrato.

## Resultado de la auditoría actual

| Fuente | Definiciones | Procesadas | Bloques | Modelos | Hitboxes | Multicelda | Fallos |
|---|---:|---:|---:|---:|---:|---:|---:|
| Instalación local (`Assets.zip`) | 3.641 | 3.641 | 2.943 | 2.463 | 244 | 412 | 0 |
| Shared Source `ac086418` | 3.667 | 3.667 | 2.953 | 2.465 | 244 | 413 | 0 |

La fila de Shared Source se genera reconstruyendo un paquete de catálogo con las definiciones y
hitboxes de `HytaleAssets` de la revisión indicada. Los 26 items nuevos se integran sin cambios
manuales y sin fallos; el recuento de modelos incluye los heredados después de resolver `Parent`.

Cambios relevantes incorporados:

- `BlockType.CustomModelScale` se propaga al visor, editor, prefabs de vegetación y cobertura de
  suelo. Solo se aceptan valores numéricos, finitos y positivos; el valor por defecto es `1`.
- `RotationTuple` se interpreta en su rango oficial completo `0..63` como
  `roll * 16 + pitch * 4 + yaw`. Editor, visor, orientación automática y transformaciones de
  selección conservan los tres ejes y componen la matriz `Ry · Rx · Rz`.
- `BlockType.HitboxType` se resuelve contra las definiciones heredables de
  `Server/Item/Block/Hitboxes`. La guía de capas reproduce el algoritmo oficial de celdas de relleno
  para puertas, camas, muebles y otros bloques multicelda, distinguiendo el ancla que se coloca de la
  huella física ocupada y avisando de solapamientos.
- Dos assets oficiales de telarañas repiten `TextureComputedColor`. El parser conserva el último
  valor, igual que un cargador JSON tolerante, en vez de descartar toda la definición.
- Los prefabs examinados continúan en formato `version: 8`; `blockIdVersion: 11` es metadato del
  registro de bloques y no cambia la estructura que consume Voxelfold.

## Protección frente a entradas no confiables

- Archivos, respuestas HTTP, entradas ZIP y tamaño total descomprimido tienen límites explícitos;
  superar un límite produce un error, nunca un truncado silencioso.
- Los modelos se validan antes de guardar o renderizar: fases, dimensiones, posiciones duplicadas,
  rotaciones, nombres y número de bloques.
- Las descargas de comunidad solo admiten HTTPS desde el host esperado y no siguen redirecciones
  automáticas a otros orígenes.
- Voxelfold sigue el modelo BYO: esta auditoría no incorpora ni redistribuye recursos de Hytale.
