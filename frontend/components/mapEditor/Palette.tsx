"use client";

import { useEffect, useMemo, useState } from "react";
import type { GraphicsDB } from "../../types/game";
import { editor, useEditor } from "./editorStore";
import { GraphicThumb, staticFrame, useGraphicsDB } from "./GraphicThumb";

type Tab = "map" | "world" | "sheets" | "recent";

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
    { id: "map", label: "Este mapa", hint: "Gráficos que ya usa este mapa en la capa activa" },
    { id: "world", label: "Mundo", hint: "Los más usados en todos los mapas para la capa activa" },
    { id: "sheets", label: "Hojas", hint: "Todos los gráficos, agrupados por archivo de imagen" },
    { id: "recent", label: "Recientes", hint: "Los últimos que elegiste" },
];

const PAGE = 120;

let worldPromise: Promise<Array<Array<[number, number]>>> | null = null;

function useWorldUsage(): Array<Array<[number, number]>> | null {
    const [usage, setUsage] = useState<Array<Array<[number, number]>> | null>(null);
    useEffect(() => {
        let alive = true;
        worldPromise ??= fetch("/api/editor/catalog")
            .then((r) => r.json())
            .then((body: { layers: Array<Array<[number, number]>> }) => body.layers);
        void worldPromise.then((layers) => alive && setUsage(layers)).catch(() => undefined);
        return () => {
            alive = false;
        };
    }, []);
    return usage;
}

/** Gráficos de cada hoja de imagen, en el orden en que aparecen en ella (de arriba abajo). */
function sheetIndex(db: GraphicsDB): Array<{ file: string; grhs: number[] }> {
    const sheets = new Map<string, Array<{ grh: number; sY: number; sX: number }>>();
    for (const [id, data] of Object.entries(db)) {
        const grh = Number(id);
        if (!Number.isInteger(grh) || grh <= 0) continue;
        const frame = staticFrame(db, grh);
        if (!frame || !data) continue;
        const list = sheets.get(frame.numFile) ?? [];
        list.push({ grh, sY: frame.sY, sX: frame.sX });
        sheets.set(frame.numFile, list);
    }
    return [...sheets.entries()]
        .map(([file, list]) => ({ file, grhs: list.sort((a, b) => a.sY - b.sY || a.sX - b.sX || a.grh - b.grh).map((g) => g.grh) }))
        .sort((a, b) => Number(a.file) - Number(b.file));
}

export function Palette() {
    const db = useGraphicsDB();
    const world = useWorldUsage();
    const layer = useEditor((s) => s.layer);
    const selected = useEditor((s) => s.grh);
    const recent = useEditor((s) => s.recent);
    const revision = useEditor((s) => s.revision);
    const hasStamp = useEditor((s) => Boolean(s.stamp));
    const [tab, setTab] = useState<Tab>("map");
    const [query, setQuery] = useState("");
    const [sheet, setSheet] = useState<string | null>(null);
    const [limit, setLimit] = useState(PAGE);

    const sheets = useMemo(() => (db ? sheetIndex(db) : []), [db]);

    // Lo usado por el mapa cambia al pintar; se recalcula con cada revisión del documento.
    const mapUsage = useMemo(() => {
        void revision;
        return editor.doc?.usedGraphics(layer) ?? [];
    }, [layer, revision]);

    const items: Array<{ grh: number; count?: number }> = useMemo(() => {
        const number = Number.parseInt(query, 10);
        if (query.trim() && Number.isInteger(number)) {
            // Buscar por número: el exacto primero y después los que empiezan igual.
            const pool = tab === "world" && world ? world[layer].map(([grh, count]) => ({ grh, count })) : Object.keys(db ?? {}).map((k) => ({ grh: Number(k) }));
            const prefix = pool.filter((g) => String(g.grh).startsWith(query.trim()) && db?.[String(g.grh)]);
            return prefix.sort((a, b) => (a.grh === number ? -1 : b.grh === number ? 1 : a.grh - b.grh));
        }
        switch (tab) {
            case "map":
                return mapUsage;
            case "world":
                return (world?.[layer] ?? []).map(([grh, count]) => ({ grh, count }));
            case "sheets":
                return (sheets.find((s) => s.file === sheet)?.grhs ?? []).map((grh) => ({ grh }));
            case "recent":
                return recent.map((grh) => ({ grh }));
        }
    }, [query, tab, world, layer, db, mapUsage, sheets, sheet, recent]);

    useEffect(() => setLimit(PAGE), [tab, query, sheet, layer]);

    if (!db) return <div className="p-3 text-xs text-white/50">Cargando gráficos…</div>;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex gap-1 px-2 pt-2">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        title={t.hint}
                        onClick={() => setTab(t.id)}
                        className={`flex-1 rounded-md px-1.5 py-1 text-[11px] font-semibold ${tab === t.id ? "bg-amber-400/20 text-amber-100" : "text-white/55 hover:bg-white/5"}`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            <div className="flex items-center gap-2 px-2 py-2">
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value.replace(/\D/g, ""))}
                    placeholder="Buscar gráfico por número"
                    inputMode="numeric"
                    className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs outline-none focus:border-amber-300/50"
                />
                {tab === "sheets" && !query && (
                    <select
                        value={sheet ?? ""}
                        onChange={(e) => setSheet(e.target.value || null)}
                        className="w-28 rounded-md border border-white/10 bg-black/40 px-1 py-1 text-xs"
                    >
                        <option value="">Elegí hoja…</option>
                        {sheets.map((s) => (
                            <option key={s.file} value={s.file}>
                                {s.file}.png · {s.grhs.length}
                            </option>
                        ))}
                    </select>
                )}
            </div>
            {hasStamp && (
                <div className="mx-2 mb-2 flex items-center justify-between rounded-md border border-amber-300/30 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-100">
                    Pintando con un sello copiado
                    <button type="button" onClick={() => editor.set({ stamp: null })} className="underline">
                        Soltar (Esc)
                    </button>
                </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {items.length === 0 ? (
                    <p className="px-1 py-6 text-center text-xs leading-relaxed text-white/40">
                        {tab === "map"
                            ? `La capa ${layer + 1} de este mapa está vacía. Probá con la pestaña Mundo.`
                            : tab === "sheets"
                              ? "Elegí una hoja de imagen."
                              : tab === "recent"
                                ? "Todavía no elegiste gráficos."
                                : "Sin resultados."}
                    </p>
                ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1">
                        {items.slice(0, limit).map(({ grh, count }) => (
                            <button
                                key={grh}
                                type="button"
                                onClick={() => editor.pickGraphic(grh)}
                                title={`Gráfico ${grh}${count ? ` · ${count} baldosas` : ""}`}
                                className={`flex flex-col items-center rounded-md border p-0.5 ${
                                    grh === selected && !hasStamp ? "border-amber-300 bg-amber-400/15" : "border-transparent hover:border-white/20 hover:bg-white/5"
                                }`}
                            >
                                <GraphicThumb db={db} grh={grh} />
                                <span className="text-[9px] tabular-nums text-white/45">{grh}</span>
                            </button>
                        ))}
                    </div>
                )}
                {items.length > limit && (
                    <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="mt-2 w-full rounded-md bg-white/5 py-1 text-xs text-white/60 hover:bg-white/10">
                        Ver más ({items.length - limit})
                    </button>
                )}
            </div>
        </div>
    );
}
