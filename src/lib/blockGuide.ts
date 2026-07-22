import type { BlockInfo } from "@/lib/api";

/**
 * Guía "companion" de un bloque, en español. Hytale NO trae descripciones ni recetas en
 * sus datos (solo nombres en inglés), así que esto se DERIVA del material/forma/categoría
 * del propio bloque — honesto, sin inventar recetas concretas.
 */

// Material / familia → español (tokens del nombre técnico).
const MATERIAL: Record<string, string> = {
  rock: "piedra", stone: "piedra", basalt: "basalto", granite: "granito", marble: "mármol",
  sandstone: "arenisca", obsidian: "obsidiana", slate: "pizarra",
  wood: "madera", deadwood: "madera muerta", softwood: "madera blanda", lightwood: "madera clara",
  darkwood: "madera oscura", hardwood: "madera dura", goldenwood: "madera dorada", bamboo: "bambú",
  soil: "tierra", dirt: "tierra", grass: "hierba", gravel: "grava", sand: "arena", clay: "arcilla",
  mud: "barro", moss: "musgo", snow: "nieve", ice: "hielo", peat: "turba",
  plant: "planta", crop: "cultivo", flower: "flor", leaves: "hojas", foliage: "follaje",
  mushroom: "seta", vine: "enredadera", cactus: "cactus",
  metal: "metal", iron: "hierro", copper: "cobre", gold: "oro", steel: "acero", bronze: "bronce",
  fluid: "fluido", water: "agua", lava: "lava",
  cloth: "tela", glass: "cristal", crystal: "cristal", bone: "hueso", ore: "mineral",
  coal: "carbón", brick: "ladrillo",
  furniture: "mobiliario", light: "iluminación", lamp: "lámpara", torch: "antorcha",
};

// Forma → español.
const SHAPE: Record<string, string> = {
  brick: "ladrillo", cobble: "adoquín", smooth: "bloque pulido", polished: "bloque pulido",
  tile: "baldosa", tiles: "baldosa", planks: "tablones", plank: "tablones", log: "tronco",
  beam: "viga", pillar: "pilar", column: "columna", stairs: "escalera", stair: "escalera",
  half: "losa", slab: "losa", quarter: "cuarto de bloque", roof: "tejado", fence: "valla",
  wall: "muro", door: "puerta", window: "ventana", gate: "portón", fountain: "fuente",
  lantern: "farolillo", bench: "banco", chair: "silla", table: "mesa", shelf: "estantería",
  barrel: "barril", chest: "cofre", bed: "cama", bedroll: "petate", carpet: "alfombra",
};

// Formas/materiales que indican un bloque PROCESADO (se fabrica), no natural.
const CRAFTED =
  /brick|planks?|plank|smooth|polished|tile|beam|pillar|column|stairs?|slab|_half|quarter|roof|fence|wall|door|window|gate|glass|metal|iron|steel|bronze|cloth|furniture|lamp|lantern|bench|chair|table|shelf|barrel|chest|bed|carpet|sign/i;
// Materiales naturales (se obtienen del mundo).
const NATURAL =
  /soil|dirt|grass|gravel|sand|clay|mud|moss|snow|\bice\b|peat|plant|crop|flower|leaf|leaves|foliage|mushroom|vine|cactus|ore|coal|crystal|rock_[a-z]+$|stone$|basalt$|wood_[a-z]+$|log|water|lava|bone/i;

function tokens(name: string): string[] {
  return name.replace(/^\*/, "").split("_State_Definitions_")[0].split("_").filter(Boolean);
}

/** Descripción + cómo se consigue, en español, derivadas del bloque. */
export function blockGuide(b: BlockInfo): { description: string; obtain: string } {
  const name = b.name;
  const toks = tokens(name);
  const lower = toks.map((t) => t.toLowerCase());

  // Forma (último token reconocido como forma) y material (primer token de material).
  let shape = "";
  for (let i = lower.length - 1; i >= 0; i--) {
    if (SHAPE[lower[i]]) { shape = SHAPE[lower[i]]; break; }
  }
  const mats: string[] = [];
  for (const t of lower) if (MATERIAL[t] && !mats.includes(MATERIAL[t])) mats.push(MATERIAL[t]);
  const material = mats.slice(0, 2).join(" ");

  // Frase base.
  let desc: string;
  if (shape && material) desc = `${cap(shape)} de ${material}.`;
  else if (material) desc = `Bloque de ${material}.`;
  else if (shape) desc = `${cap(shape)}.`;
  else desc = `Bloque de Hytale (${b.display_name ?? name}).`;

  // Matices por propiedades reales del catálogo.
  const extra: string[] = [];
  if (b.light) extra.push("emite luz");
  if (b.opacity === "Semitransparent") extra.push("translúcido");
  if (b.opacity === "Cutout") extra.push("con recortes (hojas/rejilla)");
  if (b.tint) extra.push("teñido");
  if (b.model && !shape) extra.push("con modelo 3D propio");
  if (!b.is_block) extra.push("objeto, no colocable como bloque");
  if (extra.length) desc += ` ${cap(extra.join(", "))}.`;
  desc += " Ideal para tus construcciones nativas de Hytale.";

  // Cómo se consigue (heurística honesta: procesado = fabricar; natural = mundo).
  let obtain: string;
  if (!b.is_block) {
    obtain = "Objeto del juego (no es un bloque colocable).";
  } else if (CRAFTED.test(name)) {
    obtain = "Suele fabricarse a partir de materiales base en la mesa de trabajo / banco de constructor del juego.";
  } else if (NATURAL.test(name)) {
    obtain = "Se obtiene en el mundo: minando, talando o recolectando en su bioma de origen.";
  } else {
    obtain = "Disponible en el modo creativo de Hytale; en supervivencia, recolectándolo o fabricándolo según el material.";
  }
  return { description: desc, obtain };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
