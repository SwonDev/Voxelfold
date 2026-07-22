import type { BlockInfo } from "@/lib/api";

/**
 * Resuelve cómo renderizar un voxel a partir de su nombre (que puede incluir un
 * estado de forma, p. ej. `*Wood_Deadwood_Roof_State_Definitions_Corner_Right`).
 * Devuelve el modelo/ textura/ tinte/ color efectivos.
 */
export interface RenderSpec {
  block: BlockInfo | undefined;
  modelPath: string | null;
  modelTexture: string | null;
  modelScale: number;
  flip: string | null;
  tint: string | null;
  cubeTextures: BlockInfo["textures"];
  color: string | null;
  /** El bloque emite luz (antorchas, farolillos…) → renderizar emisivo. */
  light: boolean;
  /** Opacidad "Cutout" (hojas/follaje con huecos) → alphaTest. */
  cutout: boolean;
  /** Follaje que se mece con el viento (hierba, hojas, flores, cultivos…). */
  sway: boolean;
  /** Cristal/hielo/agua → mezcla alfa (semitransparente). */
  translucent: boolean;
  /** Fluido (agua, lava…) → superficie ondulada animada. */
  fluid: boolean;
  /** Tejado/slope degradado: renderizar como CUÑA (pendiente limpia) en vez de cubo. */
  wedge: boolean;
  /** Forma del tejado degradado: pendiente recta, esquina exterior (hip) o interior. */
  roofShape: "slope" | "corner" | "inner" | null;
  /** El bloque es un tejado (modelPath bajo `/Roofs/`): se le da un pequeño sesgo de
   *  profundidad para evitar z-fighting al solapar con bloques vecinos. */
  roof: boolean;
}

/**
 * ¿Es un MARCADOR de generación/lógica de Hytale (no un bloque de construcción)?
 * Spawners (`Block_Spawner_Block`, `Prefab_Spawner_Block`, `Spawner_Rat`…), géiseres,
 * objetivos, barreras, filtros, marcadores de prefab y bloques WIP/debug. Se renderizan
 * como "jaulas" raras y ensucian los prefabs → se filtran del editor y del visor.
 */
export function isMarkerName(name: string): boolean {
  const n = name.startsWith("*") ? name.slice(1) : name;
  return (
    /spawner|geyzer|objective_|exampleprefab|placeholder|trigger|^barrier$|^filter_|^template_|^empty$/i.test(n) ||
    /(^|_)(tmp|prototype|debug)(_|$)/i.test(n) ||
    /^test_|_test$/i.test(n) ||
    n.includes("[TMP]")
  );
}

/**
 * ¿Es follaje que se mece con el viento? Hierba alta, flores, helechos, hojas, enredaderas,
 * cultivos… Se excluye explícitamente la madera (troncos/tablones) y, vía el gate de `cutout`
 * en {@link resolveBlock}, el suelo sólido (bloque de hierba/tierra no se mece).
 */
export function isSwayName(name: string): boolean {
  const n = name.startsWith("*") ? name.slice(1) : name;
  // Suelo sólido (tierra con hierba, arena…) y madera (troncos/tablones) NO se mecen.
  if (/^(soil|dirt|sand|stone|gravel|mud|clay|snow|rock|cobble|grass_block)/i.test(n)) return false;
  if (/_(Log|Wood|Plank|Planks|Stem|Trunk)(_|$)/i.test(n)) return false;
  return /(^|_)(plant|foliage|leaf|leaves|grass|fern|flower|vine|ivy|crop|bush|shrub|sapling|sprout|wheat|reed|petal|frond|seagrass|kelp|lily|cattail)(_|$)/i.test(n);
}

/**
 * ¿Es una FUENTE DE LUZ? (para emitir luz puntual realista en la escena). El flag
 * `light` del catálogo es poco fiable (las antorchas vienen con `Light` sin definir →
 * `light=false`), así que se complementa por nombre: antorchas, faroles, velas, braseros,
 * hogueras, lámparas, cristales luminosos, lava/ascuas…
 */
export function isLightName(name: string): boolean {
  const n = name.startsWith("*") ? name.slice(1) : name;
  return /(^|_)(torch|lantern|lamp|candle|brazier|campfire|firepit|fire|sconce|chandelier|glow|ember|lava|forge|furnace|beacon|crystal_light)(_|$)/i.test(n);
}

/** Separa el nombre en bloque base y estado de forma (si lo trae). */
export function parseBlockName(name: string): { base: string; state: string | null } {
  const raw = name.startsWith("*") ? name.slice(1) : name;
  const i = raw.indexOf("_State_Definitions_");
  if (i > 0) return { base: raw.slice(0, i), state: raw.slice(i + "_State_Definitions_".length) };
  return { base: raw, state: null };
}

export function resolveBlock(catalog: Map<string, BlockInfo>, name: string): RenderSpec {
  const { base, state } = parseBlockName(name);
  const block = catalog.get(name) ?? catalog.get(base);

  let modelPath: string | null = block?.model ?? null;
  let modelTexture: string | null = block?.model_texture ?? null;
  let modelScale =
    Number.isFinite(block?.model_scale) && (block?.model_scale ?? 0) > 0
      ? block!.model_scale
      : 1;
  let tint = block?.tint ?? null;
  let opacity = block?.opacity ?? null;
  let light = block?.light ?? false;
  let flip: string | null = null;

  // Estado de forma (escalón/tejado/losa…): usa el modelo de ese estado.
  if (state && block?.states?.length) {
    const def = block.states.find((s) => s.state === state);
    if (def) {
      modelPath = def.model;
      modelTexture = def.model_texture ?? modelTexture;
      modelScale = Number.isFinite(def.model_scale) && def.model_scale > 0 ? def.model_scale : modelScale;
      tint = def.tint ?? tint;
      opacity = def.opacity ?? opacity;
      light = def.light || light;
      flip = def.flip;
    }
  }

  // Forma base/recta sin modelo directo: muchos bloques (escaleras rectas, tejados
  // en pendiente, vigas…) no traen CustomModel pero su modelo se deriva de la ruta de
  // la textura: `<dir>/<Forma>_Textures/<x>.png` → `<dir>/<Forma>.blockymodel`.
  if (!modelPath && block?.model_texture) {
    const m = block.model_texture.match(/^(.*)_Textures\/[^/]+$/);
    if (m) {
      let stem = m[1]; // p. ej. Blocks/Structures/Roofs/Slope_Rock | …/Slope_Hay | …/Slope
      // TEJADOS: el sufijo de VARIANTE del nombre del bloque (_Shallow/_Steep/_Flat/_Hollow)
      // elige un MODELO DE PENDIENTE distinto, todos sobre el MISMO atlas de textura. Sin esto,
      // Shallow/Steep/Flat derivaban el mismo `Slope_Rock` → "solo aparece un tipo". Convención
      // de Hytale: Shallow/Steep/Hollow = `<forma>_<variante>`; Flat de las familias Slope* usa
      // `Flat[_resto]` (Flat_Rock, Flat_Hay, Flat); el resto de familias usa `<forma>_Flat`.
      if (/\/Roofs\//.test(stem)) {
        const slash = stem.lastIndexOf("/");
        const dir = stem.slice(0, slash + 1);
        const form = stem.slice(slash + 1); // Slope_Rock | Slope_Hay | Slope | Metal_Roof | Cloth_Roof
        if (/_Shallow$/.test(base)) stem = `${stem}_Shallow`;
        else if (/_Steep$/.test(base)) stem = `${stem}_Steep`;
        else if (/_Hollow$/.test(base)) stem = `${stem}_Hollow`;
        else if (/_Topper$/.test(base)) {
          stem = form.startsWith("Slope") ? `${dir}Topper${form.slice(5)}` : `${stem}_Topper`;
        } else if (/_Flat$/.test(base)) {
          stem = form.startsWith("Slope") ? `${dir}Flat${form.slice(5)}` : `${stem}_Flat`;
        }
      }
      modelPath = `${stem}.blockymodel`;
    }
  }
  // Fallback: si tiene estados pero la textura no era derivable (p. ej. escaleras con
  // textura de tronco), el modelo recto está en la carpeta de los modelos de estado:
  // `<dir>/<últimaCarpeta>.blockymodel` (p. ej. .../Stairs/Stairs.blockymodel).
  if (!modelPath && block?.states?.length) {
    const sm = block.states[0].model;
    const slash = sm.lastIndexOf("/");
    if (slash > 0) {
      const dir = sm.slice(0, slash);
      const seg = dir.slice(dir.lastIndexOf("/") + 1);
      modelPath = `${dir}/${seg}.blockymodel`;
    }
  }

  // Último recurso por convención de forma: losas/cuartos sin modelo declarado usan
  // las formas base compartidas de Hytale con su propia textura (BlockTextures/…).
  if (!modelPath && block) {
    if (/_Half$/.test(base)) {
      modelPath = "Blocks/Structures/Base_Shapes/HalfBlock_Flat_Shaded.blockymodel";
    } else if (/_Quarter$/.test(base)) {
      modelPath = "Blocks/Structures/Base_Shapes/QuarterBlock.blockymodel";
    }
  }

  // TEJADOS (`Blocks/Structures/Roofs/...`): ahora se renderizan con su MODELO REAL
  // (`.blockymodel` + textura) — el parser de nodos (port JannisX11) recompone bien las
  // rotaciones anidadas, así que salen con su textura real (piel/teja/paja) en vez del color
  // plano de la cuña aproximada, que el usuario rechazó por "textura plana". La degradación a
  // CUÑA/cubo de color queda como respaldo conmutable (DEGRADE_ROOFS) por si algún tipo
  // concreto saliera aberrante; hoy está DESACTIVADA.
  const roof = !!modelPath && /\/Roofs\//.test(modelPath);
  let roofToCube = false;
  let wedge = false;
  let roofShape: RenderSpec["roofShape"] = null;
  const DEGRADE_ROOFS = false;
  if (DEGRADE_ROOFS && modelPath && /\/Roofs\//.test(modelPath)) {
    // Las piezas planas de tejado (`*_Flat`) son horizontales → quedan como cubo.
    // El resto → LOSA limpia: pendiente recta, esquina exterior (hip) o interior.
    const flatRoof = /flat/i.test(name) || /flat/i.test(modelPath);
    modelPath = null;
    roofToCube = true;
    wedge = !flatRoof;
    if (wedge) {
      const st = (state ?? "").toLowerCase();
      roofShape =
        st.includes("inverted") && st.includes("corner")
          ? "inner"
          : st.includes("corner")
            ? "corner"
            : "slope";
    }
  }

  // Textura de cubo: las caras declaradas o, como fallback, la textura del modelo como
  // cara "All". OJO: para tejados degradados a cubo NO se usa la textura del modelo —
  // es un ATLAS del slope (UV de caras inclinadas) y sobre un cubo sale ROTA (triángulos,
  // huecos). Para esos se usa el color nativo computado del bloque (sólido y limpio).
  let cubeTextures = block?.textures ?? [];
  // Un `model_texture` es un ATLAS UV del `.blockymodel`, no una textura de cubo. Usarlo
  // mientras el modelo carga/falla produce exactamente los triángulos negros y caras rotas
  // que se veían en los tejados. Solo es válido como fallback si no existe ningún modelo.
  if (cubeTextures.length === 0 && block?.model_texture && !roofToCube && !modelPath) {
    cubeTextures = [{ face: "All", path: block.model_texture, weight: 1, variant: 0 }];
  }

  // Recorte por alpha (alphaTest) para cubos con zonas transparentes: `Cutout` y también
  // `Transparent` (rejas, cajas con huecos, follaje-cubo…). Sin esto, las zonas transparentes
  // de su textura salían como un panel opaco/oscuro (silueta "sin textura"). El cristal/hielo
  // uniforme usa `Semitransparent` → va por `translucent` (mezcla alfa), no por aquí.
  const cutout = opacity === "Cutout" || opacity === "Transparent";

  return {
    block,
    modelPath,
    modelTexture,
    modelScale,
    flip,
    tint,
    cubeTextures,
    color: block?.fallback_color ?? null,
    light,
    cutout,
    // El follaje (hierba alta, flores, helechos, enredaderas, hojas…) se mece. El suelo
    // sólido y la madera quedan fijos (excluidos por nombre en isSwayName) y nunca se
    // mece nada marcado como Solid (cubo opaco macizo).
    sway: isSwayName(base) && opacity !== "Solid",
    // Cristal/hielo (Semitransparent) y agua/fluidos → mezcla alfa (ver a través).
    translucent: opacity === "Semitransparent" || base.startsWith("Fluid_"),
    fluid: base.startsWith("Fluid_"),
    wedge,
    roofShape,
    roof,
  };
}
