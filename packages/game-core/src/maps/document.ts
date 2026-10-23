import {
    exitDestinations,
    graphicsToLayers,
    layersToGraphics,
    MAP_LAYERS,
    parseTileKey,
    type MapMeta,
    type MapSource,
    type NpcPlacement,
    type ObjectDrop,
    type TerrainFile,
    type TileExit,
} from "./format";

export type Layers = [number, number, number, number];

/** Todo lo que se puede editar en una baldosa. Los NPCs van aparte porque pueden moverse por el mapa. */
export type TileState = {
    layers: Layers;
    blocked: boolean;
    /** 0 = sin trigger. */
    trigger: number;
    exit: TileExit[] | null;
    object: ObjectDrop | null;
};

/**
 * Un mapa abierto en el editor. Guarda cada capa en un arreglo tipado (índice y * width + x, base 0)
 * para que pintar, rellenar y redibujar sean baratos aun en mapas de 100 × 100.
 * Las coordenadas públicas son las del juego: x e y empiezan en 1.
 */
export class MapDocument {
    readonly layers: Int32Array[];
    readonly blocked: Uint8Array;
    readonly trigger: Uint16Array;
    readonly exits = new Map<number, TileExit[]>();
    readonly objects = new Map<number, ObjectDrop>();
    npcs: NpcPlacement[] = [];
    /** NPCs que venían en specials.json desde el .map original: el server ya no los usa, se conservan tal cual. */
    legacyNpcs: Record<string, number> = {};
    /** Ids de paleta del archivo original, para que guardar sin cambios no renumere todo el terreno. */
    private paletteIds = new Map<string, number>();

    constructor(
        public meta: MapMeta,
        readonly width: number,
        readonly height: number,
    ) {
        const size = width * height;
        this.layers = Array.from({ length: MAP_LAYERS }, () => new Int32Array(size));
        this.blocked = new Uint8Array(size);
        this.trigger = new Uint16Array(size);
    }

    get id(): number {
        return this.meta.id;
    }

    get size(): number {
        return this.width * this.height;
    }

    /** Mapa nuevo con todo el piso cubierto por `floor` y un borde bloqueado para que nadie se caiga del mundo. */
    static blank(meta: MapMeta, width = 100, height = 100, floor = 0): MapDocument {
        const doc = new MapDocument(meta, width, height);
        doc.layers[0].fill(floor);
        for (let i = 0; i < doc.size; i++) {
            const { x, y } = doc.coords(i);
            if (x === 1 || y === 1 || x === width || y === height) doc.blocked[i] = 1;
        }
        return doc;
    }

    static fromSource(source: MapSource): MapDocument {
        const { terrain, specials } = source;
        const doc = new MapDocument({ ...source.meta }, terrain.width, terrain.height);

        for (let y = 1; y <= doc.height; y++) {
            const row = terrain.rows[y - 1] ?? [];
            for (let x = 1; x <= doc.width; x++) {
                const entry = terrain.palette[String(row[x - 1] ?? 0)];
                if (!entry) continue;
                const i = doc.index(x, y);
                const layers = graphicsToLayers(entry.graphics);
                for (let l = 0; l < MAP_LAYERS; l++) doc.layers[l][i] = layers[l];
                if (entry.blocked) doc.blocked[i] = 1;
                const signature = paletteSignature(layers, Boolean(entry.blocked));
                if (!doc.paletteIds.has(signature)) doc.paletteIds.set(signature, Number(row[x - 1]));
            }
        }

        const each = <T>(record: Record<string, T> | undefined, fn: (i: number, value: T) => void) => {
            for (const [key, value] of Object.entries(record ?? {})) {
                const at = parseTileKey(key);
                if (at && doc.contains(at.x, at.y)) fn(doc.index(at.x, at.y), value);
            }
        };
        each(specials.exits, (i, raw) => {
            const destinations = exitDestinations(raw);
            if (destinations.length > 0) doc.exits.set(i, destinations);
        });
        each(specials.objects, (i, obj) => doc.objects.set(i, { objIndex: Number(obj.objIndex), amount: Number(obj.amount) }));
        each(specials.triggers, (i, trigger) => (doc.trigger[i] = Number(trigger) || 0));
        doc.legacyNpcs = { ...(specials.npcs ?? {}) };
        doc.npcs = source.npcs.filter((n) => doc.contains(n.x, n.y)).map((n) => ({ ...n, mapNum: doc.id }));
        return doc;
    }

    /** Vuelve a armar los cuatro archivos. La paleta se reconstruye solo con las combinaciones usadas. */
    toSource(): MapSource {
        const palette: TerrainFile["palette"] = {};
        const paletteIds = new Map<string, number>();
        let nextId = Math.max(0, ...this.paletteIds.values()) + 1;
        const rows: number[][] = [];

        for (let y = 1; y <= this.height; y++) {
            const row: number[] = [];
            for (let x = 1; x <= this.width; x++) {
                const i = this.index(x, y);
                const layers = this.layers.map((layer) => layer[i]);
                const blocked = this.blocked[i] === 1;
                if (!blocked && layers.every((g) => !g)) {
                    row.push(0);
                    continue;
                }
                const signature = paletteSignature(layers, blocked);
                let id = paletteIds.get(signature);
                if (id === undefined) {
                    id = this.paletteIds.get(signature) ?? nextId++;
                    paletteIds.set(signature, id);
                    palette[String(id)] = blocked ? { graphics: layersToGraphics(layers), blocked: true } : { graphics: layersToGraphics(layers) };
                }
                row.push(id);
            }
            rows.push(row);
        }

        const keyOf = (i: number) => {
            const { x, y } = this.coords(i);
            return `${x},${y}`;
        };
        const sorted = <T>(map: Map<number, T>) => [...map.entries()].sort(([a], [b]) => a - b);
        const triggers: Record<string, number> = {};
        for (let i = 0; i < this.size; i++) if (this.trigger[i]) triggers[keyOf(i)] = this.trigger[i];

        return {
            meta: { ...this.meta },
            terrain: { id: this.id, width: this.width, height: this.height, palette, rows },
            specials: {
                id: this.id,
                exits: Object.fromEntries(sorted(this.exits).map(([i, d]) => [keyOf(i), d.length === 1 ? { ...d[0] } : d.map((e) => ({ ...e }))])),
                objects: Object.fromEntries(sorted(this.objects).map(([i, o]) => [keyOf(i), { ...o }])),
                npcs: { ...this.legacyNpcs },
                triggers,
            },
            npcs: [...this.npcs]
                .sort((a, b) => a.y - b.y || a.x - b.x)
                .map((n) => ({ ...n, mapNum: this.id })),
        };
    }

    contains(x: number, y: number): boolean {
        return x >= 1 && y >= 1 && x <= this.width && y <= this.height;
    }

    index(x: number, y: number): number {
        return (y - 1) * this.width + (x - 1);
    }

    coords(i: number): { x: number; y: number } {
        return { x: (i % this.width) + 1, y: Math.floor(i / this.width) + 1 };
    }

    tile(i: number): TileState {
        const exit = this.exits.get(i);
        const object = this.objects.get(i);
        return {
            layers: [this.layers[0][i], this.layers[1][i], this.layers[2][i], this.layers[3][i]],
            blocked: this.blocked[i] === 1,
            trigger: this.trigger[i],
            exit: exit ? exit.map((e) => ({ ...e })) : null,
            object: object ? { ...object } : null,
        };
    }

    setTile(i: number, t: TileState): void {
        for (let l = 0; l < MAP_LAYERS; l++) this.layers[l][i] = t.layers[l];
        this.blocked[i] = t.blocked ? 1 : 0;
        this.trigger[i] = t.trigger;
        if (t.exit && t.exit.length > 0) this.exits.set(i, t.exit.map((e) => ({ ...e })));
        else this.exits.delete(i);
        if (t.object) this.objects.set(i, { ...t.object });
        else this.objects.delete(i);
    }

    npcAt(x: number, y: number): NpcPlacement | undefined {
        return this.npcs.find((n) => n.x === x && n.y === y);
    }

    /** Gráficos distintos que usa cada capa, del más usado al menos usado: la paleta "del mapa". */
    usedGraphics(layer: number): Array<{ grh: number; count: number }> {
        const counts = new Map<number, number>();
        for (const g of this.layers[layer]) if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
        return [...counts.entries()].map(([grh, count]) => ({ grh, count })).sort((a, b) => b.count - a.count || a.grh - b.grh);
    }
}

export function sameTileState(a: TileState, b: TileState): boolean {
    return (
        a.layers.every((g, l) => g === b.layers[l]) &&
        a.blocked === b.blocked &&
        a.trigger === b.trigger &&
        JSON.stringify(a.exit) === JSON.stringify(b.exit) &&
        JSON.stringify(a.object) === JSON.stringify(b.object)
    );
}

function paletteSignature(layers: ArrayLike<number>, blocked: boolean): string {
    return `${Array.from(layers).join(",")}|${blocked ? 1 : 0}`;
}
