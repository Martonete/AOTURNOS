import { MapDocument, sameTileState, type Layers, type TileState } from "./document";
import type { MapMeta, NpcPlacement } from "./format";

/** Un paso del historial: todo lo que cambió en un trazo del pincel, un relleno o un pegado. */
export type Edit = {
    /** Único por paso: sirve para saber si lo que hay en pantalla es lo guardado. */
    id: number;
    label: string;
    tiles: Map<number, { before: TileState; after: TileState }>;
    npcs?: { before: NpcPlacement[]; after: NpcPlacement[] };
    meta?: { before: MapMeta; after: MapMeta };
};

/** Qué cambió, para redibujar solo eso. */
export type ChangeSet = { tiles: number[]; npcs: boolean; meta: boolean };

const HISTORY_LIMIT = 200;

/**
 * Historial de ediciones de un MapDocument. Cada cambio pasa por acá dentro de un grupo
 * (begin → change… → commit) y se puede deshacer o rehacer entero.
 */
export class EditSession {
    private undoStack: Edit[] = [];
    private redoStack: Edit[] = [];
    private open: Edit | null = null;
    private nextId = 1;
    /** Id del último paso que estaba aplicado al guardar (0 = el mapa tal como se abrió). */
    private savedId = 0;

    constructor(
        readonly doc: MapDocument,
        private readonly onChange: (changes: ChangeSet) => void = () => {},
    ) {}

    private get currentId(): number {
        return this.undoStack.at(-1)?.id ?? 0;
    }

    get dirty(): boolean {
        const pending = this.open && (this.open.tiles.size > 0 || this.open.npcs || this.open.meta);
        return Boolean(pending) || this.currentId !== this.savedId;
    }

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    get canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    get undoLabel(): string | null {
        return this.undoStack.at(-1)?.label ?? null;
    }

    get redoLabel(): string | null {
        return this.redoStack.at(-1)?.label ?? null;
    }

    markSaved(): void {
        this.commit();
        this.savedId = this.currentId;
    }

    begin(label: string): void {
        if (this.open) this.commit();
        this.open = { id: this.nextId++, label, tiles: new Map() };
    }

    /** Modifica una baldosa dentro del grupo abierto. Devuelve false si quedó igual. */
    change(index: number, mutate: (tile: TileState) => void): boolean {
        if (index < 0 || index >= this.doc.size) return false;
        const autoCommit = !this.open;
        if (autoCommit) this.begin("Edición");
        const before = this.doc.tile(index);
        const next = this.doc.tile(index);
        mutate(next);
        if (sameTileState(before, next)) {
            if (autoCommit) this.commit();
            return false;
        }
        this.doc.setTile(index, next);
        const entry = this.open!.tiles.get(index);
        this.open!.tiles.set(index, { before: entry?.before ?? before, after: this.doc.tile(index) });
        this.onChange({ tiles: [index], npcs: false, meta: false });
        if (autoCommit) this.commit();
        return true;
    }

    setNpcs(next: NpcPlacement[], label = "NPCs"): void {
        const autoCommit = !this.open;
        if (autoCommit) this.begin(label);
        const before = this.open!.npcs?.before ?? this.doc.npcs.map((n) => ({ ...n }));
        this.doc.npcs = next.map((n) => ({ ...n, mapNum: this.doc.id }));
        this.open!.npcs = { before, after: this.doc.npcs.map((n) => ({ ...n })) };
        this.onChange({ tiles: [], npcs: true, meta: false });
        if (autoCommit) this.commit();
    }

    setMeta(patch: Partial<MapMeta>): void {
        const before = { ...this.doc.meta };
        const after = { ...before, ...patch, id: before.id };
        if (JSON.stringify(before) === JSON.stringify(after)) return;
        this.begin("Propiedades del mapa");
        this.doc.meta = after;
        this.open!.meta = { before, after: { ...after } };
        this.onChange({ tiles: [], npcs: false, meta: true });
        this.commit();
    }

    /** Cierra el grupo abierto. Un grupo sin cambios no entra al historial. */
    commit(): Edit | null {
        const edit = this.open;
        this.open = null;
        if (!edit || (edit.tiles.size === 0 && !edit.npcs && !edit.meta)) return null;
        this.undoStack.push(edit);
        if (this.undoStack.length > HISTORY_LIMIT) {
            const dropped = this.undoStack.shift()!;
            // Si lo guardado se cae del historial ya no se puede volver a ese estado deshaciendo.
            if (dropped.id === this.savedId) this.savedId = -1;
        }
        this.redoStack = [];
        return edit;
    }

    undo(): boolean {
        this.commit();
        const edit = this.undoStack.pop();
        if (!edit) return false;
        this.apply(edit, "before");
        this.redoStack.push(edit);
        return true;
    }

    redo(): boolean {
        this.commit();
        const edit = this.redoStack.pop();
        if (!edit) return false;
        this.apply(edit, "after");
        this.undoStack.push(edit);
        return true;
    }

    private apply(edit: Edit, side: "before" | "after"): void {
        for (const [index, states] of edit.tiles) this.doc.setTile(index, states[side]);
        if (edit.npcs) this.doc.npcs = edit.npcs[side].map((n) => ({ ...n }));
        if (edit.meta) this.doc.meta = { ...edit.meta[side] };
        this.onChange({ tiles: [...edit.tiles.keys()], npcs: Boolean(edit.npcs), meta: Boolean(edit.meta) });
    }
}

/* ------------------------------- Formas ------------------------------- */

export type Point = { x: number; y: number };

/** Casillas de una línea (Bresenham): el pincel las recorre para no dejar huecos al mover rápido el mouse. */
export function lineTiles(from: Point, to: Point): Point[] {
    const out: Point[] = [];
    let { x, y } = from;
    const dx = Math.abs(to.x - x);
    const dy = -Math.abs(to.y - y);
    const sx = x < to.x ? 1 : -1;
    const sy = y < to.y ? 1 : -1;
    let err = dx + dy;
    for (;;) {
        out.push({ x, y });
        if (x === to.x && y === to.y) return out;
        const e2 = 2 * err;
        if (e2 >= dy) {
            err += dy;
            x += sx;
        }
        if (e2 <= dx) {
            err += dx;
            y += sy;
        }
    }
}

export type Rect = { x: number; y: number; width: number; height: number };

export function rectBetween(a: Point, b: Point): Rect {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 };
}

/** Cuadrado del pincel centrado en `center` (tamaño 1, 2, 3…; los pares se corren hacia abajo a la derecha). */
export function brushTiles(center: Point, size: number): Point[] {
    const out: Point[] = [];
    const start = -Math.floor((size - 1) / 2);
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) out.push({ x: center.x + start + dx, y: center.y + start + dy });
    return out;
}

/** Baldosas conectadas (sin diagonales) que tienen el mismo gráfico que el origen en esa capa. */
export function floodRegion(doc: MapDocument, layer: number, origin: Point, limit = 20_000): number[] {
    if (!doc.contains(origin.x, origin.y)) return [];
    const data = doc.layers[layer];
    const start = doc.index(origin.x, origin.y);
    const target = data[start];
    const seen = new Uint8Array(doc.size);
    const stack = [start];
    const out: number[] = [];
    seen[start] = 1;
    while (stack.length > 0 && out.length < limit) {
        const i = stack.pop()!;
        out.push(i);
        const x = i % doc.width;
        const neighbours = [x > 0 ? i - 1 : -1, x < doc.width - 1 ? i + 1 : -1, i - doc.width, i + doc.width];
        for (const n of neighbours) {
            if (n < 0 || n >= doc.size || seen[n] || data[n] !== target) continue;
            seen[n] = 1;
            stack.push(n);
        }
    }
    return out;
}

/* ------------------------------- Sellos ------------------------------- */

/**
 * Un pedazo de mapa copiado con el cuentagotas: las cuatro capas y el bloqueo de cada casilla.
 * Al pegarlo solo pisa las capas que tienen algo, así una casa se apoya sobre el pasto de abajo.
 */
export type Stamp = {
    width: number;
    height: number;
    cells: Array<{ layers: Layers; blocked: boolean }>;
    /** El sello copiado del mapa trae su bloqueo; el pincel de un solo gráfico no lo toca. */
    withBlocked: boolean;
};

export function copyStamp(doc: MapDocument, rect: Rect): Stamp {
    const cells: Stamp["cells"] = [];
    for (let dy = 0; dy < rect.height; dy++) {
        for (let dx = 0; dx < rect.width; dx++) {
            const x = rect.x + dx;
            const y = rect.y + dy;
            if (!doc.contains(x, y)) {
                cells.push({ layers: [0, 0, 0, 0], blocked: false });
                continue;
            }
            const t = doc.tile(doc.index(x, y));
            cells.push({ layers: t.layers, blocked: t.blocked });
        }
    }
    return { width: rect.width, height: rect.height, cells, withBlocked: true };
}

/** Pega el sello con su esquina superior izquierda en `at`. */
export function pasteStamp(session: EditSession, stamp: Stamp, at: Point): void {
    const { doc } = session;
    stamp.cells.forEach((cell, k) => {
        const x = at.x + (k % stamp.width);
        const y = at.y + Math.floor(k / stamp.width);
        if (!doc.contains(x, y) || cell.layers.every((g) => !g)) return;
        session.change(doc.index(x, y), (t) => {
            cell.layers.forEach((g, l) => {
                if (g) t.layers[l] = g;
            });
            if (stamp.withBlocked) t.blocked = cell.blocked;
        });
    });
}

/** Sello de una sola baldosa con un gráfico en una capa: lo que pinta el pincel normal. */
export function singleStamp(layer: number, grh: number): Stamp {
    const layers: Layers = [0, 0, 0, 0];
    layers[layer] = grh;
    return { width: 1, height: 1, cells: [{ layers, blocked: false }], withBlocked: false };
}
