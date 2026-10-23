"use client";

import { useMemo, useState, type ReactNode } from "react";
import { TRIGGERS, type MapMeta } from "@aoturnos/game-core";
import {
    Brush,
    DoorOpen,
    Eraser,
    Eye,
    EyeOff,
    Gem,
    Hand,
    PaintBucket,
    Pipette,
    RectangleHorizontal,
    ShieldBan,
    Tags,
    UserRound,
} from "lucide-react";
import type { NPCsDB, ObjectsDB } from "../../types/game";
import { editor, useEditor, type EditorState, type ToolId } from "./editorStore";
import { TRIGGER_COLORS } from "./EditorScene";
import { GraphicThumb, useGraphicsDB } from "./GraphicThumb";
import { SIZED_TOOLS, TOOL_LABEL } from "./tools";

/* ------------------------------ Herramientas ------------------------------ */

const TOOLS: Array<{ id: ToolId; key: string; Icon: typeof Brush; hint: string }> = [
    { id: "brush", key: "B", Icon: Brush, hint: "Pinta el gráfico elegido (o el sello copiado) en la capa activa" },
    { id: "eraser", key: "E", Icon: Eraser, hint: "Borra la capa activa" },
    { id: "fill", key: "G", Icon: PaintBucket, hint: "Rellena la zona conectada que tiene el mismo gráfico" },
    { id: "rect", key: "R", Icon: RectangleHorizontal, hint: "Arrastrá para rellenar un rectángulo" },
    { id: "picker", key: "I", Icon: Pipette, hint: "Clic: toma un gráfico. Arrastre: copia ese pedazo de mapa como sello" },
    { id: "block", key: "X", Icon: ShieldBan, hint: "Bloquea casillas; empezando sobre una bloqueada, desbloquea" },
    { id: "trigger", key: "T", Icon: Tags, hint: "Pinta el trigger elegido; empezando sobre uno igual, lo quita" },
    { id: "exit", key: "S", Icon: DoorOpen, hint: "Arrastrá para crear salidas a otro mapa; sobre una salida, las quita" },
    { id: "npc", key: "N", Icon: UserRound, hint: "Ubica el NPC elegido; clic sobre un NPC lo quita" },
    { id: "object", key: "O", Icon: Gem, hint: "Tira el objeto elegido; clic sobre un objeto lo quita" },
    { id: "pan", key: "H", Icon: Hand, hint: "Mover el mapa (también: espacio, rueda del mouse o clic derecho)" },
];

export const TOOL_KEYS: Record<string, ToolId> = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.id]));

export function Toolbar() {
    const tool = useEditor((s) => s.tool);
    return (
        <div className="flex flex-col gap-1 p-1.5">
            {TOOLS.map(({ id, key, Icon, hint }) => (
                <button
                    key={id}
                    type="button"
                    onClick={() => editor.set({ tool: id })}
                    title={`${TOOL_LABEL[id]} (${key}): ${hint}`}
                    className={`relative flex h-10 w-10 items-center justify-center rounded-lg transition ${
                        tool === id ? "bg-amber-400/25 text-amber-100 shadow-[inset_0_0_0_1px_rgba(245,197,106,0.7)]" : "text-white/60 hover:bg-white/10 hover:text-white"
                    }`}
                >
                    <Icon size={19} strokeWidth={1.8} />
                    <span className="absolute bottom-0.5 right-1 text-[8px] font-bold text-white/35">{key}</span>
                </button>
            ))}
        </div>
    );
}

/* ------------------------------ Secciones ------------------------------ */

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
    return (
        <section className="border-b border-white/10 px-3 py-2.5">
            <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-200/70">{title}</h3>
                {right}
            </div>
            {children}
        </section>
    );
}

const LAYER_NAMES = ["Piso", "Detalles del piso", "Árboles y objetos", "Techos"];

export function LayersPanel() {
    const layer = useEditor((s) => s.layer);
    const show = useEditor((s) => s.show);
    const toggle = (key: keyof Omit<EditorState["show"], "layers">) => editor.set({ show: { ...show, [key]: !show[key] } });
    const toggleLayer = (l: number) => {
        const layers = [...show.layers] as EditorState["show"]["layers"];
        layers[l] = !layers[l];
        editor.set({ show: { ...show, layers } });
    };

    return (
        <Section title="Capas">
            <div className="space-y-1">
                {LAYER_NAMES.map((name, l) => (
                    <div
                        key={l}
                        className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs ${layer === l ? "bg-amber-400/15 text-amber-50" : "text-white/70 hover:bg-white/5"}`}
                    >
                        <button type="button" onClick={() => editor.set({ layer: l })} className="flex flex-1 items-center gap-2 text-left">
                            <span className={`flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold ${layer === l ? "bg-amber-300 text-black" : "bg-white/10"}`}>{l + 1}</span>
                            {name}
                        </button>
                        <button type="button" onClick={() => toggleLayer(l)} title={show.layers[l] ? "Ocultar capa" : "Mostrar capa"} className="text-white/50 hover:text-white">
                            {show.layers[l] ? <Eye size={14} /> : <EyeOff size={14} />}
                        </button>
                    </div>
                ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
                {(
                    [
                        ["grid", "Grilla"],
                        ["blocked", "Bloqueos"],
                        ["triggers", "Triggers"],
                        ["exits", "Salidas"],
                        ["npcs", "NPCs"],
                        ["objects", "Objetos"],
                        ["ghostRoofs", "Techos translúcidos"],
                    ] as const
                ).map(([key, label]) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => toggle(key)}
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${show[key] ? "border-amber-300/50 bg-amber-400/10 text-amber-100" : "border-white/10 text-white/40"}`}
                    >
                        {label}
                    </button>
                ))}
            </div>
        </Section>
    );
}

/* --------------------------- Opciones de herramienta --------------------------- */

function SearchList<T extends { id: number; name: string }>({
    items,
    selected,
    onPick,
    placeholder,
}: {
    items: T[];
    selected: number;
    onPick: (id: number) => void;
    placeholder: string;
}) {
    const [query, setQuery] = useState("");
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = q ? items.filter((i) => i.name.toLowerCase().includes(q) || String(i.id) === q) : items;
        return list.slice(0, 80);
    }, [items, query]);
    return (
        <div>
            <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder}
                className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs outline-none focus:border-amber-300/50"
            />
            <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-white/5">
                {filtered.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => onPick(item.id)}
                        className={`flex w-full justify-between gap-2 px-2 py-0.5 text-left text-xs ${item.id === selected ? "bg-amber-400/20 text-amber-50" : "text-white/70 hover:bg-white/5"}`}
                    >
                        <span className="truncate">{item.name}</span>
                        <span className="shrink-0 tabular-nums text-white/35">{item.id}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

const numberOrNull = (value: string): number | null => (value.trim() === "" ? null : Number.parseInt(value, 10) || 0);

export function ToolOptions({ npcs, objects }: { npcs: NPCsDB; objects: ObjectsDB }) {
    // Campo por campo: así mover el mouse por el mapa (que cambia hover) no redibuja estas listas.
    const state = {
        tool: useEditor((s) => s.tool),
        stamp: useEditor((s) => s.stamp),
        grh: useEditor((s) => s.grh),
        layer: useEditor((s) => s.layer),
        brushSize: useEditor((s) => s.brushSize),
        trigger: useEditor((s) => s.trigger),
        exit: useEditor((s) => s.exit),
        npcIndex: useEditor((s) => s.npcIndex),
        object: useEditor((s) => s.object),
        maps: useEditor((s) => s.maps),
    };
    const db = useGraphicsDB();
    const npcList = useMemo(() => Object.entries(npcs).map(([id, n]) => ({ id: Number(id), name: n.name })), [npcs]);
    const objectList = useMemo(() => Object.entries(objects).map(([id, o]) => ({ id: Number(id), name: o.name })), [objects]);
    const maps = state.maps;

    const sizes = SIZED_TOOLS.includes(state.tool) && (
        <div className="flex items-center gap-1">
            <span className="mr-1 text-[11px] text-white/50">Tamaño</span>
            {[1, 2, 3, 5, 9].map((n) => (
                <button
                    key={n}
                    type="button"
                    onClick={() => editor.set({ brushSize: n })}
                    className={`h-6 w-7 rounded text-[11px] ${state.brushSize === n ? "bg-amber-300 text-black" : "bg-white/5 text-white/70 hover:bg-white/10"}`}
                >
                    {n}
                </button>
            ))}
            <span className="ml-1 text-[10px] text-white/30">[ ]</span>
        </div>
    );

    let body: ReactNode = null;
    switch (state.tool) {
        case "brush":
        case "rect":
        case "fill":
            body = state.stamp ? (
                <p className="text-xs text-amber-100/80">
                    Sello de {state.stamp.width}×{state.stamp.height} con todas sus capas y bloqueos.
                </p>
            ) : state.grh && db ? (
                <div className="flex items-center gap-2 text-xs text-white/70">
                    <span className="rounded-md bg-black/50 p-1">
                        <GraphicThumb db={db} grh={state.grh} size={36} />
                    </span>
                    Gráfico {state.grh} en la capa {state.layer + 1}
                </div>
            ) : (
                <p className="text-xs text-white/45">Elegí un gráfico de la paleta.</p>
            );
            break;
        case "trigger":
            body = (
                <div className="grid grid-cols-2 gap-1">
                    {Object.entries(TRIGGERS).map(([id, name]) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => editor.set({ trigger: Number(id) })}
                            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] ${state.trigger === Number(id) ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/5"}`}
                        >
                            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: `#${(TRIGGER_COLORS[Number(id)] ?? 0xffffff).toString(16).padStart(6, "0")}` }} />
                            {id}. {name}
                        </button>
                    ))}
                </div>
            );
            break;
        case "exit":
            body = (
                <div className="space-y-1.5 text-xs">
                    <label className="flex items-center gap-2">
                        <span className="w-14 text-white/50">Mapa</span>
                        <select
                            value={state.exit.map}
                            onChange={(e) => editor.set({ exit: { ...state.exit, map: Number(e.target.value) } })}
                            className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-1 py-1"
                        >
                            {maps.map((m) => (
                                <option key={m.id} value={m.id}>
                                    {m.id} · {m.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    {(["x", "y"] as const).map((axis) => (
                        <label key={axis} className="flex items-center gap-2">
                            <span className="w-14 uppercase text-white/50">{axis}</span>
                            <input
                                value={state.exit[axis] ?? ""}
                                onChange={(e) => editor.set({ exit: { ...state.exit, [axis]: numberOrNull(e.target.value) } })}
                                placeholder="igual que el origen"
                                inputMode="numeric"
                                className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 outline-none focus:border-amber-300/50"
                            />
                        </label>
                    ))}
                    <p className="text-[11px] leading-snug text-white/40">
                        Dejá X o Y vacío para copiar la columna o la fila de cada casilla: así un borde entero del mapa lleva al borde del mapa vecino.
                    </p>
                </div>
            );
            break;
        case "npc":
            body = <SearchList items={npcList} selected={state.npcIndex} onPick={(id) => editor.set({ npcIndex: id })} placeholder="Buscar NPC por nombre o número" />;
            break;
        case "object":
            body = (
                <div className="space-y-1.5">
                    <SearchList
                        items={objectList}
                        selected={state.object.objIndex}
                        onPick={(id) => editor.set({ object: { ...state.object, objIndex: id } })}
                        placeholder="Buscar objeto por nombre o número"
                    />
                    <label className="flex items-center gap-2 text-xs">
                        <span className="text-white/50">Cantidad</span>
                        <input
                            type="number"
                            min={1}
                            value={state.object.amount}
                            onChange={(e) => editor.set({ object: { ...state.object, amount: Math.max(1, Number(e.target.value) || 1) } })}
                            className="w-20 rounded-md border border-white/10 bg-black/40 px-2 py-1"
                        />
                    </label>
                </div>
            );
            break;
        case "eraser":
            body = <p className="text-xs text-white/45">Borra la capa {state.layer + 1}. Para otra capa, elegila arriba o con las teclas 1 a 4.</p>;
            break;
        case "picker":
            body = <p className="text-xs leading-snug text-white/45">Clic para tomar un gráfico. Arrastrá sobre una casa, un árbol o un camino para copiarlo entero y pintarlo en otro lado.</p>;
            break;
        case "block":
            body = <p className="text-xs text-white/45">Empezá sobre una casilla libre para bloquear, o sobre una bloqueada para desbloquear.</p>;
            break;
        case "pan":
            body = <p className="text-xs text-white/45">Arrastrá para moverte. La rueda acerca y aleja.</p>;
            break;
    }

    return (
        <Section title={TOOL_LABEL[state.tool]}>
            <div className="space-y-2">
                {sizes}
                {body}
            </div>
        </Section>
    );
}

/* ------------------------------ Propiedades ------------------------------ */

const ZONES = ["CIUDAD", "CAMPO", "DUNGEON", "MAR"];
const TERRAINS = ["BOSQUE", "DESIERTO", "NIEVE", "CIUDAD", "DUNGEON"];

export function MetaPanel() {
    useEditor((s) => s.revision);
    const meta = editor.doc?.meta;
    const [open, setOpen] = useState(false);
    if (!meta) return null;
    const field = (label: string, input: ReactNode) => (
        <label className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 text-white/50">{label}</span>
            {input}
        </label>
    );
    const cls = "min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 outline-none focus:border-amber-300/50";
    const num = (key: keyof MapMeta) => (
        <input
            type="number"
            key={`${meta.id}:${key}:${String(meta[key])}`}
            defaultValue={Number(meta[key] ?? 0)}
            onBlur={(e) => editor.setMeta({ [key]: Number(e.target.value) || 0 })}
            className={cls}
        />
    );

    return (
        <Section
            title="Propiedades del mapa"
            right={
                <button type="button" onClick={() => setOpen((v) => !v)} className="text-[11px] text-white/50 hover:text-white">
                    {open ? "Cerrar" : "Editar"}
                </button>
            }
        >
            {!open ? (
                <p className="text-xs text-white/60">
                    {meta.name} · {meta.zona || "sin zona"} · {meta.pk ? "seguro" : "inseguro"}
                </p>
            ) : (
                <div className="space-y-1.5">
                    {field("Nombre", <input key={`${meta.id}:name:${meta.name}`} defaultValue={meta.name} onBlur={(e) => editor.setMeta({ name: e.target.value.trim() || meta.name })} className={cls} />)}
                    {field(
                        "Zona",
                        <select value={meta.zona} onChange={(e) => editor.setMeta({ zona: e.target.value })} className={cls}>
                            {[...new Set([meta.zona, ...ZONES])].filter(Boolean).map((z) => (
                                <option key={z}>{z}</option>
                            ))}
                        </select>,
                    )}
                    {field(
                        "Terreno",
                        <select value={meta.terreno} onChange={(e) => editor.setMeta({ terreno: e.target.value })} className={cls}>
                            {[...new Set([meta.terreno, ...TERRAINS])].filter(Boolean).map((z) => (
                                <option key={z}>{z}</option>
                            ))}
                        </select>,
                    )}
                    {field("Música", num("musicNum"))}
                    {field("Nivel mínimo", num("minLevel"))}
                    {field("Nivel máximo", num("maxLevel"))}
                    {field(
                        "Seguro",
                        <input type="checkbox" checked={meta.pk === 1} onChange={(e) => editor.setMeta({ pk: e.target.checked ? 1 : 0 })} title="Mapa seguro: no se puede atacar a otros jugadores" />,
                    )}
                    {field("Sin magia", <input type="checkbox" checked={meta.magiaSinEfecto === 1} onChange={(e) => editor.setMeta({ magiaSinEfecto: e.target.checked ? 1 : 0 })} />)}
                </div>
            )}
        </Section>
    );
}

/* ------------------------------ Mapa nuevo ------------------------------ */

export function NewMapDialog({ onClose }: { onClose: () => void }) {
    const nextFreeId = useEditor((s) => s.nextFreeId);
    const maps = useEditor((s) => s.maps);
    const reserved = useEditor((s) => s.reserved);
    const grh = useEditor((s) => s.grh);
    const db = useGraphicsDB();
    const [id, setId] = useState(nextFreeId ?? 291);
    const [name, setName] = useState("");
    const [size, setSize] = useState(100);
    const [floor, setFloor] = useState(grh || 0);
    const taken = maps.some((m) => m.id === id) || reserved.includes(id);

    const create = () => {
        editor.create({ id, name: name.trim() || `Mapa ${id}` } as MapMeta, size, size, floor);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
            <div className="w-96 rounded-2xl border border-white/15 bg-[#14161d] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-lg font-semibold text-amber-100">Mapa nuevo</h2>
                <div className="mt-4 space-y-2.5 text-sm">
                    <label className="flex items-center gap-3">
                        <span className="w-20 text-white/60">Número</span>
                        <input type="number" value={id} onChange={(e) => setId(Number(e.target.value))} className="w-24 rounded-md border border-white/10 bg-black/40 px-2 py-1" />
                        {taken && <span className="text-xs text-rose-300">ese número ya está en uso</span>}
                    </label>
                    <label className="flex items-center gap-3">
                        <span className="w-20 text-white/60">Nombre</span>
                        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Mapa ${id}`} className="flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1" />
                    </label>
                    <label className="flex items-center gap-3">
                        <span className="w-20 text-white/60">Tamaño</span>
                        <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="rounded-md border border-white/10 bg-black/40 px-2 py-1">
                            {[50, 75, 100].map((n) => (
                                <option key={n} value={n}>
                                    {n} × {n}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="flex items-center gap-3">
                        <span className="w-20 text-white/60">Piso</span>
                        <input type="number" value={floor} onChange={(e) => setFloor(Number(e.target.value))} className="w-24 rounded-md border border-white/10 bg-black/40 px-2 py-1" />
                        {db && floor > 0 && <GraphicThumb db={db} grh={floor} size={32} />}
                    </label>
                    <p className="text-xs leading-snug text-white/40">
                        El piso arranca con el gráfico elegido en la paleta. El borde queda bloqueado. El mapa existe recién cuando lo guardás.
                    </p>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                    <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-white/60 hover:bg-white/5">
                        Cancelar
                    </button>
                    <button type="button" onClick={create} disabled={id < 1 || id > 499 || taken} className="rounded-lg bg-amber-400 px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-40">
                        Crear
                    </button>
                </div>
            </div>
        </div>
    );
}

/* ------------------------------ Barra de estado ------------------------------ */

export function TileInfo({ npcs, objects }: { npcs: NPCsDB; objects: ObjectsDB }) {
    const hover = useEditor((s) => s.hover);
    useEditor((s) => s.revision);
    const doc = editor.doc;
    if (!doc || !hover || !doc.contains(hover.x, hover.y)) return <span className="text-white/35">Pasá el mouse por el mapa</span>;
    const t = doc.tile(doc.index(hover.x, hover.y));
    const npc = doc.npcAt(hover.x, hover.y);
    const exit = t.exit?.[0];
    return (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <b className="tabular-nums text-amber-100">
                {hover.x}, {hover.y}
            </b>
            <span className="tabular-nums text-white/60">
                capas {t.layers.map((g) => g || "·").join(" / ")}
            </span>
            {t.blocked && <span className="text-rose-300">bloqueada</span>}
            {t.trigger > 0 && <span className="text-violet-200">trigger {t.trigger}: {TRIGGERS[t.trigger] ?? "?"}</span>}
            {exit && (
                <span className="text-cyan-200">
                    salida → mapa {exit.map} ({exit.x}, {exit.y})
                </span>
            )}
            {npc && <span className="text-amber-200">NPC {npcs[String(npc.npcIndex)]?.name ?? `#${npc.npcIndex}`}</span>}
            {t.object && (
                <span className="text-emerald-200">
                    {objects[String(t.object.objIndex)]?.name ?? `objeto ${t.object.objIndex}`} ×{t.object.amount}
                </span>
            )}
        </span>
    );
}
