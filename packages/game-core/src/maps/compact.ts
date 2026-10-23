import { exitDestinations, parseTileKey, type MapSource, type TerrainGraphics } from "./format";

/** Baldosa del formato compacto que descarga el navegador (frontend/public/maps/mapa_N.json). */
type CompactTile = {
    b?: 1;
    g?: TerrainGraphics;
    e?: { m: number; x: number; y: number };
    n?: number;
    t?: number;
    o?: { i: number; a: number };
};

export type CompactMap = { id: number; w: number; h: number; d: number[]; cx?: CompactTile[] };

/**
 * Misma codificación que server/src/scripts/exportFrontendOptimizedMaps.ts, que es lo que entiende
 * decompressMap en el frontend. En d: 0 = vacía, n > 0 = solo capa 1 con el gráfico n,
 * 100000 + n = capa 1 bloqueada, −k = la baldosa compleja cx[k − 1].
 */
export function compactMap(source: MapSource): CompactMap {
    const { terrain, specials } = source;
    const byKey = <T>(record: Record<string, T> | undefined) => {
        const map = new Map<string, T>();
        for (const [key, value] of Object.entries(record ?? {})) {
            const at = parseTileKey(key);
            if (at) map.set(`${at.x},${at.y}`, value);
        }
        return map;
    };
    const exits = byKey(specials.exits);
    const objects = byKey(specials.objects);
    const triggers = byKey(specials.triggers);
    // El export original también mezcla los NPCs de npcs.json sobre los de specials.
    const npcs = byKey(specials.npcs);
    for (const n of source.npcs) npcs.set(`${n.x},${n.y}`, n.npcIndex);

    const complex: CompactTile[] = [];
    const complexIds = new Map<string, number>();
    const d: number[] = [];

    for (let y = 1; y <= terrain.height; y++) {
        for (let x = 1; x <= terrain.width; x++) {
            const key = `${x},${y}`;
            const entry = terrain.palette[String(terrain.rows[y - 1]?.[x - 1] ?? 0)];
            const tile: CompactTile = {};
            if (entry?.blocked) tile.b = 1;
            if (entry?.graphics !== undefined) tile.g = entry.graphics;
            const exit = exitDestinations(exits.get(key))[0];
            if (exit) tile.e = { m: exit.map, x: exit.x, y: exit.y };
            const npc = npcs.get(key);
            if (npc !== undefined) tile.n = Number(npc);
            const trigger = triggers.get(key);
            if (trigger !== undefined) tile.t = Number(trigger);
            const obj = objects.get(key);
            if (obj) tile.o = { i: Number(obj.objIndex), a: Number(obj.amount) };

            const keys = Object.keys(tile);
            if (keys.length === 0) {
                d.push(0);
            } else if (keys.length === 1 && typeof tile.g === "number") {
                d.push(tile.g);
            } else if (keys.length === 2 && tile.b === 1 && typeof tile.g === "number") {
                d.push(100000 + tile.g);
            } else {
                const signature = JSON.stringify(tile);
                let id = complexIds.get(signature);
                if (id === undefined) {
                    id = complex.length;
                    complexIds.set(signature, id);
                    complex.push(tile);
                }
                d.push(-(id + 1));
            }
        }
    }

    return complex.length > 0 ? { id: terrain.id, w: terrain.width, h: terrain.height, d, cx: complex } : { id: terrain.id, w: terrain.width, h: terrain.height, d };
}
