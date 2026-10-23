import { useSyncExternalStore } from "react";
import {
    defaultMeta,
    EditSession,
    MapDocument,
    type ChangeSet,
    type MapMeta,
    type MapSource,
    type ObjectDrop,
    type Stamp,
} from "@aoturnos/game-core";

export type ToolId = "brush" | "eraser" | "fill" | "rect" | "picker" | "block" | "trigger" | "exit" | "npc" | "object" | "pan";

export type MapListEntry = { id: number; name: string; zona: string };

/** Destino de la herramienta Salida. null en x o y = "la misma columna o fila que la casilla de origen". */
export type ExitDraft = { map: number; x: number | null; y: number | null };

export type EditorState = {
    maps: MapListEntry[];
    /** Números que ya usa el juego aunque no tengan fuente editable. */
    reserved: number[];
    nextFreeId: number | null;
    mapId: number | null;
    loading: boolean;
    /** Sube con cada cambio del documento: los paneles de React lo usan para refrescarse. */
    revision: number;
    dirty: boolean;
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string | null;
    redoLabel: string | null;

    tool: ToolId;
    /** Capa activa, 0 a 3 (en pantalla se muestran 1 a 4). */
    layer: number;
    brushSize: number;
    /** Gráfico elegido en la paleta. */
    grh: number;
    /** Sello copiado con el cuentagotas; mientras exista, el pincel lo pega. */
    stamp: Stamp | null;
    trigger: number;
    npcIndex: number;
    object: ObjectDrop;
    exit: ExitDraft;
    recent: number[];

    show: {
        layers: [boolean, boolean, boolean, boolean];
        grid: boolean;
        blocked: boolean;
        triggers: boolean;
        exits: boolean;
        npcs: boolean;
        objects: boolean;
        /** Techos semitransparentes para ver lo que hay abajo. */
        ghostRoofs: boolean;
    };

    hover: { x: number; y: number } | null;
    zoom: number;
    status: { kind: "idle" | "saving" | "saved" | "error" | "info"; text: string };
};

const initial: EditorState = {
    maps: [],
    reserved: [],
    nextFreeId: null,
    mapId: null,
    loading: false,
    revision: 0,
    dirty: false,
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
    tool: "brush",
    layer: 0,
    brushSize: 1,
    grh: 0,
    stamp: null,
    trigger: 1,
    npcIndex: 0,
    object: { objIndex: 0, amount: 1 },
    exit: { map: 1, x: null, y: null },
    recent: [],
    show: {
        layers: [true, true, true, true],
        grid: true,
        blocked: true,
        triggers: true,
        exits: true,
        npcs: true,
        objects: true,
        ghostRoofs: true,
    },
    hover: null,
    zoom: 1,
    status: { kind: "idle", text: "" },
};

let current = initial;
const listeners = new Set<() => void>();
const changeListeners = new Set<(changes: ChangeSet | "reload") => void>();

let doc: MapDocument | null = null;
let session: EditSession | null = null;

function set(patch: Partial<EditorState>): void {
    current = { ...current, ...patch };
    for (const l of listeners) l();
}

function syncHistory(): void {
    if (!session) return;
    set({
        revision: current.revision + 1,
        dirty: session.dirty,
        canUndo: session.canUndo,
        canRedo: session.canRedo,
        undoLabel: session.undoLabel,
        redoLabel: session.redoLabel,
    });
}

function emit(changes: ChangeSet | "reload"): void {
    for (const l of changeListeners) l(changes);
}

function adopt(next: MapDocument): void {
    doc = next;
    session = new EditSession(next, (changes) => {
        emit(changes);
        // El historial se resincroniza al cerrar cada grupo (ver commit); acá solo marcamos sucio.
        if (!current.dirty) set({ dirty: true });
    });
    set({ mapId: next.id, loading: false });
    syncHistory();
    emit("reload");
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { cache: "no-store", ...init });
    const body = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`);
    return body;
}

export const editor = {
    get: () => current,
    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    /** Avisos de cambios del documento para la escena (qué baldosas redibujar). */
    onDocumentChange(listener: (changes: ChangeSet | "reload") => void): () => void {
        changeListeners.add(listener);
        return () => changeListeners.delete(listener);
    },
    get doc(): MapDocument | null {
        return doc;
    },
    get session(): EditSession | null {
        return session;
    },
    set,

    async loadList(): Promise<void> {
        const list = await api<{ maps: MapListEntry[]; reserved: number[]; nextFreeId: number | null }>("/api/editor/maps");
        set({ maps: list.maps, reserved: list.reserved, nextFreeId: list.nextFreeId });
    },

    async open(id: number): Promise<void> {
        set({ loading: true, status: { kind: "info", text: `Abriendo mapa ${id}…` } });
        try {
            const source = await api<MapSource>(`/api/editor/maps/${id}`);
            adopt(MapDocument.fromSource(source));
            set({ status: { kind: "idle", text: "" } });
            try {
                localStorage.setItem("mapEditor:lastMap", String(id));
            } catch {
                // sin almacenamiento local: no pasa nada
            }
        } catch (error) {
            set({ loading: false, status: { kind: "error", text: (error as Error).message } });
        }
    },

    create(meta: MapMeta, width: number, height: number, floor: number): void {
        adopt(MapDocument.blank({ ...defaultMeta(meta.id), ...meta }, width, height, floor));
        // Un mapa nuevo existe solo en memoria hasta guardarlo.
        set({ dirty: true, status: { kind: "info", text: `Mapa ${meta.id} creado. Guardalo para que exista en el juego.` } });
    },

    async save(): Promise<void> {
        if (!doc || !session || current.status.kind === "saving") return;
        session.commit();
        set({ status: { kind: "saving", text: "Guardando…" } });
        try {
            await api(`/api/editor/maps/${doc.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(doc.toSource()),
            });
            session.markSaved();
            syncHistory();
            set({ status: { kind: "saved", text: `Guardado ${new Date().toLocaleTimeString()}` } });
            void editor.loadList();
        } catch (error) {
            set({ status: { kind: "error", text: `No se pudo guardar: ${(error as Error).message}` } });
        }
    },

    /** Cierra el grupo de edición abierto (fin de un trazo) y actualiza deshacer/rehacer. */
    commit(): void {
        session?.commit();
        syncHistory();
    },

    undo(): void {
        if (session?.undo()) syncHistory();
    },

    redo(): void {
        if (session?.redo()) syncHistory();
    },

    setMeta(patch: Partial<MapMeta>): void {
        session?.setMeta(patch);
        syncHistory();
    },

    /** Elige un gráfico de la paleta: suelta el sello y vuelve al pincel si hacía falta. */
    pickGraphic(grh: number): void {
        const recent = [grh, ...current.recent.filter((g) => g !== grh)].slice(0, 24);
        const tool = current.tool === "brush" || current.tool === "fill" || current.tool === "rect" ? current.tool : "brush";
        set({ grh, stamp: null, recent, tool });
    },
};

export function useEditor<T>(select: (state: EditorState) => T): T {
    return useSyncExternalStore(
        editor.subscribe,
        () => select(current),
        () => select(initial),
    );
}
