/**
 * Biomas de Hytale para previsualizar un prefab "plantado" en su entorno. Los datos de terreno
 * (pila de materiales por capa, piedra profunda, tintes), el AGUA y la VEGETACIÓN están tomados del
 * GENERADOR DE MUNDO REAL de Hytale (HytaleAssets/Server/HytaleGenerator/Biomes/*): MaterialProvider
 * (bloques por profundidad), TintProvider (color de bioma), EnvironmentProvider/Props (vegetación).
 * Usamos esos datos como REFERENCIA para generar un entorno voxel fiel; los assets se leen de la
 * instalación local del usuario (BYO), nunca se empaquetan. El prefab en sí NO guarda el bioma
 * (igual que en Hytale: lo hereda del mundo); aquí es solo un entorno de previsualización.
 */
export type Flora = "trees" | "pines" | "cactus" | "rocks" | "none";

/** Una capa de material del terreno (de la superficie hacia abajo), con su bloque REAL y grosor. */
export interface TerrainLayer {
  /** Nombre EXACTO del bloque real de Hytale (Soil_Grass, Soil_Dirt, Rock_Marble…). */
  block: string;
  /** Grosor de la capa en bloques. */
  depth: number;
  /** Si true, la superficie se tiñe con el color de bioma (solo suelos de hierba). */
  tint?: boolean;
}

/** Configuración de agua del bioma (nivel del mar relativo al suelo del claro, y=0). */
export interface WaterConfig {
  /** Nivel del mar en bloques (negativo = bajo el claro, que siempre queda seco). */
  sea: number;
  /** Océano: TODO el terreno fuera del claro queda sumergido (el prefab en una isla). */
  ocean?: boolean;
}

export interface Biome {
  id: string;
  name: string;
  /** Tinte representativo del bioma (color medio del TintProvider real). */
  tint: string;
  /** Tintes REALES del TintProvider de Hytale (variación de tono del bioma). */
  tints: string[];
  /** Color de niebla/horizonte (funde el borde del suelo con el cielo). */
  fog: string;
  /** Tipo de vegetación característica (decide si se cargan árboles/plantas). */
  flora: Flora;
  /** Las cimas de las montañas llevan nieve (biomas fríos). */
  snowPeaks?: boolean;
  /** Pila de materiales REAL del bioma (MaterialProvider de Hytale): superficie → subsuelo. */
  layers: TerrainLayer[];
  /** Bloque de piedra profunda real (rellena bajo todas las capas). */
  stone: string;
  /** Agua del bioma (ríos/lagos, u océano). Ausente = bioma seco. */
  water?: WaterConfig;
  /** Rutas de PREFABS reales de árbol de Hytale (Server/Prefabs/…) — variedad por bioma. */
  trees: string[];
  /** Rutas de PREFABS reales de plantas/arbustos de suelo de Hytale. */
  plants: string[];
  /** Bloques Plant_* reales de cobertura del suelo (hierba alta, flores, helechos) — modelo cross. */
  ground: string[];
  /** PREFABS reales de props del entorno (peñascos/rocas de Rock_Formations) — variedad por bioma. */
  props?: string[];
  // --- Campos heredados, conservados por compatibilidad (no usados por el render actual). ---
  rock?: string;
  trunk?: string;
  foliage?: string;
}

const P = (s: string) => `Server/Prefabs/${s}.prefab.json`;

export const BIOMES: Biome[] = [
  {
    // Hytale Plains1 (Oak) — pradera templada con ríos.
    id: "plains",
    name: "Llanuras (Plains)",
    tint: "#6ca229",
    tints: ["#5b9e28", "#6ca229", "#7ea629"],
    fog: "#243a2a",
    flora: "trees",
    layers: [
      { block: "Soil_Grass", depth: 1, tint: true },
      { block: "Soil_Dirt", depth: 3 },
      { block: "Soil_Pebbles", depth: 4 },
    ],
    stone: "Rock_Marble",
    water: { sea: -3 },
    trees: [
      P("Trees/Oak/Stage_3/Oak_Stage3_001"),
      P("Trees/Oak/Stage_2/Oak_Stage2_001"),
      P("Trees/Beech/Stage_3/Beech_Stage3_001"),
      P("Trees/Birch/Stage_3/Birch_Stage3_001"),
      P("Trees/Maple/Stage_3/Maple_Stage3_001"),
    ],
    plants: [P("Plants/Bush/Green/Bush_Green_001"), P("Plants/Bush/Lush/Bush_Lush_001")],
    ground: [
      "Plant_Grass_Lush",
      "Plant_Grass_Lush_Tall",
      "Plant_Flower_Common_Red",
      "Plant_Flower_Common_Blue",
      "Plant_Flower_Bushy_Yellow",
      "Plant_Fern_Forest",
    ],
    props: [
      P("Rock_Formations/Rocks/Stone/Small/Rocks_Stone_Small_001"),
      P("Rock_Formations/Rocks/Stone/Large/Rocks_Stone_Large_001"),
    ],
  },
  {
    // Hytale Desert1 (Rocky) — desierto de dunas y mesetas (seco).
    id: "desert",
    name: "Desierto (Desert)",
    tint: "#e6c66e",
    tints: ["#d4b253", "#e6c66e", "#f2cd66"],
    fog: "#3a3525",
    flora: "cactus",
    layers: [
      { block: "Soil_Sand_White", depth: 4 },
      { block: "Soil_Dirt_Dry", depth: 2 },
      { block: "Rock_Sandstone_White", depth: 3 },
    ],
    stone: "Rock_Sandstone",
    trees: [
      P("Trees/Palm/Stage_3/Palm_Stage3_001"),
      P("Trees/Palm/Stage_3/Palm_Stage3_002"),
      P("Trees/Dry/Stage_3/Dry_Stage3_001"),
      P("Trees/Boab/Stage_3/Boab_Stage3_001"),
    ],
    plants: [
      P("Plants/Cacti/Full/Stage_3/Cacti_Full_Stage_3_001"),
      P("Plants/Bush/Arid/Bush_Arid_001"),
    ],
    ground: ["Plant_Grass_Arid", "Plant_Grass_Dry", "Plant_Flower_Common_Orange"],
    props: [P("Rock_Formations/Rocks/Sandstone/Small/Rocks_Sandstone_Small_001")],
  },
  {
    // Hytale Volcanic1 (Jungle) — jungla densa y húmeda con agua.
    id: "jungle",
    name: "Jungla (Volcanic)",
    tint: "#598D26",
    tints: ["#508A29", "#598D26", "#5F8F26"],
    fog: "#1e2e22",
    flora: "trees",
    layers: [
      { block: "Soil_Grass", depth: 1, tint: true },
      { block: "Soil_Dirt", depth: 3 },
    ],
    stone: "Rock_Stone",
    water: { sea: -3 },
    trees: [
      P("Trees/Bamboo/Stage_3/Bamboo_Stage3_001"),
      P("Trees/Beech/Stage_3/Beech_Stage3_001"),
      P("Trees/Cedar/Stage_3/Cedar_Stage3_001"),
    ],
    plants: [
      P("Plants/Bush/Lush/Bush_Lush_001"),
      P("Plants/Vines/Bush_Hanging/Vines_Bush_Hanging_001"),
    ],
    ground: [
      "Plant_Grass_Jungle",
      "Plant_Grass_Jungle_Tall",
      "Plant_Fern_Jungle",
      "Plant_Flower_Bushy_Violet",
      "Plant_Flower_Bushy_Cyan",
    ],
    props: [
      P("Rock_Formations/Rocks/Stone/Small/Rocks_Stone_Small_001"),
      P("Rock_Formations/Rocks/Volcanic/Large/Rocks_Volcanic_Large_001"),
    ],
  },
  {
    // Hytale Taiga1 (Redwood) — bosque montañoso de coníferas (seco).
    id: "taiga",
    name: "Taiga (Redwood)",
    tint: "#2b602e",
    tints: ["#256f2c", "#2b602e"],
    fog: "#1a2a1f",
    flora: "pines",
    layers: [
      { block: "Soil_Grass", depth: 1, tint: true },
      { block: "Soil_Gravel", depth: 3 },
    ],
    stone: "Rock_Quartzite",
    trees: [
      P("Trees/Redwood/Stage_3/Redwood_Stage3_001"),
      P("Trees/Fir/Stage_3/Fir_Stage3_001"),
      P("Trees/Cedar/Stage_3/Cedar_Stage3_001"),
    ],
    plants: [
      P("Plants/Bush/Green/Bush_Green_001"),
      P("Plants/Mushroom_Large/Green/Stage_1/Mushroom_Large_Green_Stage_1_001"),
    ],
    ground: ["Plant_Grass_Rocky", "Plant_Grass_Lush", "Plant_Fern_Forest", "Plant_Flower_Common_Pink"],
    props: [
      P("Rock_Formations/Rocks/Quartzite/Small/Rocks_Quartzite_Small_001"),
      P("Rock_Formations/Rocks/Stone/Large/Rocks_Stone_Large_001"),
    ],
  },
  {
    // Hytale Boreal1 (Hedera) — tundra NEVADA con coníferas y agua helada.
    id: "boreal",
    name: "Boreal (nieve)",
    tint: "#dbe8f0",
    tints: ["#dbe8f0", "#cdddec"],
    fog: "#2f3a44",
    flora: "pines",
    snowPeaks: true,
    layers: [
      { block: "Soil_Snow", depth: 1 },
      { block: "Soil_Dirt_Cold", depth: 2 },
      { block: "Soil_Pebbles_Frozen", depth: 2 },
    ],
    stone: "Rock_Slate",
    water: { sea: -3 },
    trees: [
      P("Trees/Fir_Snow/Stage_3/Trees_Fir_Stage_3_New_001"),
      P("Trees/Fir_Snow/Stage_3/Trees_Fir_Stage_3_New_002"),
      P("Trees/Fir_Snow/Stage_2/Trees_Fir_Stage_2_New_001"),
    ],
    plants: [
      P("Plants/Bush/Winter/Bush_Winter_001"),
      P("Plants/Mushroom_Large/Green/Stage_1/Mushroom_Large_Green_Stage_1_001"),
    ],
    ground: ["Plant_Fern_Winter", "Plant_Reeds_Winter", "Plant_Grass_Rocky_Short"],
    props: [P("Rock_Formations/Rocks/Slate/Small/Rocks_Slate_Small_001")],
  },
  {
    // Hytale Ocean1 — el prefab en una isla rodeada de mar.
    id: "ocean",
    name: "Océano (Ocean)",
    tint: "#6ca229",
    tints: ["#5b9e28", "#6ca229"],
    fog: "#1f3346",
    flora: "trees",
    layers: [
      { block: "Soil_Grass", depth: 1, tint: true },
      { block: "Soil_Sand_White", depth: 3 },
    ],
    stone: "Rock_Stone",
    water: { sea: -1, ocean: true },
    trees: [P("Trees/Palm/Stage_3/Palm_Stage3_001"), P("Trees/Palm/Stage_3/Palm_Stage3_002")],
    plants: [P("Plants/Bush/Green/Bush_Green_001")],
    ground: ["Plant_Grass_Lush", "Plant_Flower_Common_Red"],
    props: [P("Rock_Formations/Rocks/Stone/Small/Rocks_Stone_Small_001")],
  },
  {
    // Terreno plano de pruebas (Hytale Default_Flat): hierba sobre tierra, sin relieve.
    id: "flat",
    name: "Plano (Flat)",
    tint: "#7cb342",
    tints: ["#6ca229", "#7cb342"],
    fog: "#243a2a",
    flora: "trees",
    layers: [
      { block: "Soil_Grass", depth: 1, tint: true },
      { block: "Soil_Dirt", depth: 3 },
    ],
    stone: "Rock_Stone",
    trees: [P("Trees/Oak/Stage_2/Oak_Stage2_001")],
    plants: [P("Plants/Bush/Green/Bush_Green_001")],
    ground: ["Plant_Grass_Lush", "Plant_Flower_Common_Red", "Plant_Flower_Common_Blue"],
  },
  {
    id: "none",
    name: "Sin entorno",
    tint: "#9fb1c4",
    tints: ["#9fb1c4"],
    fog: "#0f1822",
    flora: "none",
    layers: [{ block: "Soil_Grass", depth: 1, tint: true }],
    stone: "Rock_Stone",
    trees: [],
    plants: [],
    ground: [],
  },
];

export const DEFAULT_BIOME = BIOMES[0];

export function biomeById(id: string): Biome {
  return BIOMES.find((b) => b.id === id) ?? DEFAULT_BIOME;
}

/** Tipo de relieve del entorno circundante (el claro central donde se asienta el prefab es plano). */
export type Relief = "flat" | "hills" | "mountains";

export const RELIEFS: { id: Relief; name: string }[] = [
  { id: "flat", name: "Plano" },
  { id: "hills", name: "Colinas" },
  { id: "mountains", name: "Montañoso" },
];
