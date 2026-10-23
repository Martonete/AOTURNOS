import {
    brushTiles,
    copyStamp,
    floodRegion,
    lineTiles,
    pasteStamp,
    rectBetween,
    singleStamp,
    type EditSession,
    type MapDocument,
    type Point,
    type Rect,
    type Stamp,
    type TileState,
} from "@aoturnos/game-core";
import { editor, type EditorState, type ToolId } from "./editorStore";

/**
 * Un gesto del mouse con una herramienta: empieza con el clic, sigue con cada casilla que pisa
 * y termina al soltar. Todo lo que cambia queda en un solo paso del historial.
 */
export type Stroke = {
    move(p: Point): void;
    end(p: Point): void;
    /** Rectángulo que la escena dibuja mientras se arrastra (rectángulo, cuentagotas, salidas). */
    area(): Rect | null;
};

export const TOOL_LABEL: Record<ToolId, string> = {
    brush: "Pincel",
    eraser: "Borrador",
    fill: "Balde",
    rect: "Rectángulo",
    picker: "Cuentagotas",
    block: "Bloqueo",
    trigger: "Trigger",
    exit: "Salida",
    npc: "NPC",
    object: "Objeto",
    pan: "Mano",
};

/** Herramientas que pintan con el tamaño del pincel. */
export const SIZED_TOOLS: ToolId[] = ["brush", "eraser", "block", "trigger"];

type Ctx = { doc: MapDocument; session: EditSession; state: EditorState };

const notice = (text: string) => editor.set({ status: { kind: "info", text } });

/** El sello que pinta el pincel: el copiado con el cuentagotas o el gráfico elegido en la capa activa. */
function activeStamp(state: EditorState): Stamp | null {
    if (state.stamp) return state.stamp;
    return state.grh > 0 ? singleStamp(state.layer, state.grh) : null;
}

/** Recorre las casillas entre dos posiciones del mouse para que un trazo rápido no deje huecos. */
function trail(apply: (p: Point) => void, start: Point): Pick<Stroke, "move"> {
    let last = start;
    apply(start);
    return {
        move(p) {
            for (const step of lineTiles(last, p).slice(1)) apply(step);
            last = p;
        },
    };
}

function changeArea(ctx: Ctx, tiles: Point[], mutate: (t: TileState, at: Point) => void): void {
    for (const p of tiles) if (ctx.doc.contains(p.x, p.y)) ctx.session.change(ctx.doc.index(p.x, p.y), (t) => mutate(t, p));
}

function tilesOf(rect: Rect): Point[] {
    const out: Point[] = [];
    for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) out.push({ x, y });
    return out;
}

/** Repite el sello en mosaico sobre el rectángulo, alineado con su esquina. */
function tileStamp(ctx: Ctx, stamp: Stamp, rect: Rect): void {
    for (let y = rect.y; y < rect.y + rect.height; y += stamp.height) {
        for (let x = rect.x; x < rect.x + rect.width; x += stamp.width) pasteStamp(ctx.session, stamp, { x, y });
    }
}

const instant = (): Stroke => ({ move() {}, end() {}, area: () => null });

export function startStroke(tool: ToolId, ctx: Ctx, start: Point): Stroke | null {
    const { doc, session, state } = ctx;
    const size = state.brushSize;

    switch (tool) {
        case "brush": {
            const stamp = activeStamp(state);
            if (!stamp) {
                notice("Elegí un gráfico de la paleta (o copiá un pedazo con el cuentagotas) para pintar.");
                return null;
            }
            session.begin(state.stamp ? "Sello" : "Pincel");
            if (stamp.width > 1 || stamp.height > 1) {
                // Un sello grande se pega en mosaico: solo en las casillas alineadas con el primer clic.
                const painted = new Set<string>();
                const paint = (p: Point) => {
                    const x = p.x - ((((p.x - start.x) % stamp.width) + stamp.width) % stamp.width);
                    const y = p.y - ((((p.y - start.y) % stamp.height) + stamp.height) % stamp.height);
                    if (painted.has(`${x},${y}`)) return;
                    painted.add(`${x},${y}`);
                    pasteStamp(session, stamp, { x, y });
                };
                return { ...trail(paint, start), end() {}, area: () => null };
            }
            const paint = (p: Point) => brushTiles(p, size).forEach((t) => doc.contains(t.x, t.y) && pasteStamp(session, stamp, t));
            return { ...trail(paint, start), end() {}, area: () => null };
        }

        case "eraser": {
            session.begin("Borrar");
            const layer = state.layer;
            const paint = (p: Point) => changeArea(ctx, brushTiles(p, size), (t) => (t.layers[layer] = 0));
            return { ...trail(paint, start), end() {}, area: () => null };
        }

        case "fill": {
            if (!doc.contains(start.x, start.y)) return null;
            if (!state.grh) {
                notice("Elegí un gráfico de la paleta para rellenar.");
                return null;
            }
            session.begin("Balde");
            const layer = state.layer;
            const region = floodRegion(doc, layer, start);
            for (const i of region) session.change(i, (t) => (t.layers[layer] = state.grh));
            notice(`Relleno: ${region.length} casillas.`);
            return instant();
        }

        case "rect": {
            const stamp = activeStamp(state);
            if (!stamp) {
                notice("Elegí un gráfico de la paleta para rellenar el rectángulo.");
                return null;
            }
            let rect = rectBetween(start, start);
            return {
                move: (p) => (rect = rectBetween(start, p)),
                end() {
                    session.begin("Rectángulo");
                    tileStamp(ctx, stamp, rect);
                },
                area: () => rect,
            };
        }

        case "picker": {
            let rect = rectBetween(start, start);
            return {
                move: (p) => (rect = rectBetween(start, p)),
                end() {
                    if (rect.width === 1 && rect.height === 1) {
                        if (!doc.contains(start.x, start.y)) return;
                        const layers = doc.tile(doc.index(start.x, start.y)).layers;
                        // Si la capa activa está vacía toma la de más arriba que tenga algo.
                        let layer = state.layer;
                        if (!layers[layer]) layer = [3, 2, 1, 0].find((l) => layers[l]) ?? layer;
                        if (!layers[layer]) return;
                        editor.pickGraphic(layers[layer]);
                        editor.set({ layer });
                        notice(`Gráfico ${layers[layer]} de la capa ${layer + 1}.`);
                        return;
                    }
                    const stamp = copyStamp(doc, rect);
                    editor.set({ stamp, tool: "brush" });
                    notice(`Sello de ${rect.width}×${rect.height} copiado: pintá con él o soltalo con Esc.`);
                },
                area: () => rect,
            };
        }

        case "block": {
            // El primer clic decide: sobre una casilla bloqueada el trazo desbloquea, si no bloquea.
            const unblock = doc.contains(start.x, start.y) && doc.blocked[doc.index(start.x, start.y)] === 1;
            session.begin(unblock ? "Desbloquear" : "Bloquear");
            const paint = (p: Point) => changeArea(ctx, brushTiles(p, size), (t) => (t.blocked = !unblock));
            return { ...trail(paint, start), end() {}, area: () => null };
        }

        case "trigger": {
            const clear = doc.contains(start.x, start.y) && doc.trigger[doc.index(start.x, start.y)] === state.trigger;
            session.begin(clear ? "Quitar trigger" : "Trigger");
            const paint = (p: Point) => changeArea(ctx, brushTiles(p, size), (t) => (t.trigger = clear ? 0 : state.trigger));
            return { ...trail(paint, start), end() {}, area: () => null };
        }

        case "exit": {
            const remove = doc.contains(start.x, start.y) && doc.exits.has(doc.index(start.x, start.y));
            let rect = rectBetween(start, start);
            return {
                move: (p) => (rect = rectBetween(start, p)),
                end() {
                    session.begin(remove ? "Quitar salida" : "Salida");
                    const { map, x, y } = state.exit;
                    // "Igual" en x o y copia la coordenada de cada casilla de origen: así se arma un borde entero de una vez.
                    changeArea(ctx, tilesOf(rect), (t, at) => (t.exit = remove ? null : [{ map, x: x ?? at.x, y: y ?? at.y }]));
                },
                area: () => rect,
            };
        }

        case "npc": {
            if (!doc.contains(start.x, start.y)) return null;
            const existing = doc.npcAt(start.x, start.y);
            if (existing) {
                session.setNpcs(
                    doc.npcs.filter((n) => n !== existing),
                    "Quitar NPC",
                );
                return instant();
            }
            if (!state.npcIndex) {
                notice("Elegí un NPC de la lista para ubicarlo.");
                return null;
            }
            session.setNpcs([...doc.npcs, { mapNum: doc.id, x: start.x, y: start.y, npcIndex: state.npcIndex }], "Ubicar NPC");
            return instant();
        }

        case "object": {
            if (!doc.contains(start.x, start.y)) return null;
            const i = doc.index(start.x, start.y);
            if (doc.objects.has(i)) {
                session.begin("Quitar objeto");
                session.change(i, (t) => (t.object = null));
                return instant();
            }
            if (!state.object.objIndex) {
                notice("Elegí un objeto de la lista para tirarlo en el mapa.");
                return null;
            }
            session.begin("Objeto");
            session.change(i, (t) => (t.object = { ...state.object }));
            return instant();
        }

        case "pan":
            return null;
    }
}
