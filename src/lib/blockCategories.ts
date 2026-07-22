import type { BlockInfo } from "@/lib/api";

/**
 * Organización inteligente de bloques. Hytale trae `Categories` ("Blocks.Wood",
 * "Furniture.Doors", …) pero el ~39% de los bloques NO la traen. Para que TODO quede
 * bien organizado, si falta la categoría la DERIVAMOS del nombre técnico (material), y
 * además exponemos una dimensión de FORMA (cubo, losa, escalera, tejado, valla…) para
 * filtrar por forma además de por material.
 */

const TOP_LABELS: Record<string, string> = {
  Blocks: "Bloques",
  Furniture: "Mobiliario",
  Items: "Objetos",
  Tool: "Herramientas",
  Otros: "Otros",
};

const SUB_LABELS: Record<string, string> = {
  Wood: "Madera",
  Plants: "Plantas",
  Rocks: "Rocas",
  Deco: "Decoración",
  Soils: "Tierra",
  Soil: "Tierra",
  Cloth: "Tela",
  Metal: "Metal",
  Glass: "Cristal",
  Ice: "Hielo y nieve",
  Ores: "Minerales",
  Fluids: "Fluidos",
  Portals: "Portales",
  Containers: "Contenedores",
  Doors: "Puertas y ventanas",
  Furniture: "Muebles",
  Lighting: "Iluminación",
  Shelves: "Estantes",
  Signs: "Carteles",
  Benches: "Bancos y mesas",
  Beds: "Camas",
  Weapons: "Armas",
  Tools: "Herramientas",
  Ingredients: "Ingredientes",
  Armors: "Armaduras",
  Recipes: "Recetas",
  Potions: "Pociones",
  Foods: "Comida",
  TechnicalBlocks: "Técnicos",
  BuilderTool: "Construcción",
  BrushFilters: "Brochas",
  PrefabEditing: "Prefabs",
  Machinima: "Machinima",
};

// Derivación material por NOMBRE técnico (cuando el bloque no trae Categories).
const NAME_RULES: [RegExp, string, string][] = [
  // Consumibles y objetos (no son materiales de construcción, pero son colocables).
  [/^potion_/i, "Items", "Potions"],
  [/^food_|^drink_|^meal_/i, "Items", "Foods"],
  [/^ingredient_/i, "Items", "Ingredients"],
  // Técnicos / WIP / depuración / entidades de juego (spawners, objetivos).
  [/^prototype_|^debug_|^test_|placeholder/i, "Blocks", "TechnicalBlocks"],
  [/^objective_|spawner|geyzer|geyser|trigger/i, "Blocks", "TechnicalBlocks"],
  // Escombros y decoración suelta.
  [/rubble|debris/i, "Blocks", "Rocks"],
  [/^deco_/i, "Blocks", "Deco"],
  [/door|window|hatch|gate/i, "Furniture", "Doors"],
  [/torch|lantern|lamp|candle|chandelier|sconce|brazier|light/i, "Furniture", "Lighting"],
  [/chest|barrel|crate|basket|container|pot\b|urn|sack/i, "Furniture", "Containers"],
  [/bookshelf|shelf|shelves|rack|cabinet|wardrobe/i, "Furniture", "Shelves"],
  [/bench|table|chair|stool|desk|counter|seat/i, "Furniture", "Benches"],
  [/\bbed\b|bedroll|hammock/i, "Furniture", "Beds"],
  [/sign|banner_sign|placard/i, "Furniture", "Signs"],
  [/glass|window_pane/i, "Blocks", "Glass"],
  [/^ore_|_ore\b|_ore_/i, "Blocks", "Ores"],
  [/^metal_|iron|copper|steel|bronze|tin|silver|adamant|cobalt|\bgold_/i, "Blocks", "Metal"],
  [/^cloth_|wool|carpet|tapestry|banner|fabric|silk|linen/i, "Blocks", "Cloth"],
  [/^fluid_|water|lava|magma_fluid/i, "Blocks", "Fluids"],
  [/snow|\bice\b|frost|frozen/i, "Blocks", "Ice"],
  [/^plant_|flower|leaf|leaves|foliage|crop|mushroom|vine|cactus|sapling|fern|reed|moss|bush|shrub|grass_tall|kelp|coral/i, "Blocks", "Plants"],
  [/^soil_|dirt|gravel|\bsand\b|clay|mud|peat|loam|ash\b|\bgrass\b/i, "Blocks", "Soils"],
  [/^wood_|planks?|_log\b|_trunk|timber|bamboo|plank/i, "Blocks", "Wood"],
  [/^rock_|stone|basalt|granite|marble|sandstone|slate|obsidian|cobble|flint|chalk|tuff/i, "Blocks", "Rocks"],
  [/portal/i, "Blocks", "Portals"],
];

export interface BlockCats {
  top: string;
  sub: string | null;
}

/** Categoría/subcategoría: usa la del juego si existe; si no, la deriva del nombre. */
export function blockCats(block: Pick<BlockInfo, "name" | "categories">): BlockCats {
  const first = block.categories?.[0];
  if (first) {
    const [top, sub] = first.split(".");
    return { top: top || "Otros", sub: sub || null };
  }
  for (const [re, top, sub] of NAME_RULES) {
    if (re.test(block.name)) return { top, sub };
  }
  return { top: "Otros", sub: null };
}

// --- Dimensión de FORMA (independiente del material) ---

const SHAPE_RULES: [RegExp, string][] = [
  [/_half\b|_slab|halfblock/i, "Slab"],
  [/quarter/i, "Quarter"],
  [/stairs?/i, "Stairs"],
  [/roof/i, "Roof"],
  [/fence/i, "Fence"],
  [/_wall\b|brick_wall|stone_wall/i, "Wall"],
  [/beam/i, "Beam"],
  [/pillar|column/i, "Pillar"],
  [/brick/i, "Brick"],
  [/cobble/i, "Cobble"],
  [/smooth|polished/i, "Smooth"],
  [/tile\b|tiles/i, "Tile"],
  [/planks?\b/i, "Planks"],
  [/_log\b|_trunk/i, "Log"],
];

const SHAPE_LABELS: Record<string, string> = {
  Slab: "Losas", Quarter: "Cuartos", Stairs: "Escaleras", Roof: "Tejados", Fence: "Vallas",
  Wall: "Muros", Beam: "Vigas", Pillar: "Pilares", Brick: "Ladrillo", Cobble: "Adoquín",
  Smooth: "Pulido", Tile: "Baldosa", Planks: "Tablones", Log: "Troncos", Block: "Bloque entero",
};

/** Forma del bloque (Losa, Escalera, Tejado…) derivada del nombre. "Block" = cubo entero. */
export function blockShape(name: string): string {
  for (const [re, shape] of SHAPE_RULES) if (re.test(name)) return shape;
  return "Block";
}

export function topLabel(top: string): string {
  return TOP_LABELS[top] ?? top;
}
export function subLabel(sub: string): string {
  return SUB_LABELS[sub] ?? sub;
}
export function shapeLabel(shape: string): string {
  return SHAPE_LABELS[shape] ?? shape;
}
