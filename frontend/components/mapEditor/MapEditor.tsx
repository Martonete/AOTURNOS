"use client";

import { useEffect, useRef, useState } from "react";
import { FilePlus2, Minus, Plus, Redo2, Save, Undo2 } from "lucide-react";
import type { NPCsDB, ObjectsDB } from "../../types/game";
import { EditorScene } from "./EditorScene";
import { editor, useEditor } from "./editorStore";
import { Minimap } from "./Minimap";
import { Palette } from "./Palette";
import { LayersPanel, MetaPanel, NewMapDialog, Section, TileInfo, Toolbar, TOOL_KEYS, ToolOptions } from "./Panels";

const BRUSH_SIZES = [1, 2, 3, 5, 9];

function isTyping(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/** Atajos de teclado del editor. Ninguno actúa mientras se escribe en un campo. */
function useShortcuts(scene: EditorScene | null): void {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const mod = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();
            if (mod && key === "s") {
                e.preventDefault();
                void editor.save();
                return;
            }
            if (isTyping(e.target)) return;
            if (mod && key === "z") {
                e.preventDefault();
                if (e.shiftKey) editor.redo();
                else editor.undo();
                return;
            }
            if (mod && key === "y") {
                e.preventDefault();
                editor.redo();
                return;
            }
            if (mod || e.altKey) return;

            const state = editor.get();
            if (TOOL_KEYS[key]) editor.set({ tool: TOOL_KEYS[key] });
            else if (["1", "2", "3", "4"].includes(key)) editor.set({ layer: Number(key) - 1 });
            else if (key === "[" || key === "]") {
                const i = BRUSH_SIZES.indexOf(state.brushSize);
                const next = BRUSH_SIZES[Math.max(0, Math.min(BRUSH_SIZES.length - 1, (i < 0 ? 0 : i) + (key === "]" ? 1 : -1)))];
                editor.set({ brushSize: next });
            } else if (key === "escape") editor.set({ stamp: null, status: { kind: "idle", text: "" } });
            else if (key === "+" || key === "=") scene?.zoomAt(1.25);
            else if (key === "-") scene?.zoomAt(0.8);
            else if (key === "0") scene?.setZoom(1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [scene]);
}

export function MapEditor() {
    const hostRef = useRef<HTMLDivElement>(null);
    const [scene, setScene] = useState<EditorScene | null>(null);
    const [creating, setCreating] = useState(false);
    const [dbs, setDbs] = useState<{ npcs: NPCsDB; objects: ObjectsDB }>({ npcs: {}, objects: {} });

    const maps = useEditor((s) => s.maps);
    const mapId = useEditor((s) => s.mapId);
    const dirty = useEditor((s) => s.dirty);
    const canUndo = useEditor((s) => s.canUndo);
    const canRedo = useEditor((s) => s.canRedo);
    const undoLabel = useEditor((s) => s.undoLabel);
    const redoLabel = useEditor((s) => s.redoLabel);
    const status = useEditor((s) => s.status);
    const zoom = useEditor((s) => s.zoom);
    const loading = useEditor((s) => s.loading);

    useEffect(() => {
        if (!hostRef.current) return;
        const instance = new EditorScene(hostRef.current);
        let alive = true;
        void instance.init().then(() => {
            if (!alive) return;
            setScene(instance);
            setDbs({ npcs: instance.npcsDB, objects: instance.objectsDB });
        });
        return () => {
            alive = false;
            instance.destroy();
        };
    }, []);

    // Abre el mapa de ?mapa=N, el último que se editó o el 1.
    useEffect(() => {
        void editor.loadList().then(() => {
            if (editor.doc) return;
            let id = Number(new URLSearchParams(window.location.search).get("mapa"));
            if (!id) {
                try {
                    id = Number(localStorage.getItem("mapEditor:lastMap"));
                } catch {
                    id = 0;
                }
            }
            void editor.open(id > 0 ? id : 1);
        }).catch((error: Error) => editor.set({ status: { kind: "error", text: error.message } }));
    }, []);

    useEffect(() => {
        const warn = (e: BeforeUnloadEvent) => {
            if (editor.get().dirty) e.preventDefault();
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, []);

    useShortcuts(scene);

    const switchMap = (id: number) => {
        if (editor.get().dirty && !window.confirm("Hay cambios sin guardar en este mapa. ¿Cambiar de mapa igual?")) return;
        void editor.open(id);
    };

    const statusColor = { idle: "text-white/40", info: "text-sky-200", saving: "text-amber-200", saved: "text-emerald-300", error: "text-rose-300" }[status.kind];

    return (
        <div className="flex h-screen flex-col bg-[#0e1016] text-white">
            <header className="flex items-center gap-3 border-b border-white/10 bg-[#14161d] px-3 py-2">
                <span className="font-semibold tracking-wide text-amber-100">Editor de mapas</span>
                <select
                    value={mapId ?? ""}
                    onChange={(e) => switchMap(Number(e.target.value))}
                    className="w-72 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-sm"
                >
                    {mapId && !maps.some((m) => m.id === mapId) && <option value={mapId}>{mapId} · nuevo (sin guardar)</option>}
                    {maps.map((m) => (
                        <option key={m.id} value={m.id}>
                            {m.id} · {m.name}
                        </option>
                    ))}
                </select>
                <button type="button" onClick={() => setCreating(true)} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-white/70 hover:bg-white/10">
                    <FilePlus2 size={16} /> Nuevo
                </button>
                <div className="mx-1 h-5 w-px bg-white/10" />
                <button
                    type="button"
                    onClick={() => editor.undo()}
                    disabled={!canUndo}
                    title={undoLabel ? `Deshacer: ${undoLabel} (Ctrl+Z)` : "Deshacer (Ctrl+Z)"}
                    className="rounded-md p-1.5 text-white/70 hover:bg-white/10 disabled:opacity-30"
                >
                    <Undo2 size={17} />
                </button>
                <button
                    type="button"
                    onClick={() => editor.redo()}
                    disabled={!canRedo}
                    title={redoLabel ? `Rehacer: ${redoLabel} (Ctrl+Y)` : "Rehacer (Ctrl+Y)"}
                    className="rounded-md p-1.5 text-white/70 hover:bg-white/10 disabled:opacity-30"
                >
                    <Redo2 size={17} />
                </button>
                <button
                    type="button"
                    onClick={() => void editor.save()}
                    disabled={!mapId}
                    title="Guardar (Ctrl+S)"
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-semibold ${dirty ? "bg-amber-400 text-black hover:bg-amber-300" : "bg-white/5 text-white/50"}`}
                >
                    <Save size={15} /> Guardar
                </button>
                <span className={`min-w-0 flex-1 truncate text-xs ${statusColor}`}>{status.text || (dirty ? "Cambios sin guardar" : loading ? "" : "Todo guardado")}</span>
                <div className="flex items-center gap-1 text-xs text-white/60">
                    <button type="button" onClick={() => scene?.zoomAt(0.8)} className="rounded p-1 hover:bg-white/10" title="Alejar (−)">
                        <Minus size={14} />
                    </button>
                    <button type="button" onClick={() => scene?.setZoom(1)} className="w-12 rounded py-0.5 tabular-nums hover:bg-white/10" title="Tamaño real (0)">
                        {Math.round(zoom * 100)}%
                    </button>
                    <button type="button" onClick={() => scene?.zoomAt(1.25)} className="rounded p-1 hover:bg-white/10" title="Acercar (+)">
                        <Plus size={14} />
                    </button>
                </div>
            </header>

            <div className="flex min-h-0 flex-1">
                <aside className="border-r border-white/10 bg-[#14161d]">
                    <Toolbar />
                </aside>
                <main className="relative min-w-0 flex-1">
                    <div ref={hostRef} className="absolute inset-0" />
                    {loading && <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-white/70">Cargando mapa…</div>}
                </main>
                <aside className="flex w-[330px] shrink-0 flex-col overflow-y-auto border-l border-white/10 bg-[#14161d]">
                    <LayersPanel />
                    <ToolOptions npcs={dbs.npcs} objects={dbs.objects} />
                    <div className="flex h-[360px] shrink-0 flex-col border-b border-white/10">
                        <Palette />
                    </div>
                    <Section title="Minimapa">
                        <Minimap scene={scene} />
                    </Section>
                    <MetaPanel />
                </aside>
            </div>

            <footer className="flex items-center gap-4 border-t border-white/10 bg-[#14161d] px-3 py-1.5 text-xs">
                <TileInfo npcs={dbs.npcs} objects={dbs.objects} />
                <span className="ml-auto shrink-0 text-white/30">Espacio o clic derecho: mover · Rueda: zoom · 1–4: capa · [ ]: tamaño · Ctrl+Z / Ctrl+S</span>
            </footer>

            {creating && <NewMapDialog onClose={() => setCreating(false)} />}
        </div>
    );
}
