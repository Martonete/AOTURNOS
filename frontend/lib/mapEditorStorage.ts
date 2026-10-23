import fs from "node:fs/promises";
import path from "node:path";
import { compactMap, formatTerrain, type MapMeta, type MapSource } from "@aoturnos/game-core";

/**
 * Lectura y escritura de los mapas para el editor (/editor). Corre solo del lado del servidor de Next
 * y toca los archivos del monorepo: server/mapas_source (lo que usa el server del juego) y
 * frontend/public/maps (lo que descarga el navegador).
 *
 * En desarrollo está siempre activo. En producción hay que pedirlo con MAP_EDITOR=1, para que una
 * instalación pública nunca deje escribir mapas.
 */
export function mapEditorEnabled(): boolean {
    return process.env.NODE_ENV !== "production" || process.env.MAP_EDITOR === "1";
}

const SOURCE_DIR = process.env.MAPS_SOURCE_DIR ?? path.resolve(process.cwd(), "../server/mapas_source");
const PUBLIC_DIR = path.resolve(process.cwd(), "public/maps");
const BACKUP_DIR = path.join(SOURCE_DIR, ".backups");
const BACKUPS_PER_MAP = 20;

/** Los ids desde 500 los usa el juego para mapas locales e instancias (ver loadMapData en gameLoader). */
export const MAX_EDITABLE_MAP_ID = 499;
const MAX_SIDE = 200;

export type MapListEntry = { id: number; name: string; zona: string };

const mapDir = (id: number) => path.join(SOURCE_DIR, `mapa_${id}`);

async function readJson<T>(file: string, fallback: T): Promise<T> {
    try {
        return JSON.parse(await fs.readFile(file, "utf8")) as T;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
        throw error;
    }
}

export async function listMaps(): Promise<MapListEntry[]> {
    const names = await fs.readdir(SOURCE_DIR);
    const ids = names
        .map((name) => /^mapa_(\d+)$/.exec(name)?.[1])
        .filter((id): id is string => Boolean(id))
        .map(Number)
        .sort((a, b) => a - b);
    return Promise.all(
        ids.map(async (id) => {
            const meta = await readJson<Partial<MapMeta>>(path.join(mapDir(id), "meta.json"), {});
            return { id, name: meta.name || `Mapa ${id}`, zona: meta.zona ?? "" };
        }),
    );
}

/** Mapas que el navegador conoce (public/maps) pero no tienen fuente en el server, como el 110. */
export async function clientOnlyMapIds(known: Set<number>): Promise<number[]> {
    const names = await fs.readdir(PUBLIC_DIR).catch(() => [] as string[]);
    return names
        .map((name) => Number(/^mapa_(\d+)\.json$/.exec(name)?.[1]))
        .filter((id) => id > 0 && !known.has(id))
        .sort((a, b) => a - b);
}

export async function readMap(id: number): Promise<MapSource | null> {
    const dir = mapDir(id);
    const meta = await readJson<MapMeta | null>(path.join(dir, "meta.json"), null);
    const terrain = await readJson<MapSource["terrain"] | null>(path.join(dir, "terrain.json"), null);
    if (!meta || !terrain) return null;
    return {
        meta,
        terrain,
        specials: await readJson(path.join(dir, "specials.json"), { id, exits: {}, objects: {}, npcs: {}, triggers: {} }),
        npcs: await readJson(path.join(dir, "npcs.json"), []),
    };
}

/** Revisa lo justo para no escribir un mapa roto: ids, tamaño y que las filas cierren con la paleta. */
export function validateMap(id: number, source: MapSource): string | null {
    const { meta, terrain } = source ?? {};
    if (!meta || !terrain || !source.specials || !Array.isArray(source.npcs)) return "Faltan partes del mapa.";
    if (!Number.isInteger(id) || id < 1 || id > MAX_EDITABLE_MAP_ID) return `El número de mapa tiene que ir de 1 a ${MAX_EDITABLE_MAP_ID}.`;
    if (meta.id !== id || terrain.id !== id) return "El número de mapa no coincide con sus archivos.";
    const { width, height, rows, palette } = terrain;
    if (![width, height].every((n) => Number.isInteger(n) && n >= 10 && n <= MAX_SIDE)) return `El mapa tiene que medir entre 10 y ${MAX_SIDE} casillas por lado.`;
    if (!Array.isArray(rows) || rows.length !== height || rows.some((row) => !Array.isArray(row) || row.length !== width)) {
        return "Las filas del terreno no coinciden con el tamaño del mapa.";
    }
    if (rows.some((row) => row.some((p) => p !== 0 && !palette[String(p)]))) return "Hay baldosas que apuntan a una paleta que no existe.";
    if (typeof meta.name !== "string" || !meta.name.trim()) return "El mapa necesita un nombre.";
    return null;
}

async function backup(id: number): Promise<void> {
    const dir = mapDir(id);
    const files = ["meta.json", "terrain.json", "specials.json", "npcs.json"];
    const existing = (await Promise.all(files.map((f) => fs.stat(path.join(dir, f)).then(() => f, () => null)))).filter(Boolean) as string[];
    if (existing.length === 0) return;

    const target = path.join(BACKUP_DIR, `mapa_${id}`, new Date().toISOString().replace(/[:.]/g, "-"));
    await fs.mkdir(target, { recursive: true });
    await Promise.all(existing.map((f) => fs.copyFile(path.join(dir, f), path.join(target, f))));

    const all = (await fs.readdir(path.join(BACKUP_DIR, `mapa_${id}`))).sort();
    await Promise.all(all.slice(0, Math.max(0, all.length - BACKUPS_PER_MAP)).map((old) => fs.rm(path.join(BACKUP_DIR, `mapa_${id}`, old), { recursive: true })));
}

/** Guarda los cuatro archivos (con copia de seguridad de los anteriores) y regenera el mapa del navegador. */
export async function writeMap(id: number, source: MapSource): Promise<void> {
    await backup(id);
    const dir = mapDir(id);
    // Casi todos los terrain.json están en una sola línea; el que estaba formateado (mapa 1) sigue formateado.
    const previous = await fs.readFile(path.join(dir, "terrain.json"), "utf8").catch(() => "");
    const terrain = previous.includes('\n    "palette"') ? formatTerrain(source.terrain) : JSON.stringify(source.terrain);
    await fs.mkdir(dir, { recursive: true });
    await Promise.all([
        fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(source.meta), "utf8"),
        fs.writeFile(path.join(dir, "terrain.json"), terrain, "utf8"),
        fs.writeFile(path.join(dir, "specials.json"), JSON.stringify(source.specials), "utf8"),
        fs.writeFile(path.join(dir, "npcs.json"), `${JSON.stringify(source.npcs)}\n`, "utf8"),
    ]);
    await fs.mkdir(PUBLIC_DIR, { recursive: true });
    await fs.writeFile(path.join(PUBLIC_DIR, `mapa_${id}.json`), JSON.stringify(compactMap(source)), "utf8");
    usageCache = null;
}

let usageCache: Promise<Array<Array<[number, number]>>> | null = null;

/**
 * Cuántas baldosas de todo el mundo usan cada gráfico, por capa. Es la paleta "del mundo": muestra
 * primero los pisos, árboles y techos que más se usan. Se calcula una vez por proceso.
 */
export function worldUsage(): Promise<Array<Array<[number, number]>>> {
    usageCache ??= (async () => {
        const counts = Array.from({ length: 4 }, () => new Map<number, number>());
        for (const { id } of await listMaps()) {
            const terrain = await readJson<MapSource["terrain"] | null>(path.join(mapDir(id), "terrain.json"), null);
            if (!terrain) continue;
            const perEntry = new Map<string, number>();
            for (const row of terrain.rows) for (const p of row) if (p) perEntry.set(String(p), (perEntry.get(String(p)) ?? 0) + 1);
            for (const [entryId, uses] of perEntry) {
                const graphics = terrain.palette[entryId]?.graphics;
                const layers = typeof graphics === "number" ? [graphics] : (graphics ?? []);
                layers.forEach((g, l) => {
                    if (g && l < 4) counts[l].set(g, (counts[l].get(g) ?? 0) + uses);
                });
            }
        }
        return counts.map((m) => [...m.entries()].sort((a, b) => b[1] - a[1]));
    })();
    return usageCache;
}
