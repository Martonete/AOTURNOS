import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    compactMap,
    copyStamp,
    defaultMeta,
    EditSession,
    floodRegion,
    formatTerrain,
    graphicsToLayers,
    lineTiles,
    MapDocument,
    pasteStamp,
    singleStamp,
    type MapSource,
} from "../src";

const SOURCE_DIR = path.resolve(__dirname, "../../../server/mapas_source");
const PUBLIC_DIR = path.resolve(__dirname, "../../../frontend/public/maps");

function readSource(id: number): MapSource {
    const dir = path.join(SOURCE_DIR, `mapa_${id}`);
    const read = (file: string, fallback: unknown) =>
        fs.existsSync(path.join(dir, file)) ? JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) : fallback;
    return {
        meta: read("meta.json", null),
        terrain: read("terrain.json", null),
        specials: read("specials.json", { id, exits: {}, objects: {}, npcs: {}, triggers: {} }),
        npcs: read("npcs.json", []),
    };
}

const mapIds = fs
    .readdirSync(SOURCE_DIR)
    .map((name) => /^mapa_(\d+)$/.exec(name)?.[1])
    .filter((id): id is string => Boolean(id))
    .map(Number)
    .sort((a, b) => a - b);

describe("formato de mapas", () => {
    it("el formato compacto coincide con el que ya usa el frontend", () => {
        // 19 de los 294 mapas publicados quedaron viejos respecto de mapas_source; estos tres están al día.
        for (const id of [10, 100, 101]) {
            const expected = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, `mapa_${id}.json`), "utf8"));
            expect(compactMap(readSource(id)), `mapa ${id}`).toEqual(expected);
        }
    });

    it("abrir y guardar un mapa sin tocarlo no cambia nada de lo que ve el juego", () => {
        for (const id of mapIds) {
            const source = readSource(id);
            const roundTrip = MapDocument.fromSource(source).toSource();
            expect(compactMap(roundTrip), `mapa ${id}`).toEqual(compactMap(source));
            expect(roundTrip.npcs.length).toBe(source.npcs.length);
            expect(roundTrip.meta).toEqual(source.meta);
        }
    });

    it("guardar sin cambios deja terrain.json idéntico byte a byte", () => {
        let compared = 0;
        for (const id of mapIds) {
            const text = fs.readFileSync(path.join(SOURCE_DIR, `mapa_${id}`, "terrain.json"), "utf8");
            const original = JSON.parse(text) as MapSource["terrain"];
            // Al guardar se descartan las entradas de paleta sin uso y se unen las repetidas: esos mapas cambian a propósito.
            const used = new Set(original.rows.flat().map(String));
            const signatures = Object.values(original.palette).map((e) => `${graphicsToLayers(e.graphics).join()}|${Boolean(e.blocked)}`);
            if (Object.keys(original.palette).some((k) => !used.has(k)) || new Set(signatures).size !== signatures.length) continue;
            const terrain = MapDocument.fromSource(readSource(id)).toSource().terrain;
            const pretty = text.includes('\n    "palette"');
            expect(pretty ? formatTerrain(terrain) : JSON.stringify(terrain), `mapa ${id}`).toBe(text);
            compared++;
        }
        expect(compared).toBeGreaterThan(280);
    });

    it("terrain.json se escribe con el estilo de los archivos y se vuelve a leer igual", () => {
        const terrain = MapDocument.fromSource(readSource(1)).toSource().terrain;
        const text = formatTerrain(terrain);
        expect(JSON.parse(text)).toEqual(terrain);
        expect(text).toContain('"1": { "graphics": ');
    });
});

describe("edición", () => {
    const blank = () => MapDocument.blank(defaultMeta(400, "Prueba"), 20, 20, 1);

    it("un mapa nuevo trae piso y borde bloqueado", () => {
        const doc = blank();
        expect(doc.layers[0].every((g) => g === 1)).toBe(true);
        expect(doc.blocked[doc.index(1, 5)]).toBe(1);
        expect(doc.blocked[doc.index(5, 5)]).toBe(0);
    });

    it("deshacer y rehacer un trazo entero, con el aviso de cambios sin guardar", () => {
        const doc = blank();
        const session = new EditSession(doc);
        expect(session.dirty).toBe(false);

        session.begin("Pincel");
        for (const p of lineTiles({ x: 2, y: 2 }, { x: 6, y: 4 })) session.change(doc.index(p.x, p.y), (t) => (t.layers[1] = 7));
        session.commit();
        const painted = doc.layers[1].filter((g) => g === 7).length;
        expect(painted).toBe(5);
        expect(session.dirty).toBe(true);

        session.markSaved();
        expect(session.dirty).toBe(false);
        session.undo();
        expect(doc.layers[1].some((g) => g === 7)).toBe(false);
        expect(session.dirty).toBe(true);
        session.redo();
        expect(doc.layers[1].filter((g) => g === 7).length).toBe(painted);
        expect(session.dirty).toBe(false);

        // Una edición nueva después de deshacer no vuelve a parecer "guardada".
        session.undo();
        session.change(doc.index(10, 10), (t) => (t.trigger = 6));
        expect(session.dirty).toBe(true);
        expect(session.canRedo).toBe(false);
    });

    it("el balde rellena solo la región conectada", () => {
        const doc = blank();
        for (let y = 1; y <= 20; y++) doc.layers[0][doc.index(10, y)] = 2;
        const region = floodRegion(doc, 0, { x: 3, y: 3 });
        expect(region.length).toBe(9 * 20);
        expect(region.every((i) => doc.coords(i).x < 10)).toBe(true);
    });

    it("un sello copiado no borra las capas vacías de abajo y trae su bloqueo", () => {
        const doc = blank();
        const session = new EditSession(doc);
        doc.layers[2][doc.index(3, 3)] = 900;
        doc.blocked[doc.index(3, 3)] = 1;
        const stamp = copyStamp(doc, { x: 3, y: 3, width: 1, height: 1 });
        pasteStamp(session, stamp, { x: 8, y: 8 });
        const t = doc.tile(doc.index(8, 8));
        expect(t.layers).toEqual([1, 0, 900, 0]);
        expect(t.blocked).toBe(true);

        // El pincel común no toca el bloqueo.
        pasteStamp(session, singleStamp(0, 5), { x: 8, y: 8 });
        expect(doc.tile(doc.index(8, 8)).blocked).toBe(true);
        expect(doc.layers[0][doc.index(8, 8)]).toBe(5);
    });

    it("guardar arma una paleta con solo las combinaciones usadas", () => {
        const doc = blank();
        const source = doc.toSource();
        expect(Object.keys(source.terrain.palette)).toHaveLength(2);
        expect(source.terrain.rows[0][0]).not.toBe(source.terrain.rows[5][5]);
    });
});
