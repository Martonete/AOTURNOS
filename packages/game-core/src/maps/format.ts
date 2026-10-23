/**
 * Formato de los mapas del mundo, tal como viven en server/mapas_source/mapa_N:
 *
 * - meta.json: nombre, música, zona y reglas del mapa.
 * - terrain.json: paleta de baldosas (gráficos de las capas 1 a 4 y bloqueo) y una grilla de ids de paleta.
 * - specials.json: salidas, objetos tirados, triggers y NPCs heredados del .map original.
 * - npcs.json: NPCs que el server hace aparecer (la fuente que usa loadNpcs).
 *
 * El frontend no lee estos archivos: usa la versión compacta de public/maps (ver compact.ts).
 */

export type MapMeta = {
    id: number;
    name: string;
    musicNum: number;
    magiaSinEfecto: number;
    noEncriptarMp: number;
    terreno: string;
    zona: string;
    restringir: string | number;
    minLevel?: number;
    maxLevel: number;
    backup: number;
    pk: number;
};

/** Gráficos por capa: un número es solo la capa 1; en el arreglo, null deja la capa vacía. */
export type TerrainGraphics = number | Array<number | null>;

export type TerrainFile = {
    id: number;
    width: number;
    height: number;
    palette: Record<string, { graphics: TerrainGraphics; blocked?: boolean }>;
    /** rows[y - 1][x - 1] = id de paleta (0 = baldosa vacía). */
    rows: number[][];
};

export type TileExit = { map: number; x: number; y: number };

export type ObjectDrop = { objIndex: number; amount: number };

export type SpecialsFile = {
    id: number;
    /** Clave "x,y". Una salida puede tener varios destinos (el server elige uno). */
    exits: Record<string, TileExit | TileExit[] | { destinations: TileExit[] }>;
    objects: Record<string, ObjectDrop>;
    npcs: Record<string, number>;
    triggers: Record<string, number>;
};

export type NpcPlacement = { mapNum: number; x: number; y: number; npcIndex: number; movement?: number };

/** Los cuatro archivos de un mapa. */
export type MapSource = {
    meta: MapMeta;
    terrain: TerrainFile;
    specials: SpecialsFile;
    npcs: NpcPlacement[];
};

/** Triggers que entiende el server, con el nombre que se muestra en el editor. */
export const TRIGGERS: Record<number, string> = {
    1: "Bajo techo",
    2: "NPCs no pasan",
    3: "Posición inválida",
    4: "Cárcel",
    5: "Anti-piquete",
    6: "Zona de pelea",
    11: "No se puede pescar",
};

export const MAP_LAYERS = 4;

export function defaultMeta(id: number, name = `Mapa ${id}`): MapMeta {
    return {
        id,
        name,
        musicNum: 0,
        magiaSinEfecto: 0,
        noEncriptarMp: 0,
        terreno: "BOSQUE",
        zona: "CAMPO",
        restringir: "No",
        maxLevel: 0,
        backup: 0,
        pk: 0,
    };
}

export function parseTileKey(key: string): { x: number; y: number } | null {
    const [rawX, rawY] = key.split(",");
    const x = Number.parseInt(rawX ?? "", 10);
    const y = Number.parseInt(rawY ?? "", 10);
    return Number.isInteger(x) && Number.isInteger(y) && x >= 1 && y >= 1 ? { x, y } : null;
}

/** Normaliza las tres formas de escribir una salida a una lista de destinos válidos. */
export function exitDestinations(raw: SpecialsFile["exits"][string] | undefined): TileExit[] {
    const list = Array.isArray(raw) ? raw : raw && "destinations" in raw ? raw.destinations : raw ? [raw] : [];
    return list.filter((d) => [d?.map, d?.x, d?.y].every((v) => typeof v === "number" && Number.isFinite(v)));
}

/** Los gráficos de una entrada de paleta como cuatro números (0 = capa vacía). */
export function graphicsToLayers(graphics: TerrainGraphics | undefined): [number, number, number, number] {
    const out: [number, number, number, number] = [0, 0, 0, 0];
    if (typeof graphics === "number") out[0] = graphics;
    else if (Array.isArray(graphics)) for (let i = 0; i < MAP_LAYERS; i++) out[i] = graphics[i] ?? 0;
    return out;
}

/** Lo inverso: recorta las capas vacías del final y usa null en el medio, como los archivos originales. */
export function layersToGraphics(layers: ArrayLike<number>): TerrainGraphics {
    let last = MAP_LAYERS - 1;
    while (last > 0 && !layers[last]) last--;
    if (last === 0) return layers[0];
    return Array.from({ length: last + 1 }, (_, i) => layers[i] || null);
}

const PRINT_WIDTH = 120;

/** Una fila como la escribe prettier (printWidth 120): números en renglones llenos dentro de corchetes. */
function formatRow(row: number[]): string {
    const inline = `        [${row.join(", ")}]`;
    if (inline.length + 1 <= PRINT_WIDTH) return inline;
    const lines: string[] = [];
    let line = "";
    row.forEach((n, k) => {
        const token = k < row.length - 1 ? `${n},` : String(n);
        if (line && 12 + line.length + 1 + token.length > PRINT_WIDTH) {
            lines.push(line);
            line = token;
        } else line = line ? `${line} ${token}` : token;
    });
    lines.push(line);
    return `        [\n${lines.map((l) => `            ${l}`).join("\n")}\n        ]`;
}

/**
 * JSON con el mismo estilo que los archivos existentes: una entrada de paleta por línea y una
 * fila del mapa por línea, para que los diffs en git se puedan leer.
 */
export function formatTerrain(terrain: TerrainFile): string {
    const graphics = (g: TerrainGraphics) => (typeof g === "number" ? String(g) : `[${g.map((v) => (v === null ? "null" : v)).join(", ")}]`);
    const palette = Object.entries(terrain.palette)
        .map(([id, entry]) => `        "${id}": { "graphics": ${graphics(entry.graphics)}${entry.blocked ? ', "blocked": true' : ""} }`)
        .join(",\n");
    const rows = terrain.rows.map(formatRow).join(",\n");
    return (
        `{\n    "id": ${terrain.id},\n    "width": ${terrain.width},\n    "height": ${terrain.height},\n` +
        `    "palette": {\n${palette}\n    },\n    "rows": [\n${rows}\n    ]\n}\n`
    );
}
