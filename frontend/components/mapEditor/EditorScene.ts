import { AnimatedSprite, Application, Container, Culler, Graphics, Sprite, type Texture } from "pixi.js";
import { MAP_LAYERS, singleStamp, type ChangeSet, type MapDocument, type Point, type Rect, type Stamp } from "@aoturnos/game-core";
import type { NPCsDB, ObjectsDB } from "../../types/game";
import { loadNPCsDB, loadObjectsDB } from "../../utils/gameLoader";
import { BattleCharacterSprite, loadBattleDBs, loadGraphicFrames, type BattleDBs } from "../game/battle/battleAssets";
import { editor, type EditorState } from "./editorStore";
import { startStroke, type Stroke } from "./tools";

const TILE = 32;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;

/** Colores de cada trigger en la capa de ayudas. */
export const TRIGGER_COLORS: Record<number, number> = {
    1: 0x7c9cff,
    2: 0xffb347,
    3: 0xff5a5a,
    4: 0xb07cff,
    5: 0xffe066,
    6: 0xff4fa3,
    11: 0x4fd6ff,
};

/** Capas 3 y 4 (árboles, casas, techos) se apoyan sobre la base de la casilla, como en sceneRenderer. */
function anchorBottom(sprite: Sprite, texture: Texture, x: number, y: number): void {
    sprite.position.set((x - 1) * TILE + 16 - Math.floor(texture.width / 2), (y - 1) * TILE + TILE - texture.height);
}

function makeSprite(frames: Texture[]): Sprite {
    if (frames.length > 1) {
        const animated = new AnimatedSprite(frames);
        animated.animationSpeed = 0.12;
        animated.play();
        return animated;
    }
    return new Sprite(frames[0]);
}

/**
 * El lienzo del editor: dibuja el mapa con Pixi, mueve la cámara y traduce el mouse en trazos
 * de herramienta. Solo redibuja las casillas que cambian, así pintar se siente instantáneo.
 */
export class EditorScene {
    private app = new Application();
    private dbs: BattleDBs | null = null;
    npcsDB: NPCsDB = {};
    objectsDB: ObjectsDB = {};
    private ready = false;
    private destroyed = false;

    private world = new Container();
    private layerViews = Array.from({ length: MAP_LAYERS }, () => new Container());
    /** Capa 3, objetos y NPCs comparten contenedor para ordenarse por fila. */
    private upper = this.layerViews[2];
    private helpers = new Graphics();
    private ghost = new Container();
    private cursor = new Graphics();

    private sprites: Array<Map<number, Sprite>> = Array.from({ length: MAP_LAYERS }, () => new Map());
    private objectSprites = new Map<number, Sprite>();
    private npcViews: Array<{ view: Container; body: BattleCharacterSprite }> = [];
    private frames = new Map<number, Texture[]>();
    private doc: MapDocument | null = null;

    private stroke: Stroke | null = null;
    private pan: { x: number; y: number; camX: number; camY: number } | null = null;
    private spaceHeld = false;
    private helpersDirty = true;
    private ghostKey = "";
    private cameraListeners = new Set<() => void>();
    private unsubscribe: Array<() => void> = [];

    constructor(private readonly host: HTMLElement) {}

    async init(): Promise<void> {
        await this.app.init({ resizeTo: this.host, background: 0x0b0d12, antialias: false, autoDensity: true, resolution: window.devicePixelRatio || 1 });
        if (this.destroyed) {
            this.app.destroy(true);
            return;
        }
        this.host.appendChild(this.app.canvas);
        this.app.canvas.style.cursor = "crosshair";
        this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

        this.upper.sortableChildren = true;
        this.ghost.alpha = 0.6;
        this.world.addChild(...this.layerViews, this.helpers, this.ghost, this.cursor);
        this.app.stage.addChild(this.world);

        [this.dbs, this.npcsDB, this.objectsDB] = await Promise.all([loadBattleDBs(), loadNPCsDB().catch(() => ({})), loadObjectsDB().catch(() => ({}))]);
        this.ready = true;

        this.app.ticker.add(() => this.frame());
        this.bindInput();
        this.unsubscribe.push(
            editor.onDocumentChange((changes) => void this.onDocumentChange(changes)),
            editor.subscribe(() => this.onStateChange(editor.get())),
        );
        if (editor.doc) await this.onDocumentChange("reload");
        this.onStateChange(editor.get());
    }

    destroy(): void {
        this.destroyed = true;
        for (const off of this.unsubscribe) off();
        window.removeEventListener("keydown", this.onKeyDown);
        window.removeEventListener("keyup", this.onKeyUp);
        if (this.ready) this.app.destroy(true, { children: true });
    }

    /* ------------------------------ cámara ------------------------------ */

    get zoom(): number {
        return this.world.scale.x;
    }

    /** Rectángulo visible en casillas (para el minimapa). */
    viewRect(): Rect {
        const z = this.zoom;
        return {
            x: -this.world.x / z / TILE + 1,
            y: -this.world.y / z / TILE + 1,
            width: this.app.screen.width / z / TILE,
            height: this.app.screen.height / z / TILE,
        };
    }

    onCamera(listener: () => void): () => void {
        this.cameraListeners.add(listener);
        return () => this.cameraListeners.delete(listener);
    }

    private cameraChanged(): void {
        editor.set({ zoom: this.zoom });
        for (const l of this.cameraListeners) l();
    }

    centerOn(x: number, y: number): void {
        const z = this.zoom;
        this.world.position.set(this.app.screen.width / 2 - (x - 0.5) * TILE * z, this.app.screen.height / 2 - (y - 0.5) * TILE * z);
        this.cameraChanged();
    }

    zoomAt(factor: number, screen = { x: this.app.screen.width / 2, y: this.app.screen.height / 2 }): void {
        const before = this.zoom;
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, before * factor));
        if (next === before) return;
        // El punto del mapa bajo el cursor queda quieto mientras se acerca o aleja.
        const wx = (screen.x - this.world.x) / before;
        const wy = (screen.y - this.world.y) / before;
        this.world.scale.set(next);
        this.world.position.set(screen.x - wx * next, screen.y - wy * next);
        this.helpersDirty = true;
        this.cameraChanged();
    }

    setZoom(zoom: number): void {
        this.zoomAt(zoom / this.zoom);
    }

    private tileAt(clientX: number, clientY: number): Point {
        const rect = this.app.canvas.getBoundingClientRect();
        const z = this.zoom;
        return {
            x: Math.floor((clientX - rect.left - this.world.x) / z / TILE) + 1,
            y: Math.floor((clientY - rect.top - this.world.y) / z / TILE) + 1,
        };
    }

    /* ------------------------------ entrada ------------------------------ */

    private onKeyDown = (e: KeyboardEvent) => {
        if (e.code === "Space" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
            if (!this.spaceHeld) this.app.canvas.style.cursor = "grab";
            this.spaceHeld = true;
            e.preventDefault();
        }
    };

    private onKeyUp = (e: KeyboardEvent) => {
        if (e.code === "Space") {
            this.spaceHeld = false;
            this.app.canvas.style.cursor = editor.get().tool === "pan" ? "grab" : "crosshair";
        }
    };

    private bindInput(): void {
        const canvas = this.app.canvas;
        window.addEventListener("keydown", this.onKeyDown);
        window.addEventListener("keyup", this.onKeyUp);

        canvas.addEventListener("pointerdown", (e) => {
            canvas.setPointerCapture(e.pointerId);
            const state = editor.get();
            const panning = e.button === 1 || e.button === 2 || this.spaceHeld || state.tool === "pan";
            if (panning) {
                this.pan = { x: e.clientX, y: e.clientY, camX: this.world.x, camY: this.world.y };
                canvas.style.cursor = "grabbing";
                return;
            }
            if (e.button !== 0 || !editor.doc || !editor.session) return;
            const p = this.tileAt(e.clientX, e.clientY);
            this.stroke = startStroke(state.tool, { doc: editor.doc, session: editor.session, state }, p);
            if (!this.stroke) editor.commit();
            this.helpersDirty = true;
        });

        canvas.addEventListener("pointermove", (e) => {
            if (this.pan) {
                this.world.position.set(this.pan.camX + e.clientX - this.pan.x, this.pan.camY + e.clientY - this.pan.y);
                this.cameraChanged();
                return;
            }
            const p = this.tileAt(e.clientX, e.clientY);
            const hover = editor.get().hover;
            if (hover && hover.x === p.x && hover.y === p.y) return;
            editor.set({ hover: p });
            this.stroke?.move(p);
        });

        const finish = (e: PointerEvent) => {
            if (this.pan) {
                this.pan = null;
                canvas.style.cursor = this.spaceHeld || editor.get().tool === "pan" ? "grab" : "crosshair";
                return;
            }
            if (!this.stroke) return;
            this.stroke.end(this.tileAt(e.clientX, e.clientY));
            this.stroke = null;
            editor.commit();
        };
        canvas.addEventListener("pointerup", finish);
        canvas.addEventListener("pointercancel", finish);
        canvas.addEventListener("pointerleave", () => {
            if (!this.stroke && !this.pan) editor.set({ hover: null });
        });
        canvas.addEventListener(
            "wheel",
            (e) => {
                e.preventDefault();
                const rect = canvas.getBoundingClientRect();
                this.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, { x: e.clientX - rect.left, y: e.clientY - rect.top });
            },
            { passive: false },
        );
    }

    /* ------------------------------ dibujo ------------------------------ */

    private async ensureFrames(grhs: Iterable<number>): Promise<void> {
        const dbs = this.dbs;
        if (!dbs) return;
        const missing = [...new Set(grhs)].filter((g) => g > 0 && !this.frames.has(g));
        await Promise.all(missing.map(async (g) => this.frames.set(g, await loadGraphicFrames(dbs, g))));
    }

    private async onDocumentChange(changes: ChangeSet | "reload"): Promise<void> {
        const doc = editor.doc;
        if (!this.ready || !doc) return;

        if (changes === "reload") {
            this.doc = doc;
            for (const layer of this.sprites) {
                for (const s of layer.values()) s.destroy();
                layer.clear();
            }
            for (const s of this.objectSprites.values()) s.destroy();
            this.objectSprites.clear();
            const grhs: number[] = [];
            for (const layer of doc.layers) for (const g of layer) if (g) grhs.push(g);
            for (const o of doc.objects.values()) grhs.push(this.objectGrh(o.objIndex));
            await this.ensureFrames(grhs);
            if (doc !== editor.doc) return;
            for (let i = 0; i < doc.size; i++) this.drawTile(i);
            await this.drawNpcs();
            const hover = editor.get().hover;
            this.centerOn(hover?.x ?? doc.width / 2, hover?.y ?? doc.height / 2);
        } else {
            const grhs: number[] = [];
            for (const i of changes.tiles) {
                for (const layer of doc.layers) grhs.push(layer[i]);
                const o = doc.objects.get(i);
                if (o) grhs.push(this.objectGrh(o.objIndex));
            }
            await this.ensureFrames(grhs);
            for (const i of changes.tiles) this.drawTile(i);
            if (changes.npcs) await this.drawNpcs();
        }
        this.helpersDirty = true;
    }

    private objectGrh(objIndex: number): number {
        return Number(this.objectsDB[String(objIndex)]?.grhIndex ?? 0);
    }

    private drawTile(i: number): void {
        const doc = this.doc;
        if (!doc) return;
        const { x, y } = doc.coords(i);
        for (let l = 0; l < MAP_LAYERS; l++) {
            this.sprites[l].get(i)?.destroy();
            this.sprites[l].delete(i);
            const frames = this.frames.get(doc.layers[l][i]);
            if (!frames || frames.length === 0) continue;
            const sprite = makeSprite(frames);
            sprite.cullable = true;
            if (l < 2) sprite.position.set((x - 1) * TILE, (y - 1) * TILE);
            else anchorBottom(sprite, frames[0], x, y);
            if (l === 2) {
                sprite.zIndex = y * 10 + 7;
                sprite.visible = editor.get().show.layers[2];
            }
            this.layerViews[l].addChild(sprite);
            this.sprites[l].set(i, sprite);
        }

        this.objectSprites.get(i)?.destroy();
        this.objectSprites.delete(i);
        const obj = doc.objects.get(i);
        const objFrames = obj ? this.frames.get(this.objectGrh(obj.objIndex)) : undefined;
        if (objFrames?.length) {
            const sprite = new Sprite(objFrames[0]);
            sprite.position.set((x - 1) * TILE + 16 - Math.floor(objFrames[0].width / 2), (y - 1) * TILE + 16 - Math.floor(objFrames[0].height / 2));
            sprite.zIndex = y * 10 + 3;
            sprite.visible = editor.get().show.objects;
            this.upper.addChild(sprite);
            this.objectSprites.set(i, sprite);
        }
    }

    private async drawNpcs(): Promise<void> {
        for (const { view, body } of this.npcViews) {
            body.destroy();
            view.destroy({ children: true });
        }
        this.npcViews = [];
        const doc = this.doc;
        if (!doc || !this.dbs) return;
        for (const npc of doc.npcs) {
            const data = this.npcsDB[String(npc.npcIndex)];
            const view = new Container();
            view.position.set((npc.x - 1) * TILE, (npc.y - 1) * TILE);
            view.zIndex = npc.y * 10 + 5;
            view.visible = editor.get().show.npcs;
            const ring = new Graphics().ellipse(16, 29, 12, 5).stroke({ color: 0xffd36b, width: 1.5, alpha: 0.9 });
            view.addChild(ring);
            const body = new BattleCharacterSprite(this.dbs, { body: data?.idBody ?? 0, head: data?.idHead ?? 0, weapon: 0, shield: 0, helmet: 0 });
            view.addChild(body.view);
            void body.setHeading(2);
            this.upper.addChild(view);
            this.npcViews.push({ view, body });
        }
    }

    private onStateChange(state: EditorState): void {
        if (!this.ready) return;
        state.show.layers.forEach((on, l) => (this.layerViews[l].visible = on || l === 2));
        // La capa 3 comparte contenedor con objetos y NPCs: se esconde sprite por sprite.
        for (const s of this.sprites[2].values()) s.visible = state.show.layers[2];
        this.layerViews[3].alpha = state.show.ghostRoofs ? 0.45 : 1;
        for (const s of this.objectSprites.values()) s.visible = state.show.objects;
        for (const { view } of this.npcViews) view.visible = state.show.npcs;
        if (!this.pan) this.app.canvas.style.cursor = this.spaceHeld || state.tool === "pan" ? "grab" : "crosshair";
        this.helpersDirty = true;
    }

    private frame(): void {
        if (this.helpersDirty) {
            this.helpersDirty = false;
            this.drawHelpers();
        }
        this.drawCursor();
        for (const { body } of this.npcViews) body.update(this.app.ticker.deltaMS);
        Culler.shared.cull(this.world, this.app.screen);
    }

    /** Grilla, bloqueos, triggers y salidas: se redibuja solo cuando cambia algo. */
    private drawHelpers(): void {
        const g = this.helpers;
        g.clear();
        const doc = this.doc;
        if (!doc) return;
        const { show } = editor.get();
        const w = doc.width * TILE;
        const h = doc.height * TILE;

        g.rect(0, 0, w, h).stroke({ color: 0xf5c56a, width: 2 / this.zoom, alpha: 0.8 });
        if (show.grid && this.zoom >= 0.45) {
            for (let x = 1; x < doc.width; x++) g.moveTo(x * TILE, 0).lineTo(x * TILE, h);
            for (let y = 1; y < doc.height; y++) g.moveTo(0, y * TILE).lineTo(w, y * TILE);
            g.stroke({ color: 0xffffff, width: 1 / this.zoom, alpha: 0.09 });
        }

        for (let i = 0; i < doc.size; i++) {
            const px = (i % doc.width) * TILE;
            const py = Math.floor(i / doc.width) * TILE;
            if (show.blocked && doc.blocked[i]) {
                g.rect(px + 1, py + 1, TILE - 2, TILE - 2).fill({ color: 0xff2a2a, alpha: 0.22 });
                g.moveTo(px + 6, py + 6).lineTo(px + TILE - 6, py + TILE - 6).moveTo(px + TILE - 6, py + 6).lineTo(px + 6, py + TILE - 6);
                g.stroke({ color: 0xff5a5a, width: 1.5, alpha: 0.7 });
            }
            const trigger = doc.trigger[i];
            if (show.triggers && trigger) {
                g.rect(px + 3, py + 3, TILE - 6, TILE - 6).stroke({ color: TRIGGER_COLORS[trigger] ?? 0xffffff, width: 2, alpha: 0.85 });
            }
            if (show.exits && doc.exits.has(i)) {
                g.poly([px + 16, py + 4, px + 28, py + 16, px + 16, py + 28, px + 4, py + 16]).fill({ color: 0x29d3ff, alpha: 0.35 }).stroke({ color: 0x9ff0ff, width: 1.5 });
            }
        }
    }

    /** Lo que sigue al mouse: el contorno del pincel, el gráfico fantasma o el rectángulo que se arrastra. */
    private drawCursor(): void {
        const g = this.cursor;
        g.clear();
        const state = editor.get();
        const hover = state.hover;
        const area = this.stroke?.area() ?? null;

        if (area) {
            g.rect((area.x - 1) * TILE, (area.y - 1) * TILE, area.width * TILE, area.height * TILE)
                .fill({ color: 0xf5c56a, alpha: 0.12 })
                .stroke({ color: 0xf5c56a, width: 2 / this.zoom });
        } else if (hover && !this.pan) {
            const stamp = state.tool === "brush" || state.tool === "rect" ? (state.stamp ?? null) : null;
            const size = stamp ? 1 : ["brush", "eraser", "block", "trigger"].includes(state.tool) ? state.brushSize : 1;
            const start = -Math.floor((size - 1) / 2);
            const wTiles = stamp?.width ?? size;
            const hTiles = stamp?.height ?? size;
            const ox = stamp ? 0 : start;
            g.rect((hover.x - 1 + ox) * TILE, (hover.y - 1 + (stamp ? 0 : start)) * TILE, wTiles * TILE, hTiles * TILE).stroke({
                color: state.tool === "eraser" ? 0xff7a7a : 0xffffff,
                width: 1.5 / this.zoom,
                alpha: 0.9,
            });
        }
        this.drawGhost(state, area ? null : hover);
    }

    /** Vista previa semitransparente de lo que va a pintar el pincel. */
    private drawGhost(state: EditorState, hover: Point | null): void {
        const stamp: Stamp | null =
            state.tool === "brush" ? (state.stamp ?? (state.grh ? singleStamp(state.layer, state.grh) : null)) : null;
        const key = hover && stamp ? `${hover.x},${hover.y}|${state.stamp ? "s" : `${state.layer}:${state.grh}`}` : "";
        if (key === this.ghostKey) return;
        this.ghostKey = key;
        for (const child of this.ghost.removeChildren()) child.destroy();
        if (!hover || !stamp) return;
        void this.ensureFrames(stamp.cells.flatMap((c) => c.layers)).then(() => {
            if (this.ghostKey !== key) return;
            stamp.cells.forEach((cell, k) => {
                const x = hover.x + (k % stamp.width);
                const y = hover.y + Math.floor(k / stamp.width);
                cell.layers.forEach((grh, l) => {
                    const frames = this.frames.get(grh);
                    if (!grh || !frames?.length) return;
                    const sprite = new Sprite(frames[0]);
                    if (l < 2) sprite.position.set((x - 1) * TILE, (y - 1) * TILE);
                    else anchorBottom(sprite, frames[0], x, y);
                    this.ghost.addChild(sprite);
                });
            });
        });
    }
}
