import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HelpCircle, FlipVertical2 } from "lucide-react";
import {
  Link,
  useBeforeUnload,
  useBlocker,
  useParams,
  type BlockerFunction,
} from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isPlaceableBlock, type BlockInfo, type StoredModel } from "@/lib/api";
import type { EditorVoxel, EditorTool } from "@/components/VoxelEditor";
import type { Cell } from "@/lib/editorOps";
import {
  toClipboard,
  voxelsInBox,
  rotateClipboard,
  mirrorClipboardX,
  mirrorClipboardZ,
  revolveCells,
  stackCells,
  mirrorRotationX,
  mirrorRotationZ,
  type Clipboard,
  type SelBox,
} from "@/lib/selectionOps";
import { SlotIcon } from "@/components/BlockIcon";
import { BlockBrowser } from "@/components/BlockBrowser";
import { LayerBlueprint } from "@/components/LayerBlueprint";
import { EditorToolPalette, TOOL_LABELS } from "@/components/EditorToolPalette";
import { HyIcon } from "@/components/HyIcon";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { ResizableSidebar } from "@/components/ui/ResizableSidebar";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useCatalogMap } from "@/lib/useCatalog";
import { isMarkerName, parseBlockName } from "@/lib/resolveBlock";
import { phaseColor } from "@/lib/phaseColors";
import { playSound, setSoundEnabled } from "@/lib/sounds";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";
import {
  decodeRotation,
  encodeRotation,
  rotateRotationY,
  rotationLabel,
} from "@/lib/hytaleRotation";
import { footprintCellsForName } from "@/lib/blockFootprint";
import {
  editorModelsEqual,
  setEditorSessionActive,
  setEditorSessionDirty,
} from "@/lib/editorSession";

const VoxelEditorLazy = lazy(() =>
  import("@/components/VoxelEditor").then((m) => ({ default: m.VoxelEditor })),
);

const keyOf = (x: number, y: number, z: number) => `${x},${y},${z}`;
const humanizeTechnicalName = (value: string) => value.replace(/_/g, " ");

function physicalOccupancy(
  voxels: Map<string, EditorVoxel>,
  catalog: Map<string, BlockInfo>,
): Map<string, string> {
  const occupied = new Map<string, string>();
  for (const [anchor, voxel] of voxels) {
    for (const offset of footprintCellsForName(voxel.name, catalog, voxel.rotation)) {
      occupied.set(keyOf(voxel.x + offset.x, voxel.y + offset.y, voxel.z + offset.z), anchor);
    }
  }
  return occupied;
}

/** Coloca un ancla solo si su hitbox oficial completo cabe sin invadir otra pieza. */
function placeWithFootprint(
  voxels: Map<string, EditorVoxel>,
  occupied: Map<string, string>,
  voxel: EditorVoxel,
  catalog: Map<string, BlockInfo>,
): boolean {
  const anchor = keyOf(voxel.x, voxel.y, voxel.z);
  const previous = voxels.get(anchor);
  const previousCells = previous
    ? footprintCellsForName(previous.name, catalog, previous.rotation).map((offset) =>
        keyOf(previous.x + offset.x, previous.y + offset.y, previous.z + offset.z),
      )
    : [];
  for (const cell of previousCells) {
    if (occupied.get(cell) === anchor) occupied.delete(cell);
  }

  const nextCells = footprintCellsForName(voxel.name, catalog, voxel.rotation).map((offset) =>
    keyOf(voxel.x + offset.x, voxel.y + offset.y, voxel.z + offset.z),
  );
  if (nextCells.some((cell) => occupied.has(cell))) {
    for (const cell of previousCells) occupied.set(cell, anchor);
    return false;
  }
  voxels.set(anchor, voxel);
  for (const cell of nextCells) occupied.set(cell, anchor);
  return true;
}

interface EditorSaveSnapshot {
  model: StoredModel;
  voxels: Map<string, EditorVoxel>;
  phaseCount: number;
}

export function Editor() {
  const { id } = useParams();
  const buildId = Number(id);
  const qc = useQueryClient();
  const catalog = useCatalogMap();

  const detail = useQuery({
    queryKey: ["build", buildId],
    queryFn: () => api.getBuildDetail(buildId),
    enabled: Number.isFinite(buildId),
  });
  const existing = useQuery({
    queryKey: ["voxels", buildId],
    queryFn: () => api.getBuildVoxels(buildId),
    enabled: Number.isFinite(buildId),
    retry: false,
  });

  // Estado editable: mapa "x,y,z" → voxel.
  const [voxels, setVoxels] = useState<Map<string, EditorVoxel>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [phaseCount, setPhaseCount] = useState(1);
  const savedSnapshot = useRef<{ voxels: Map<string, EditorVoxel>; phaseCount: number } | null>(null);
  const [savedRevision, setSavedRevision] = useState(0);
  const [currentPhase, setCurrentPhase] = useState(0);
  const [currentBlock, setCurrentBlock] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]); // bloques recientes (hotbar)
  // Selecciona un bloque y lo lleva al frente del hotbar de recientes (máx. 8).
  const pickBlock = useCallback((nm: string) => {
    setCurrentBlock(nm);
    setRecent((r) => [nm, ...r.filter((x) => x !== nm)].slice(0, 8));
  }, []);
  const [currentRotation, setCurrentRotation] = useState(0); // RotationTuple oficial 0..63
  const [focusPhase, setFocusPhase] = useState(false);
  const [sound, setSound] = useState(true);
  const [models, setModels] = useState(true);
  const [tool, setTool] = useState<EditorTool>("place");
  const [freePlace, setFreePlace] = useState(false);
  const [freeHeight, setFreeHeight] = useState(0);
  const [autoOrient, setAutoOrient] = useState(true); // colocación inteligente (orienta hacia la cámara)
  const [planOpen, setPlanOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [sidePanel, setSidePanel] = useState<"blocks" | "scene">("blocks");
  // Opciones de las herramientas de forma (Fase 2).
  const [rectFilled, setRectFilled] = useState(false);
  const [rectHollow, setRectHollow] = useState(false);
  const [opHeight, setOpHeight] = useState(1);
  const [brushShape, setBrushShape] = useState<"cube" | "sphere" | "cylinder">("cube");
  const [brushSize, setBrushSize] = useState(3);
  const [brushHollow, setBrushHollow] = useState(false);
  // Selección / portapapeles (Fase 3).
  const [selBox, setSelBox] = useState<SelBox | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [revolve, setRevolve] = useState(1); // copias radiales al pegar (1/2/4)
  const [stack, setStack] = useState(1); // copias LINEALES contiguas al pegar (apilar/array)
  const [stackDir, setStackDir] = useState<"x+" | "x-" | "y+" | "y-" | "z+" | "z-">("x+");
  // Simetría en vivo: espeja cada acción a través de planos X/Z (centro ajustable).
  const [symX, setSymX] = useState(false);
  const [symZ, setSymZ] = useState(false);
  const [symCx, setSymCx] = useState(0);
  const [symCz, setSymCz] = useState(0);
  // Expande cada celda a sus reflejos, anotando en qué ejes se reflejó (mx/mz) para
  // poder reflejar también la orientación del bloque.
  const mirrorCells = useCallback(
    <T extends { x: number; y: number; z: number }>(cells: T[]): (T & { mx: boolean; mz: boolean })[] => {
      const seen = new Set<string>();
      const out: (T & { mx: boolean; mz: boolean })[] = [];
      const add = (c: T & { mx: boolean; mz: boolean }) => {
        const k = keyOf(c.x, c.y, c.z);
        if (!seen.has(k)) { seen.add(k); out.push(c); }
      };
      for (const c of cells) {
        let set = [{ ...c, mx: false, mz: false }];
        if (symX) set = [...set, ...set.map((o) => ({ ...o, x: 2 * symCx - o.x, mx: !o.mx }))];
        if (symZ) set = [...set, ...set.map((o) => ({ ...o, z: 2 * symCz - o.z, mz: !o.mz }))];
        set.forEach(add);
      }
      return out;
    },
    [symX, symZ, symCx, symCz],
  );
  // Refleja la orientación RotationTuple completa (0..63) según los ejes espejados.
  const rotMirror = useCallback((rot: number, mx: boolean, mz: boolean) => {
    let r = rot;
    if (mx) r = mirrorRotationX(r);
    if (mz) r = mirrorRotationZ(r);
    return r;
  }, []);
  const [savedPrefab, setSavedPrefab] = useState<{ id: number; name: string } | null>(null);
  const ops = useMemo(
    () => ({ rectFilled, rectHollow, height: opHeight, brushShape, brushSize, brushHollow }),
    [rectFilled, rectHollow, opHeight, brushShape, brushSize, brushHollow],
  );
  useEffect(() => setSoundEnabled(sound), [sound]);

  // Historial para deshacer/rehacer.
  const past = useRef<Map<string, EditorVoxel>[]>([]);
  const future = useRef<Map<string, EditorVoxel>[]>([]);
  const [histVer, setHistVer] = useState(0); // fuerza re-render al cambiar el historial

  // React Router puede reutilizar esta ruta al cambiar de build: reinicia todo el documento.
  useEffect(() => {
    setLoaded(false);
    setVoxels(new Map());
    setPhaseCount(1);
    setCurrentPhase(0);
    savedSnapshot.current = null;
    past.current = [];
    future.current = [];
    setHistVer((value) => value + 1);
    setSavedRevision((value) => value + 1);
  }, [buildId]);

  // Carga inicial del modelo existente (una sola vez).
  useEffect(() => {
    if (loaded) return;
    if (existing.isLoading || detail.isLoading) return;
    const m = new Map<string, EditorVoxel>();
    let maxPhase = 0;
    if (existing.data) {
      for (const b of existing.data.blocks) {
        // Salta vacíos y marcadores de generación (spawners, géiseres, objetivos…):
        // no son bloques de construcción y se veían como "jaulas" erróneas.
        if (b.name === "Empty" || isMarkerName(b.name)) continue;
        m.set(keyOf(b.x, b.y, b.z), {
          x: b.x, y: b.y, z: b.z, name: b.name, phase: b.phase, rotation: b.rotation ?? 0,
        });
        maxPhase = Math.max(maxPhase, b.phase);
      }
    }
    const fromDetail = detail.data?.phases.length ?? 0;
    const nextPhaseCount = Math.max(1, fromDetail, maxPhase + 1);
    savedSnapshot.current = { voxels: new Map(m), phaseCount: nextPhaseCount };
    setVoxels(m);
    setPhaseCount(nextPhaseCount);
    setLoaded(true);
    setSavedRevision((value) => value + 1);
  }, [existing.isLoading, existing.data, detail.isLoading, detail.data, loaded]);

  // Bloque por defecto: el más usado de la build, o un bloque REAL común (nunca una
  // herramienta dev como "[TMP] Extrude Tool").
  useEffect(() => {
    if (currentBlock || catalog.size === 0) return;
    const used = [...voxels.values()][0]?.name;
    const preferred = catalog.has("Rock_Stone") ? "Rock_Stone" : undefined;
    const firstReal = [...catalog.values()].find(isPlaceableBlock)?.name;
    const chosen = used ?? preferred ?? firstReal ?? null;
    setCurrentBlock(chosen);
    if (chosen) setRecent((r) => (r.length ? r : [chosen]));
  }, [catalog, voxels, currentBlock]);

  const list = useMemo(() => [...voxels.values()], [voxels]);
  const dirty = useMemo(() => {
    const saved = savedSnapshot.current;
    return loaded && (!saved || !editorModelsEqual(voxels, saved.voxels, phaseCount, saved.phaseCount));
  }, [loaded, phaseCount, savedRevision, voxels]);

  useEffect(() => {
    setEditorSessionActive(true);
    return () => setEditorSessionActive(false);
  }, []);
  useEffect(() => setEditorSessionDirty(dirty), [dirty]);

  const blocker = useBlocker(
    useCallback<BlockerFunction>(
      ({ currentLocation, nextLocation }) =>
        dirty
        && `${currentLocation.pathname}${currentLocation.search}`
          !== `${nextLocation.pathname}${nextLocation.search}`,
      [dirty],
    ),
  );
  useBeforeUnload(
    useCallback((event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    }, [dirty]),
    { capture: true },
  );

  // Aplica un cambio guardando el estado anterior en el historial (deshacer).
  const apply = useCallback(
    (mutate: (m: Map<string, EditorVoxel>) => void) => {
      setVoxels((prev) => {
        const next = new Map(prev);
        mutate(next);
        if (editorModelsEqual(next, prev, 1, 1)) return prev;
        past.current.push(prev);
        if (past.current.length > 100) past.current.shift();
        future.current = [];
        return next;
      });
      setHistVer((v) => v + 1);
    },
    [],
  );

  const place = useCallback(
    (x: number, y: number, z: number, rot?: number) => {
      if (!currentBlock) return;
      // `rot` viene de la colocación inteligente (auto-orientación hacia la cámara); si no, la
      // rotación manual. El espejo de simetría se aplica encima en cada celda reflejada.
      const baseRot = rot ?? currentRotation;
      const cells = mirrorCells([{ x, y, z }]);
      apply((m) => {
        const occupied = physicalOccupancy(m, catalog);
        for (const c of cells) {
          placeWithFootprint(m, occupied, {
            x: c.x, y: c.y, z: c.z, name: currentBlock, phase: currentPhase,
            rotation: rotMirror(baseRot, c.mx, c.mz),
          }, catalog);
        }
      });
      playSound("place");
    },
    [currentBlock, currentPhase, currentRotation, mirrorCells, apply, rotMirror, catalog],
  );
  const remove = useCallback(
    (x: number, y: number, z: number) => {
      const cells = mirrorCells([{ x, y, z }]);
      apply((m) => {
        for (const c of cells) m.delete(keyOf(c.x, c.y, c.z));
      });
      playSound("remove");
    },
    [mirrorCells, apply],
  );
  // Reemplazar: cambia el bloque de una celda existente por el bloque/rotación actuales.
  const replaceAt = useCallback(
    (x: number, y: number, z: number) => {
      if (!currentBlock) return;
      apply((m) => {
        const k = keyOf(x, y, z);
        if (m.has(k)) {
          const occupied = physicalOccupancy(m, catalog);
          placeWithFootprint(
            m,
            occupied,
            { x, y, z, name: currentBlock, phase: currentPhase, rotation: currentRotation },
            catalog,
          );
        }
      });
      playSound("place");
    },
    [currentBlock, currentPhase, currentRotation, apply, catalog],
  );
  // Cuentagotas: toma el bloque apuntado (nombre+rotación) y vuelve a "colocar".
  const eyedropAt = useCallback(
    (v: EditorVoxel) => {
      pickBlock(v.name);
      setCurrentRotation(v.rotation ?? 0);
      setTool("place");
    },
    [pickBlock],
  );
  // Colocación/borrado en lote (línea, caja, relleno, brocha) — un solo paso de historial.
  const paintCells = useCallback(
    (cells: { x: number; y: number; z: number }[], erase: boolean) => {
      if (!cells.length || (!erase && !currentBlock)) return;
      const all = mirrorCells(cells);
      apply((m) => {
        const occupied = erase ? null : physicalOccupancy(m, catalog);
        for (const c of all) {
          const k = keyOf(c.x, c.y, c.z);
          if (erase) m.delete(k);
          else placeWithFootprint(
            m,
            occupied!,
            { x: c.x, y: c.y, z: c.z, name: currentBlock!, phase: currentPhase, rotation: rotMirror(currentRotation, c.mx, c.mz) },
            catalog,
          );
        }
      });
      playSound(erase ? "remove" : "place");
    },
    [apply, currentBlock, currentPhase, currentRotation, mirrorCells, catalog, rotMirror],
  );

  // --- Selección / portapapeles (Fase 3) ---
  const onSelectBox = useCallback(
    (a: Cell, b: Cell) => {
      const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
      const minZ = Math.min(a.z, b.z), maxZ = Math.max(a.z, b.z);
      // El alto abarca los voxeles dentro de esa huella (toda la columna).
      let minY = Infinity, maxY = -Infinity;
      for (const v of voxels.values()) {
        if (v.x >= minX && v.x <= maxX && v.z >= minZ && v.z <= maxZ) {
          minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        }
      }
      if (minY === Infinity) { minY = 0; maxY = 0; }
      setSelBox({ minX, maxX, minY, maxY, minZ, maxZ });
    },
    [voxels],
  );
  const copySel = () => {
    if (!selBox) return;
    const inBox = voxelsInBox(list, selBox);
    if (!inBox.length) {
      toast("La selección no contiene bloques", "info");
      return;
    }
    setClipboard(toClipboard(inBox));
    toast(`${inBox.length} ${inBox.length === 1 ? "bloque copiado" : "bloques copiados"}`, "success");
  };
  const cutSel = () => {
    if (!selBox) return;
    const inBox = voxelsInBox(list, selBox);
    if (!inBox.length) {
      toast("La selección no contiene bloques", "info");
      return;
    }
    setClipboard(toClipboard(inBox));
    apply((m) => { for (const v of inBox) m.delete(keyOf(v.x, v.y, v.z)); });
    setSelBox(null);
    toast(`${inBox.length} ${inBox.length === 1 ? "bloque cortado" : "bloques cortados"}`, "success");
  };
  const pasteAt = useCallback(
    (at: Cell) => {
      if (!clipboard) return;
      // Apilar (lineal) tiene prioridad si está activo; si no, Revolve (radial).
      const base = stack > 1 ? stackCells(clipboard, at, stackDir, stack) : revolveCells(clipboard, at, revolve);
      const cells = mirrorCells(base);
      apply((m) => {
        const occupied = physicalOccupancy(m, catalog);
        for (const c of cells) {
          placeWithFootprint(m, occupied, {
            x: c.x, y: c.y, z: c.z, name: c.name, rotation: rotMirror(c.rotation, c.mx, c.mz), phase: currentPhase,
          }, catalog);
        }
      });
      playSound("place");
    },
    [clipboard, apply, currentPhase, revolve, stack, stackDir, mirrorCells, catalog, rotMirror],
  );
  const savePrefab = useMutation({
    mutationFn: async () => {
      if (!selBox) throw new Error("Selecciona una región primero");
      const inBox = voxelsInBox(list, selBox);
      if (!inBox.length) throw new Error("La selección está vacía");
      const clip = toClipboard(inBox);
      const name = `${detail.data?.build.name ?? "Prefab"} (selección)`;
      const newId = await api.createBuild({
        name,
        description: "Fragmento creado en el Editor 3D de Voxelfold.",
        category: "Prefab",
        style: "",
        difficulty: "Fácil",
        mode: "",
        estimated_time_min: 10,
      });
      const model: StoredModel = {
        size: [clip.w, clip.h, clip.d],
        origin: [0, 0, 0],
        phases: 1,
        blocks: clip.cells.map((c) => ({ x: c.x, y: c.y, z: c.z, name: c.name, rotation: c.rotation, phase: 0 })),
      };
      await api.setBuildVoxels(newId, model);
      return { id: newId, name };
    },
    onSuccess: (r) => {
      setSavedPrefab(r);
      qc.invalidateQueries({ queryKey: ["build_summaries"] });
    },
    onError: (e) => toast(errorMessage(e, "No se pudo guardar el prefab"), "error"),
  });

  const undo = useCallback(() => {
    if (past.current.length === 0) return;
    setVoxels((cur) => {
      future.current.push(cur);
      return past.current.pop()!;
    });
    setHistVer((v) => v + 1);
  }, []);
  const redo = useCallback(() => {
    if (future.current.length === 0) return;
    setVoxels((cur) => {
      past.current.push(cur);
      return future.current.pop()!;
    });
    setHistVer((v) => v + 1);
  }, []);
  const doClearAll = () => {
    if (voxels.size === 0) return;
    apply((m) => m.clear());
    setConfirmClear(false);
  };

  // Estado/acciones volátiles para los atajos, vía ref → el listener no se re-suscribe en cada
  // render ni captura valores obsoletos.
  const kbRef = useRef({ tool, clipboard, selBox, copySel, cutSel, setClipboard });
  const saveActionRef = useRef<() => void>(() => undefined);
  kbRef.current = { tool, clipboard, selBox, copySel, cutSel, setClipboard };

  // Atajos de teclado completos (ver el modal de Ayuda). Herramientas 1-9 + V (pegar); portapapeles
  // R/F; copiar/cortar Ctrl+C/X; deshacer/rehacer Ctrl+Z/Y; capa [/]; flotar G.
  // OJO: NO usar W/A/S/D/Q/E como atajo de herramienta → son el control de cámara (WASD + Q/E).
  // "Seleccionar" NO lleva atajo de letra (antes era S y chocaba con "atrás" de la cámara).
  useEffect(() => {
    const TOOL_KEYS: Record<string, EditorTool> = {
      "1": "place", "2": "eraser", "3": "replace", "4": "eyedrop",
      "5": "paint", "6": "line", "7": "rect", "8": "fill", "9": "brush",
      v: "paste",
    };
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") {
        setPlanOpen(false);
        setHelpOpen(false);
        setConfirmClear(false);
        return;
      }
      if (planOpen || helpOpen || confirmClear) return; // con un modal abierto, no disparar atajos
      const k = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;
      const { tool: curTool, clipboard: clip, selBox: sel, copySel: copy, cutSel: cut, setClipboard: setClip } =
        kbRef.current;
      if (mod && k === "s") {
        e.preventDefault();
        saveActionRef.current();
      } else if (mod && k === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        redo();
      } else if (mod && k === "c" && curTool === "select" && sel) {
        e.preventDefault();
        copy();
      } else if (mod && k === "x" && curTool === "select" && sel) {
        e.preventDefault();
        cut();
      } else if (!mod && k === "r") {
        // Pegando con portapapeles → R rota el portapapeles; si no, gira el bloque.
        // Mayús+R inclina (pitch) y Alt+R gira sobre su eje (roll).
        if (curTool === "paste" && clip) setClip(rotateClipboard(clip));
        else
          setCurrentRotation((r) => {
            const tuple = decodeRotation(r);
            if (e.altKey) return encodeRotation({ ...tuple, roll: tuple.roll + 1 });
            if (e.shiftKey) return encodeRotation({ ...tuple, pitch: tuple.pitch + 1 });
            return rotateRotationY(r);
          });
      } else if (!mod && k === "f" && clip && (curTool === "paste" || curTool === "select")) {
        // F = espejo del portapapeles (Shift+F = eje Z).
        setClip(e.shiftKey ? mirrorClipboardZ(clip) : mirrorClipboardX(clip));
      } else if (!mod && !e.shiftKey && TOOL_KEYS[k]) {
        setTool(TOOL_KEYS[k]);
      } else if (!mod && (e.key === "[" || e.key === "]")) {
        e.preventDefault();
        setFreePlace(true);
        setFreeHeight((h) => Math.max(0, Math.min(60, h + (e.key === "]" ? 1 : -1))));
      } else if (!mod && k === "g") {
        setFreePlace((v) => !v); // alternar colocar flotando
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, planOpen, helpOpen, confirmClear]);

  const catalogList = useMemo(() => [...catalog.values()].filter(isPlaceableBlock), [catalog]);

  const createSaveSnapshot = useCallback((): EditorSaveSnapshot => {
    let minX = 0, minY = 0, minZ = 0, maxX = 0, maxY = 0, maxZ = 0, maxPhase = 0;
    let first = true;
    for (const v of list) {
      if (first) {
        minX = maxX = v.x; minY = maxY = v.y; minZ = maxZ = v.z;
        first = false;
      } else {
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
      }
      maxPhase = Math.max(maxPhase, v.phase);
    }
    const model: StoredModel = {
      size: list.length ? [maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1] : [0, 0, 0],
      origin: list.length ? [minX, minY, minZ] : [0, 0, 0],
      phases: Math.max(1, phaseCount, maxPhase + 1),
      blocks: list.map((v) => ({
        x: v.x, y: v.y, z: v.z, name: v.name, rotation: v.rotation ?? 0, phase: v.phase,
      })),
    };
    return { model, voxels: new Map(voxels), phaseCount: model.phases };
  }, [list, phaseCount, voxels]);

  const save = useMutation({
    mutationFn: (snapshot: EditorSaveSnapshot) => api.setBuildVoxels(buildId, snapshot.model),
    onSuccess: (_result, snapshot) => {
      // El usuario puede seguir construyendo durante la escritura: solo se marca como guardada
      // la instantánea enviada, nunca cambios posteriores por accidente.
      savedSnapshot.current = {
        voxels: new Map(snapshot.voxels),
        phaseCount: snapshot.phaseCount,
      };
      setSavedRevision((value) => value + 1);
      qc.invalidateQueries({ queryKey: ["build", buildId] });
      qc.invalidateQueries({ queryKey: ["voxels", buildId] });
      qc.invalidateQueries({ queryKey: ["build_summaries"] });
      toast("Modelo guardado", "success");
    },
    onError: (e) => toast(errorMessage(e, "No se pudo guardar el modelo"), "error"),
  });
  saveActionRef.current = () => {
    if (dirty && !save.isPending) save.mutate(createSaveSnapshot());
  };
  // El estado "Guardado" vuelve a "Guardar modelo" tras un par de segundos.
  useEffect(() => {
    if (!save.isSuccess) return;
    const t = setTimeout(() => save.reset(), 2000);
    return () => clearTimeout(t);
  }, [save.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentParsed = currentBlock ? parseBlockName(currentBlock) : null;
  const currentInfo = currentParsed ? catalog.get(currentParsed.base) : undefined;
  const currentState = currentParsed?.state ?? null;
  const chip = (on: boolean) =>
    cn(
      "rounded border px-2 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-40",
      on ? "border-accent/50 bg-accent/20 text-ink" : "border-line text-muted hover:text-ink",
    );
  const isDragTool = tool === "paint" || tool === "line" || tool === "rect";
  const canUndo = useMemo(() => past.current.length > 0, [histVer]); // eslint-disable-line react-hooks/exhaustive-deps
  const canRedo = useMemo(() => future.current.length > 0, [histVer]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 xl:px-6">
        <div className="flex min-w-[12rem] flex-1 items-center gap-3">
          <Link
            to={`/build/${buildId}`}
            className="inline-flex items-center gap-1 rounded text-sm text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <HyIcon name="back" size={16} /> Ficha
          </Link>
          <span className="truncate text-ink">Editor 3D · {detail.data?.build.name ?? ""}</span>
          <span className="shrink-0 text-xs text-muted">· {list.length} bloques</span>
          {loaded && (
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium",
                dirty
                  ? "border-gold/50 bg-gold/10 text-gold"
                  : "border-accent/30 bg-accent/10 text-accent-hi",
              )}
              role="status"
              aria-live="polite"
            >
              {dirty ? "● Sin guardar" : "✓ Guardado"}
            </span>
          )}
          <span
            className="shrink-0 rounded-full border border-accent/40 bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent-hi"
            title="Herramienta activa"
          >
            {TOOL_LABELS[tool] ?? tool}
          </span>
        </div>
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1.5">
          {/* Historial */}
          <Button variant="secondary" size="icon" onClick={undo} disabled={!canUndo} aria-label="Deshacer" title="Deshacer (Ctrl+Z)">
            <HyIcon name="undo" size={16} />
          </Button>
          <Button variant="secondary" size="icon" onClick={redo} disabled={!canRedo} aria-label="Rehacer" title="Rehacer (Ctrl+Shift+Z)">
            <HyIcon name="redo" size={16} />
          </Button>
          <div className="mx-1 h-5 w-px bg-line" aria-hidden />
          {/* Modelo */}
          <Button variant="secondary" size="icon" onClick={() => setConfirmClear(true)} disabled={list.length === 0} aria-label="Vaciar el modelo" title="Vaciar el modelo">
            <HyIcon name="trash" size={16} />
          </Button>
          <Button variant="secondary" size="icon" onClick={() => setPlanOpen(true)} disabled={list.length === 0} aria-label="Plano por capas" title="Plano por capas con medidas y recuento">
            <HyIcon name="layers" size={16} />
          </Button>
          <Button variant="secondary" size="icon" onClick={() => setHelpOpen(true)} aria-label="Atajos y controles" title="Atajos de teclado y controles">
            <HelpCircle size={16} aria-hidden />
          </Button>
          <div className="mx-1 h-5 w-px bg-line" aria-hidden />
          {/* Acción primaria */}
          <Button
            onClick={() => saveActionRef.current()}
            disabled={save.isPending || !dirty}
            title="Guardar modelo (Ctrl/⌘ + S)"
          >
            <HyIcon name="check" size={18} />
            {save.isPending
              ? "Guardando…"
              : dirty
                ? "Guardar modelo"
                : save.isSuccess
                  ? "Guardado"
                  : "Sin cambios"}
          </Button>
        </div>
      </header>

      <ResizableSidebar
        className="flex-1"
        storageKey="vf_editor_side"
        collapsible
        collapseStorageKey="vf_editor_side_collapsed"
        collapseLabel="panel de bloques"
        main={
          <div className="relative h-full min-h-[320px] bg-bg">
          {/* Rail de herramientas flotante (siempre visible sobre el lienzo) */}
          {loaded && (
            <div className="absolute left-3 top-3 z-10 max-h-[calc(100%-1.5rem)] overflow-y-auto">
              <EditorToolPalette tool={tool} setTool={setTool} orientation="rail" canPaste={!!clipboard} />
            </div>
          )}
          {loaded ? (
            <Suspense
              fallback={<div className="flex h-full items-center justify-center text-muted">Cargando editor 3D…</div>}
            >
              <VoxelEditorLazy
                voxels={list}
                catalog={catalog}
                currentPhase={focusPhase ? currentPhase : null}
                currentBlock={currentBlock}
                currentRotation={currentRotation}
                models={models}
                tool={tool}
                freePlace={freePlace}
                freeHeight={freeHeight}
                autoOrient={autoOrient}
                ops={ops}
                selBox={selBox}
                clipboard={clipboard}
                symmetry={symX || symZ ? { x: symX, z: symZ, cx: symCx, cz: symCz } : null}
                onPlace={place}
                onRemove={remove}
                onReplace={replaceAt}
                onEyedrop={eyedropAt}
                onPaint={paintCells}
                onSelectBox={onSelectBox}
                onPaste={pasteAt}
              />
            </Suspense>
          ) : (
            <div className="flex h-full items-center justify-center text-muted">Cargando modelo…</div>
          )}
          </div>
        }
        side={
        <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
          <div className="border-b border-line p-3">
            <SegmentedControl
              fluid
              label="Panel lateral"
              value={sidePanel}
              onChange={setSidePanel}
              segments={[
                { value: "blocks", label: "Bloques", icon: "blocks" },
                { value: "scene", label: "Escena", icon: "settings" },
              ]}
            />
          </div>

          {/* ── Pestaña BLOQUES: bloque actual + recientes + navegador a altura completa ── */}
          {sidePanel === "blocks" && (
            <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
              <div className="rounded-md border border-line bg-surface-2/50 p-2">
                <div className="flex items-center gap-2">
                  <SlotIcon
                    block={
                      currentInfo ?? {
                        icon: null,
                        name: currentBlock ?? "—",
                        display_name: null,
                        fallback_color: null,
                      }
                    }
                    size={36}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">
                      {currentInfo?.display_name ?? currentParsed?.base ?? "Sin selección"}
                      {currentState && (
                        <span className="text-muted"> · {humanizeTechnicalName(currentState)}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted">
                      Orientación:{" "}
                      <span className="text-ink">{rotationLabel(currentRotation)}</span>
                    </div>
                  </div>
                </div>
                {/* Controles de los tres ejes de RotationTuple (yaw, pitch y roll). */}
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  <button
                    onClick={() => setCurrentRotation(rotateRotationY)}
                    title="Girar 90° (tecla R)"
                    className="flex items-center justify-center gap-1.5 rounded border border-line py-1.5 text-xs text-ink hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    <HyIcon name="rotate" size={14} /> Girar
                    <kbd className="rounded bg-bg/60 px-1 text-[10px] text-muted">R</kbd>
                  </button>
                  <button
                    onClick={() => setCurrentRotation((r) => {
                      const tuple = decodeRotation(r);
                      return encodeRotation({ ...tuple, pitch: tuple.pitch + 1 });
                    })}
                    title="Inclinar 90° sobre X (Mayús+R)"
                    className="flex items-center justify-center gap-1.5 rounded border border-line py-1.5 text-xs text-ink hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    <FlipVertical2 size={14} aria-hidden /> Inclinar
                    <kbd className="rounded bg-bg/60 px-1 text-[10px] text-muted">⇧R</kbd>
                  </button>
                  <button
                    onClick={() => setCurrentRotation((r) => {
                      const tuple = decodeRotation(r);
                      return encodeRotation({ ...tuple, roll: tuple.roll + 1 });
                    })}
                    title="Girar 90° sobre Z (Alt+R)"
                    className="flex items-center justify-center gap-1.5 rounded border border-line py-1.5 text-xs text-ink hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    <FlipVertical2 size={14} className="rotate-90" aria-hidden /> Eje
                    <kbd className="rounded bg-bg/60 px-1 text-[10px] text-muted">⌥R</kbd>
                  </button>
                </div>
                {currentInfo && currentInfo.states.length > 0 && (
                  <label className="mt-2 block text-[11px] text-muted">
                    Estado / forma oficial
                    <select
                      value={currentState ?? "default"}
                      onChange={(event) => {
                        const state = event.target.value;
                        pickBlock(
                          state === "default"
                            ? currentInfo.name
                            : `*${currentInfo.name}_State_Definitions_${state}`,
                        );
                      }}
                      className="mt-1 min-h-9 w-full cursor-pointer rounded-md border border-line bg-surface px-2 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    >
                      <option value="default">Forma base</option>
                      {currentInfo.states.map((state) => (
                        <option key={state.state} value={state.state}>
                          {humanizeTechnicalName(state.state)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {/* Colocación inteligente: orienta escaleras/puertas/muebles hacia la cámara. */}
                <label className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                  <input
                    type="checkbox"
                    checked={autoOrient}
                    onChange={(e) => setAutoOrient(e.target.checked)}
                    className="accent-[var(--color-accent)] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  />
                  Colocación inteligente{" "}
                  <span className="text-muted/70">(orienta hacia la cámara)</span>
                </label>
              </div>
              {recent.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {recent.map((nm) => {
                    const parsed = parseBlockName(nm);
                    const info = catalog.get(parsed.base);
                    const active = nm === currentBlock;
                    return (
                      <button
                        key={nm}
                        type="button"
                        onClick={() => pickBlock(nm)}
                        title={`${info?.display_name ?? parsed.base}${parsed.state ? ` · ${humanizeTechnicalName(parsed.state)}` : ""}`}
                        aria-label={`${info?.display_name ?? parsed.base}${parsed.state ? ` · ${humanizeTechnicalName(parsed.state)}` : ""}`}
                        aria-pressed={active}
                        className={cn(
                          "cursor-pointer rounded-md border p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
                          active ? "border-accent/60 bg-accent/20" : "border-line hover:bg-elevated",
                        )}
                      >
                        <SlotIcon
                          block={info ?? { icon: null, name: nm, display_name: null, fallback_color: null }}
                          size={30}
                        />
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="min-h-0 flex-1">
                <BlockBrowser
                  blocks={catalogList}
                  selectedName={currentParsed?.base ?? currentBlock}
                  onPick={(b) => pickBlock(b.name)}
                  defaultOnlyBlocks={true}
                  slotSize={44}
                  compact
                />
              </div>
            </div>
          )}

          {/* ── Pestaña ESCENA: opciones de herramienta + simetría + fases + ajustes ── */}
          {sidePanel === "scene" && (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
          {/* Opciones de la herramienta activa (las herramientas están en el rail flotante) */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-ink">Opciones</h3>

            {/* Opciones de Línea/Caja: relleno/contorno + altura */}
            {(tool === "rect" || tool === "line") && (
              <div className="mt-2 space-y-2 rounded-md border border-line bg-surface-2/40 p-2">
                {tool === "rect" && (
                  <div className="flex flex-wrap gap-1.5">
                    <button aria-pressed={!rectFilled} onClick={() => setRectFilled(false)} className={chip(!rectFilled)}>
                      Contorno
                    </button>
                    <button aria-pressed={rectFilled} onClick={() => setRectFilled(true)} className={chip(rectFilled)}>
                      Relleno
                    </button>
                    {!rectFilled && (
                      <button
                        aria-pressed={rectHollow}
                        onClick={() => setRectHollow((v) => !v)}
                        title="Caja hueca: paredes + suelo + techo (cáscara)"
                        className={chip(rectHollow)}
                      >
                        Hueco
                      </button>
                    )}
                  </div>
                )}
                <label className="flex items-center gap-2 text-xs text-muted">
                  Altura
                  <input
                    type="number"
                    min={1}
                    max={64}
                    value={opHeight}
                    onChange={(e) => setOpHeight(Math.max(1, Math.min(64, Number(e.target.value) || 1)))}
                    className="w-16 rounded border border-line bg-surface px-1.5 py-0.5 text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
                  />
                  <span className="text-[10px]">{tool === "line" ? "1=línea · >1=muro" : "capas"}</span>
                </label>
              </div>
            )}

            {/* Opciones de Brocha: forma + tamaño */}
            {tool === "brush" && (
              <div className="mt-2 space-y-2 rounded-md border border-line bg-surface-2/40 p-2">
                <div className="flex flex-wrap gap-1.5">
                  <button aria-pressed={brushShape === "cube"} onClick={() => setBrushShape("cube")} className={chip(brushShape === "cube")}>
                    Cubo
                  </button>
                  <button aria-pressed={brushShape === "sphere"} onClick={() => setBrushShape("sphere")} className={chip(brushShape === "sphere")}>
                    Esfera
                  </button>
                  <button aria-pressed={brushShape === "cylinder"} onClick={() => setBrushShape("cylinder")} className={chip(brushShape === "cylinder")}>
                    Cilindro
                  </button>
                  <button
                    aria-pressed={brushHollow}
                    onClick={() => setBrushHollow((v) => !v)}
                    title="Solo la cáscara (hueco), con grosor de pared 1"
                    className={chip(brushHollow)}
                  >
                    Hueco
                  </button>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted">
                  Tamaño
                  <input
                    type="number"
                    min={1}
                    max={21}
                    value={brushSize}
                    onChange={(e) => setBrushSize(Math.max(1, Math.min(21, Number(e.target.value) || 1)))}
                    className="w-16 rounded border border-line bg-surface px-1.5 py-0.5 text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
                  />
                </label>
              </div>
            )}

            {isDragTool && (
              <p className="mt-2 text-[11px] text-muted">
                Arrastra con el botón <span className="text-ink">izquierdo</span> para pintar; el{" "}
                <span className="text-ink">derecho</span> gira la cámara. ⇧ borra.
              </p>
            )}

            {/* Selección: copiar/cortar/guardar como prefab */}
            {tool === "select" && (
              <div className="mt-2 space-y-2 rounded-md border border-line bg-surface-2/40 p-2">
                <p className="text-[11px] text-muted">
                  Arrastra para seleccionar una zona{selBox ? " · selección activa" : ""}. El{" "}
                  <span className="text-ink">derecho</span> gira la cámara.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button disabled={!selBox} onClick={copySel} className={chip(false)}>
                    Copiar
                  </button>
                  <button disabled={!selBox} onClick={cutSel} className={chip(false)}>
                    Cortar
                  </button>
                  <button disabled={!selBox} onClick={() => setSelBox(null)} className={chip(false)}>
                    Quitar
                  </button>
                </div>
                <button
                  disabled={!selBox || savePrefab.isPending}
                  onClick={() => savePrefab.mutate()}
                  className={cn(
                    "w-full rounded border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40",
                    "border-accent/40 bg-accent/15 text-ink hover:bg-accent/25",
                  )}
                >
                  {savePrefab.isPending ? "Guardando…" : "Guardar selección como prefab"}
                </button>
                {savedPrefab && (
                  <p className="text-[11px] text-accent-hi">Guardado en la biblioteca: {savedPrefab.name}</p>
                )}
                {savePrefab.error && (
                  <p className="text-[11px] text-danger">{errorMessage(savePrefab.error)}</p>
                )}
              </div>
            )}

            {/* Portapapeles: pegar / rotar / espejo */}
            {clipboard && (tool === "select" || tool === "paste") && (
              <div className="mt-2 space-y-2 rounded-md border border-line bg-surface-2/40 p-2">
                <p className="text-[11px] text-muted">
                  Portapapeles: {clipboard.cells.length} bloques · {clipboard.w}×{clipboard.h}×
                  {clipboard.d}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button aria-pressed={tool === "paste"} onClick={() => setTool("paste")} className={chip(tool === "paste")}>
                    Pegar
                  </button>
                  <button onClick={() => setClipboard(rotateClipboard(clipboard))} className={chip(false)}>
                    Rotar
                  </button>
                  <button onClick={() => setClipboard(mirrorClipboardX(clipboard))} className={chip(false)}>
                    Espejo X
                  </button>
                  <button onClick={() => setClipboard(mirrorClipboardZ(clipboard))} className={chip(false)}>
                    Espejo Z
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted">Copias en círculo</span>
                  {[1, 2, 4].map((n) => (
                    <button key={n} aria-pressed={revolve === n} onClick={() => setRevolve(n)} className={chip(revolve === n)}>
                      ×{n}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted">Apilar</span>
                  {[1, 2, 3, 5].map((n) => (
                    <button key={n} aria-pressed={stack === n} onClick={() => setStack(n)} className={chip(stack === n)}>
                      ×{n}
                    </button>
                  ))}
                  {stack > 1 &&
                    (
                      [
                        ["x+", "Este →"],
                        ["x-", "Oeste ←"],
                        ["z+", "Sur ↓"],
                        ["z-", "Norte ↑"],
                        ["y+", "Arriba"],
                        ["y-", "Abajo"],
                      ] as const
                    ).map(([d, label]) => (
                      <button
                        key={d}
                        aria-pressed={stackDir === d}
                        onClick={() => setStackDir(d)}
                        title={`Apilar hacia ${label}`}
                        className={chip(stackDir === d)}
                      >
                        {label}
                      </button>
                    ))}
                </div>
                {tool === "paste" && (
                  <p className="text-[11px] text-muted">
                    Haz clic para pegar bajo el cursor{revolve > 1 ? ` (${revolve} copias en círculo)` : ""}.
                  </p>
                )}
              </div>
            )}

            {/* Modo de colocación: SNAP (pegado a superficies) vs FLOTANTE (a una altura/capa). */}
            <div className="mt-2 rounded-md border border-line bg-surface-2/40 p-2">
              <p className="mb-1 text-[11px] font-medium text-ink">Altura de colocación (capa)</p>
              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={freePlace}
                  onChange={(e) => setFreePlace(e.target.checked)}
                  className="accent-[var(--color-accent)] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                />
                Flotante a una altura{freePlace ? ` · capa ${freeHeight}` : ""}
              </label>
              <p className="mt-1 text-[10px] leading-snug text-muted/80">
                {freePlace
                  ? "Colocas/pintas sobre el plano a esa altura (encima de lo que haya debajo)."
                  : "Desactivado = pegado a superficies (snap): coloca contra la cara que apuntas."}
              </p>
              {freePlace && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-xs text-muted">Altura</span>
                  <input
                    type="range"
                    min={0}
                    max={60}
                    value={freeHeight}
                    aria-label="Altura de colocación flotante"
                    aria-valuetext={`${freeHeight} bloques`}
                    onChange={(e) => setFreeHeight(Number(e.target.value))}
                    className="flex-1 accent-[var(--color-accent)] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  />
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={freeHeight}
                    aria-label="Altura exacta de la capa"
                    onChange={(e) => setFreeHeight(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
                    className="w-14 rounded border border-line bg-surface px-1.5 py-0.5 text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
                  />
                </div>
              )}
              <p className="mt-1 text-[10px] text-muted/70">
                Atajos: <kbd className="rounded bg-bg/60 px-1">[</kbd> /{" "}
                <kbd className="rounded bg-bg/60 px-1">]</kbd> baja/sube la capa ·{" "}
                <kbd className="rounded bg-bg/60 px-1">G</kbd> alterna
              </p>
            </div>
          </div>

          {/* Simetría en vivo (uso ocasional → colapsable) */}
          <details className="group" open={symX || symZ}>
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-ink marker:content-none">
              Simetría{symX || symZ ? <span className="text-[11px] text-accent-hi">activa</span> : null}
              <HyIcon name="forward" size={12} className="rotate-90 opacity-60 transition-transform group-open:-rotate-90" />
            </summary>
            <div className="mt-2 flex gap-1.5">
              <button aria-pressed={symX} onClick={() => setSymX((v) => !v)} className={chip(symX)}>
                Espejo X
              </button>
              <button aria-pressed={symZ} onClick={() => setSymZ((v) => !v)} className={chip(symZ)}>
                Espejo Z
              </button>
            </div>
            {(symX || symZ) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>Centro:</span>
                {symX && (
                  <label className="flex items-center gap-1">
                    X
                    <input
                      type="number"
                      value={symCx}
                      onChange={(e) => setSymCx(Math.round(Number(e.target.value) || 0))}
                      className="w-14 rounded border border-line bg-surface px-1.5 py-0.5 text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
                    />
                  </label>
                )}
                {symZ && (
                  <label className="flex items-center gap-1">
                    Z
                    <input
                      type="number"
                      value={symCz}
                      onChange={(e) => setSymCz(Math.round(Number(e.target.value) || 0))}
                      className="w-14 rounded border border-line bg-surface px-1.5 py-0.5 text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
                    />
                  </label>
                )}
              </div>
            )}
            <p className="mt-1 text-[10px] text-muted">
              Cada acción se refleja en vivo a través del plano elegido (medio edificio → entero).
            </p>
          </details>

          {/* Fases */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium text-ink">Fase activa</h3>
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={focusPhase}
                  onChange={(e) => setFocusPhase(e.target.checked)}
                  className="accent-[var(--color-accent)] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                />
                Atenuar otras
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: phaseCount }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentPhase(i)}
                  aria-pressed={i === currentPhase}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                    i === currentPhase
                      ? "border-accent/50 bg-accent/20 text-ink"
                      : "border-line text-muted hover:text-ink",
                  )}
                >
                  <span
                    className="inline-block h-3 w-3 rounded-sm"
                    style={{ backgroundColor: phaseColor(i) }}
                  />
                  Fase {i + 1}
                </button>
              ))}
              <button
                onClick={() => {
                  // Deriva el índice de la nueva fase del updater (no de `phaseCount` del
                  // render, que sería obsoleto en un doble clic rápido): así se queda en la
                  // ÚLTIMA fase creada, no en una intermedia.
                  setPhaseCount((n) => {
                    setCurrentPhase(n); // n = índice 0-based de la fase recién añadida
                    return n + 1;
                  });
                }}
                className="rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                + Fase
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">
              Lo que coloques se asigna a la fase activa.
            </p>
          </div>

          {/* Ajustes del editor (uso ocasional → colapsable) */}
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-ink marker:content-none">
              Ajustes
              <HyIcon name="forward" size={12} className="rotate-90 opacity-60 transition-transform group-open:-rotate-90" />
            </summary>
            <label className="mt-2 flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={sound}
                onChange={(e) => setSound(e.target.checked)}
                className="accent-[var(--color-accent)] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              />
              Sonidos al construir
            </label>
            <label className="mt-1.5 flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={models}
                onChange={(e) => setModels(e.target.checked)}
                className="accent-[var(--color-accent)] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              />
              Modelos 3D reales (muebles, plantas)
            </label>
            <p className="mt-2 text-[11px] text-muted">
              ¿Atajos? Pulsa <span className="text-ink">?</span> arriba para ver todos los controles.
            </p>
          </details>
            </div>
          )}
        </aside>
        }
      />

      {blocker.state === "blocked" && (
        <ConfirmDialog
          title="Cambios sin guardar"
          message="Si sales ahora, perderás los cambios realizados desde el último guardado."
          confirmLabel="Salir sin guardar"
          cancelLabel="Seguir editando"
          destructive
          closeAfterConfirm={false}
          onConfirm={() => blocker.proceed()}
          onClose={() => blocker.reset()}
        />
      )}

      {planOpen && (
        <Modal
          onClose={() => setPlanOpen(false)}
          label="Plano por capas"
          maxW="max-w-3xl"
          className="flex max-h-[85vh] flex-col overflow-auto"
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xl">Plano por capas</h3>
            <Button variant="secondary" size="sm" onClick={() => setPlanOpen(false)}>
              Cerrar
            </Button>
          </div>
          <LayerBlueprint
            model={{ size: [0, 0, 0], origin: [0, 0, 0], phases: 1, blocks: list }}
            catalog={catalog}
          />
        </Modal>
      )}

      {confirmClear && (
        <Modal
          onClose={() => setConfirmClear(false)}
          label="Vaciar el modelo"
          role="alertdialog"
          maxW="max-w-md"
        >
          <h3 className="mb-2 text-xl">¿Vaciar el modelo?</h3>
          <p className="mb-5 text-sm text-muted">
            Se quitarán los {list.length} bloques del lienzo. Puedes recuperarlos con{" "}
            <span className="text-ink">Ctrl/⌘ + Z</span>, pero se perderán al guardar.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmClear(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={doClearAll}>
              Sí, vaciar
            </Button>
          </div>
        </Modal>
      )}

      {helpOpen && (
        <Modal onClose={() => setHelpOpen(false)} label="Atajos y controles" maxW="max-w-md">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xl">Atajos y controles</h3>
            <Button variant="secondary" size="sm" onClick={() => setHelpOpen(false)}>
              Cerrar
            </Button>
          </div>
          <div className="space-y-4 text-sm">
              {(
                [
                  ["Herramientas", [
                    ["1 · 2 · 3 · 4", "Colocar · Borrador · Reemplazar · Cuentagotas"],
                    ["5 · 6 · 7 · 8 · 9", "Pintar · Línea · Caja · Rellenar · Brocha"],
                    ["V", "Pegar (Seleccionar va en el rail; sin atajo para no chocar con WASD)"],
                  ]],
                  ["Construir", [
                    ["Clic izquierdo", "Coloca pegado a la cara o el suelo que apuntas"],
                    ["Arrastrar izquierdo", "Coloca/borra en serie (bloques contiguos)"],
                    ["⇧ + clic/arrastrar", "Borra"],
                    ["R · ⇧R · ⌥R", "Girar · inclinar · alabeo (los tres ejes oficiales)"],
                  ]],
                  ["Edición", [
                    ["Ctrl/⌘ + S", "Guardar el modelo"],
                    ["Ctrl/⌘ + Z", "Deshacer"],
                    ["Ctrl/⌘ + ⇧ + Z · Ctrl + Y", "Rehacer"],
                    ["Ctrl/⌘ + C · X", "Copiar · cortar la selección"],
                  ]],
                  ["Portapapeles (al pegar)", [
                    ["R", "Rotar el portapapeles"],
                    ["F · ⇧F", "Espejo en X · en Z"],
                  ]],
                  ["Cámara", [
                    ["Botón DERECHO", "Girar la vista (orbitar)"],
                    ["Espacio + arrastrar", "Mover la vista (pan)"],
                    ["W A S D · Q/E · Rueda", "Desplazar · bajar/subir · zoom"],
                    ["Iso · Sup. · Frente", "Vistas predefinidas (arriba a la derecha)"],
                  ]],
                  ["Capas", [
                    ["[ · ]", "Bajar / subir la altura de construcción"],
                    ["G", "Colocar flotando a esa altura (Free Place)"],
                  ]],
                ] as [string, [string, string][]][]
              ).map(([group, rows]) => (
                <div key={group}>
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-accent-hi">
                    {group}
                  </p>
                  <ul className="space-y-1">
                    {rows.map(([k, v]) => (
                      <li key={k} className="flex items-start justify-between gap-3">
                        <span className="shrink-0 font-mono text-xs text-ink">{k}</span>
                        <span className="text-right text-xs text-muted">{v}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
        </Modal>
      )}
    </div>
  );
}
