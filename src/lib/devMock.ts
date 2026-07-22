/**
 * MOCK DE BACKEND — SOLO DESARROLLO. Permite ver y verificar TODAS las vistas en el navegador
 * (Playwright/dev) sin el backend Tauri. Se activa únicamente cuando `import.meta.env.DEV` y NO
 * estamos dentro de Tauri (ver `api.ts`), por lo que el build de producción lo elimina por
 * tree-shaking (dynamic import bajo un `if (DEV)` muerto en prod) → no afecta a la app real ni
 * al EULA (solo hace `fetch` a `/realbuild/*`, que no existe en producción).
 *
 * Datos: catálogo y modelo de voxels REALES extraídos a `public/realbuild/` (dev), más builds
 * sintéticos variados para poblar la biblioteca, la ficha y la guía.
 */
import type {
  BlockInfo,
  Build,
  BuildDetail,
  BuildSummary,
  ChecklistItem,
  MaterialRow,
  PhaseWithSteps,
  Progress,
  StoredModel,
} from "@/lib/api";

let catalogP: Promise<BlockInfo[]> | null = null;
const catalog = (): Promise<BlockInfo[]> =>
  (catalogP ??= fetch("/realbuild/catalog.json")
    .then((r) => r.json() as Promise<BlockInfo[]>)
    .catch(() => [] as BlockInfo[]));

let modelP: Promise<StoredModel> | null = null;
const model = (): Promise<StoredModel> =>
  (modelP ??= fetch("/realbuild/model.json")
    .then((r) => r.json() as Promise<StoredModel>)
    .catch(() => ({ size: [1, 1, 1], origin: [0, 0, 0], phases: 1, blocks: [] }) as StoredModel));

/** Nombres de bloques con icono del catálogo real (para miniaturas y materiales realistas). */
async function topBlocks(n: number, skip = 0): Promise<string[]> {
  const c = await catalog();
  return c
    .filter((b) => b.is_block && b.icon)
    .slice(skip, skip + n)
    .map((b) => b.name);
}

const T = "2026-06-10T12:00:00Z";
function makeBuild(id: number, o: Partial<Build> & Pick<Build, "name" | "category" | "difficulty">): Build {
  return {
    id,
    slug: o.name!.toLowerCase().replace(/\s+/g, "-"),
    description: "Construcción de ejemplo para previsualizar la interfaz de Voxelfold.",
    style: "Medieval",
    estimated_time_min: 45,
    block_count: 320,
    mode: "Creativo",
    thumbnail_ref: null,
    author_name: null,
    author_url: null,
    source_url: null,
    license_note: null,
    voxel_model_ref: "mock",
    created_at: T,
    updated_at: T,
    ...o,
  } as Build;
}

const BUILD_DEFS: Array<Partial<Build> & Pick<Build, "name" | "category" | "difficulty"> & { status: BuildSummary["status"]; fav: boolean }> = [
  { name: "Casa de aldeano", category: "Casas", difficulty: "Fácil", estimated_time_min: 30, block_count: 240, status: "in_progress", fav: true },
  { name: "Torre de vigía", category: "Defensas", difficulty: "Media", estimated_time_min: 55, block_count: 410, status: "in_progress", fav: false },
  { name: "Granja de cultivos", category: "Granjas", difficulty: "Fácil", estimated_time_min: 25, block_count: 180, status: "completed", fav: true },
  { name: "Posada del cruce", category: "Casas", difficulty: "Media", estimated_time_min: 70, block_count: 520, status: "not_started", fav: false },
  { name: "Muralla de piedra", category: "Defensas", difficulty: "Difícil", estimated_time_min: 90, block_count: 880, status: "not_started", fav: false },
  { name: "Puente del río", category: "Infraestructura", difficulty: "Media", estimated_time_min: 40, block_count: 300, status: "completed", fav: false },
  { name: "Taller del herrero", category: "Talleres", difficulty: "Media", estimated_time_min: 50, block_count: 360, status: "not_started", fav: true },
  { name: "Mirador del acantilado", category: "Decorativo", difficulty: "Difícil", estimated_time_min: 120, block_count: 1040, status: "not_started", fav: false },
];

// Estado mutable en memoria (para que toggles/progreso se reflejen al re-consultar).
const favorites = new Set<number>();
const progress = new Map<number, Progress>();
const completed = new Map<number, Set<number>>();
const checklist = new Map<string, Map<string, number>>();
let seeded = false;

async function buildSummaries(): Promise<BuildSummary[]> {
  if (!seeded) {
    BUILD_DEFS.forEach((d, i) => {
      if (d.fav) favorites.add(i + 1);
      if (d.status !== "not_started")
        progress.set(i + 1, { build_id: i + 1, status: d.status, current_phase_id: 1 });
    });
    seeded = true;
  }
  const out: BuildSummary[] = [];
  for (let i = 0; i < BUILD_DEFS.length; i++) {
    const d = BUILD_DEFS[i];
    const id = i + 1;
    out.push({
      ...makeBuild(id, d),
      top_blocks: await topBlocks(4, i * 2),
      status: (progress.get(id)?.status ?? "not_started") as BuildSummary["status"],
      is_favorite: favorites.has(id),
    });
  }
  return out;
}

async function phasesFor(id: number): Promise<PhaseWithSteps[]> {
  const mats = await topBlocks(6, id);
  const mat = (names: string[], q: number): MaterialRow[] => names.map((n) => ({ block_name: n, qty: q }));
  return [
    {
      id: 1, build_id: id, order_index: 0, name: "Cimientos y suelo",
      description: "Marca la planta y coloca la base de piedra.",
      steps: [
        { id: 1, phase_id: 1, order_index: 0, title: "Marca el perímetro", instruction: "Coloca la primera hilada siguiendo el plano.", preview_ref: null },
        { id: 2, phase_id: 1, order_index: 1, title: "Rellena el suelo", instruction: "Completa el suelo interior.", preview_ref: null },
      ],
      materials: mat(mats.slice(0, 3), 24),
    },
    {
      id: 2, build_id: id, order_index: 1, name: "Muros",
      description: "Levanta las paredes y deja los huecos de puertas y ventanas.",
      steps: [
        { id: 3, phase_id: 2, order_index: 0, title: "Sube las esquinas", instruction: "Levanta los pilares de las cuatro esquinas.", preview_ref: null },
        { id: 4, phase_id: 2, order_index: 1, title: "Cierra los muros", instruction: "Rellena entre los pilares.", preview_ref: null },
      ],
      materials: mat(mats.slice(2, 5), 48),
    },
    {
      id: 3, build_id: id, order_index: 2, name: "Tejado",
      description: "Remata con el tejado a dos aguas.",
      steps: [
        { id: 5, phase_id: 3, order_index: 0, title: "Vigas", instruction: "Coloca las vigas maestras.", preview_ref: null },
        { id: 6, phase_id: 3, order_index: 1, title: "Cubierta", instruction: "Coloca las pendientes del tejado.", preview_ref: null },
      ],
      materials: mat(mats.slice(3, 6), 36),
    },
  ];
}

async function detailFor(id: number): Promise<BuildDetail> {
  const summaries = await buildSummaries();
  const build = summaries.find((b) => b.id === id) ?? summaries[0];
  const phases = await phasesFor(id);
  const allMats = new Map<string, number>();
  for (const p of phases) for (const m of p.materials) allMats.set(m.block_name, (allMats.get(m.block_name) ?? 0) + m.qty);
  return {
    build,
    phases,
    materials: [...allMats].map(([block_name, qty]) => ({ block_name, qty })),
    is_favorite: favorites.has(id),
  };
}

/** Despacha un comando mock. Devuelve datos representativos o `undefined` para mutaciones. */
export async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const a = args ?? {};
  const r = (v: unknown) => v as T;
  switch (cmd) {
    case "get_install_status":
      return r({ root: "/Applications/Hytale (mock dev)" });
    case "set_install_path":
      return r({ root: String(a.path ?? "/mock") });
    case "hytale_ready":
    case "retry_locate":
      return r(true);
    case "refresh_hytale":
      return r({
        changed: false,
        generation: 1,
        reason: "unchanged",
        path: "/Applications/Hytale/game/latest/Assets.zip",
        catalog: null,
      });
    case "get_asset_compatibility":
      return r({
        path: "/Applications/Hytale/game/latest/Assets.zip",
        generation: 1,
        auto_detected: true,
        size_bytes: 3_428_464_699,
        modified_unix_seconds: 1_784_289_600,
        modified_subsec_nanos: 0,
        created_unix_seconds: 1_784_289_600,
        created_subsec_nanos: 0,
        device_id: null,
        file_id: null,
        asset_entries: 78_412,
        item_definitions: 3_667,
        parsed_items: 3_667,
        parse_failures: 0,
        read_failures: 0,
        duplicate_names: 0,
        block_definitions: 2_949,
        model_definitions: 1_782,
        hitbox_definitions: 238,
        multi_cell_block_definitions: 146,
        prefab_definitions: 7_825,
        issues: [],
      });
    case "get_block_catalog":
      return r(await catalog());
    case "get_catalog_locale_info":
      return r({ current: "es-ES", available: ["es-ES", "en-US"] });
    case "block_wiki":
      return r({ description: "Bloque de construcción de Hytale. Ficha de ejemplo (dev).", source_url: "https://hytale.com", source: "wiki" });
    case "list_builds":
    case "list_build_summaries":
      return r(await buildSummaries());
    case "get_build_detail":
      return r(await detailFor(Number(a.id)));
    case "get_build_voxels":
      return r(await model());
    case "toggle_favorite": {
      const id = Number(a.buildId);
      if (favorites.has(id)) favorites.delete(id);
      else favorites.add(id);
      return r(favorites.has(id));
    }
    case "list_favorites":
      return r([...favorites]);
    case "get_progress":
      return r(progress.get(Number(a.buildId)) ?? null);
    case "set_progress":
      progress.set(Number(a.buildId), {
        build_id: Number(a.buildId),
        status: a.status as Progress["status"],
        current_phase_id: (a.currentPhaseId as number | null) ?? null,
      });
      return r(undefined);
    case "get_completed_steps":
      return r([...(completed.get(Number(a.buildId)) ?? new Set())]);
    case "set_step_completed": {
      const id = Number(a.buildId);
      const set = completed.get(id) ?? new Set<number>();
      if (a.completed) set.add(Number(a.stepId));
      else set.delete(Number(a.stepId));
      completed.set(id, set);
      return r(undefined);
    }
    case "reset_progress":
      completed.delete(Number(a.buildId));
      progress.delete(Number(a.buildId));
      return r(undefined);
    case "get_checklist": {
      const key = `${a.buildId}:${a.scope}`;
      const m = checklist.get(key) ?? new Map();
      return r([...m].map(([block_name, gathered_qty]) => ({ block_name, gathered_qty })) as ChecklistItem[]);
    }
    case "set_material_gathered": {
      const key = `${a.buildId}:${a.scope}`;
      const m = checklist.get(key) ?? new Map<string, number>();
      m.set(String(a.blockName), Number(a.gatheredQty));
      checklist.set(key, m);
      return r(undefined);
    }
    case "create_build":
    case "create_demo_build":
    case "seed_curated_library":
    case "reset_library_to_starters":
    case "add_phase":
    case "add_step":
    case "import_build":
    case "import_prefab_file":
    case "import_prefab_folder":
    case "import_hytale_prefab":
    case "import_community_prefab":
      return r(1);
    case "import_prefab_archive":
    case "curseforge_import":
    case "curseforge_import_url":
      return r([1]);
    case "list_hytale_prefabs": {
      const c = await catalog();
      return r(
        c.slice(0, 12).map((b) => ({ entry: `Server/Prefabs/${b.name}.json`, name: b.display_name ?? b.name })),
      );
    }
    case "curseforge_key_status":
      return r(false);
    case "search_community_prefabs":
    case "curseforge_search":
      return r([]);
    case "set_build_voxels":
      mutVoxels = a.model as StoredModel;
      return r(undefined);
    default:
      // Mutaciones y comandos sin datos: devolver vacío.
      return r(undefined);
  }
}

let mutVoxels: StoredModel | null = null;
void mutVoxels;
