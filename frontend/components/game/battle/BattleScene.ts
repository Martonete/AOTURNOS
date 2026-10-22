import {
    Application,
    Container,
    Graphics,
    Rectangle,
    RenderTexture,
    Sprite,
    Text,
    type FederatedPointerEvent,
} from "pixi.js";
import {
    ABILITIES,
    areaTiles,
    checkTarget,
    crowdGuard,
    dangerMap,
    forecastAbility,
    manhattan,
    pathTo,
    reachableTiles,
    sameTile,
    STATUSES,
    threatAgainst,
    threatZone,
    tileKey,
    type AbilityDef,
    type BattleEvent,
    type BattleState,
    type Combatant,
    type DamageSchool,
    type Forecast,
    type ThreatAgainst,
    type ThreatZone,
    type Tile,
} from "@aoturnos/game-core";
import { BattleCharacterSprite, buildMapDiorama, createSpellFx, loadBattleDBs, type BattleDBs } from "./battleAssets";
import { BattlePostFx, ease, getGlowTexture, LightLayer, ParticleSystem, type Light } from "./battleFx";
import { battleStore, describeError, type BattleBatch } from "./battleStore";

const TILE = 32;
/** Margen del diorama alrededor de la grilla (el piso se dibuja una casilla más por lado). */
const PAD = TILE;
const STEP_MS = 170;

const SCHOOL_COLOR: Record<DamageSchool, number> = {
    physical: 0xffe2b0,
    magic: 0xb98cff,
    fire: 0xff7a2e,
    lightning: 0x8fd8ff,
    holy: 0xfff1a8,
    poison: 0x7dff6a,
};

type UnitView = {
    id: string;
    root: Container;
    body: BattleCharacterSprite;
    shadow: Graphics;
    ring: Graphics;
    bars: Graphics;
    light: Light;
    hp: number;
    maxHp: number;
    alive: boolean;
    team: Combatant["team"];
};

type Tween = { elapsed: number; duration: number; step: (t: number) => void; done: () => void };

function abilityColor(ability: AbilityDef | undefined): number {
    if (!ability) return 0xffffff;
    for (const effect of ability.effects) {
        if (effect.kind === "damage") return SCHOOL_COLOR[effect.school];
        if (effect.kind === "heal" || effect.kind === "revive") return 0x9dffb8;
        if (effect.kind === "cleanse") return 0xc8f7ff;
    }
    if (ability.effects.some((e) => e.kind === "weapon")) return SCHOOL_COLOR.physical;
    return ability.hostile ? 0xd28cff : 0x9de6ff;
}

/**
 * Una sola Application de Pixi para todas las batallas. Destruir una segunda Application
 * rompe el renderer del mapa (Pixi comparte pools globales de batchers y geometrías), así
 * que al terminar un combate se vacía y se desmonta, pero no se destruye.
 */
let sharedApp: Promise<Application> | null = null;

function getBattleApp(): Promise<Application> {
    sharedApp ??= (async () => {
        const app = new Application();
        await app.init({
            background: 0x05060a,
            antialias: false,
            autoDensity: true,
            resolution: Math.min(2, window.devicePixelRatio || 1),
            autoStart: false,
        });
        app.canvas.style.imageRendering = "pixelated";
        app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
        return app;
    })();
    return sharedApp;
}

const center = (t: Tile) => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE / 2 });

/**
 * Escena de combate en Pixi: diorama del mapa real, unidades con sprites de AO,
 * resaltado de la grilla, luces 2D, partículas y post-proceso. Anima los lotes de
 * eventos del store y manda las acciones del jugador.
 */
export class BattleScene {
    private app!: Application;
    private readonly tick = (ticker: { deltaMS: number }) => this.update(ticker.deltaMS);
    private dbs: BattleDBs | null = null;
    private destroyed = false;
    private ready = false;

    private root = new Container();
    private world = new Container();
    private floor = new Container();
    private highlights = new Graphics();
    private units = new Container();
    private fxLayer = new Container();
    private textLayer = new Container();
    private ui = new Container();
    private particles = new ParticleSystem();
    private postFx = new BattlePostFx();
    private lights: LightLayer | null = null;
    private lightTexture: RenderTexture | null = null;
    private lightSprite: Sprite | null = null;

    private views = new Map<string, UnitView>();
    /** Árboles, muros y techos: se vuelven translúcidos si tapan a una unidad. */
    private props: Sprite[] = [];
    private tweens = new Set<Tween>();
    private state: BattleState | null = null;
    private hover: Tile | null = null;
    /** Mapa de peligro encendido (tecla Q): cuántos rivales llegan a cada casilla. */
    private danger = false;
    /** Zonas de amenaza calculadas para cada estado: el estado se reemplaza entero en cada evento. */
    private threatCache = new WeakMap<BattleState, { zones: Map<string, ThreatZone>; danger?: Map<string, number> }>();
    private highlightClock = 0;
    private shake = 0;
    private playing = false;
    private unsubscribe: (() => void) | null = null;
    private resizeObserver: ResizeObserver | null = null;
    /** Espacio ocupado por los paneles del HUD, para centrar el tablero en lo que queda libre. */
    private insets = { top: 72, bottom: 150 };

    constructor(private readonly host: HTMLDivElement) {}

    async init(): Promise<void> {
        this.app = await getBattleApp();
        if (this.destroyed) return;
        this.host.appendChild(this.app.canvas);
        this.app.resizeTo = this.host;

        this.dbs = await loadBattleDBs();
        if (this.destroyed) return;

        this.units.sortableChildren = true;
        this.world.addChild(this.floor, this.highlights, this.units);
        this.root.addChild(this.world);
        this.app.stage.addChild(this.root, this.ui);
        this.root.filters = [this.postFx.filter];

        this.world.eventMode = "static";
        this.world.on("pointermove", (e) => this.onPointerMove(e));
        this.world.on("pointertap", (e) => this.onPointerTap(e));
        this.world.on("rightclick", () => battleStore.setMode({ kind: "move" }));

        this.app.ticker.add(this.tick);
        this.app.start();
        this.resizeObserver = new ResizeObserver(() => this.layout());
        this.resizeObserver.observe(this.host);

        const initial = battleStore.get().state;
        if (initial) await this.buildStage(initial);
        this.unsubscribe = battleStore.subscribe(() => this.onStoreChange());
        this.ready = true;
        this.onStoreChange();
    }

    destroy(): void {
        this.destroyed = true;
        this.unsubscribe?.();
        this.resizeObserver?.disconnect();
        for (const view of this.views.values()) view.body.destroy();
        this.views.clear();
        this.tweens.clear();
        const app = this.app;
        if (!app) return;
        app.ticker.remove(this.tick);
        app.stop();
        for (const child of app.stage.removeChildren()) child.destroy({ children: true });
        this.lights?.scene.destroy({ children: true });
        this.lightTexture?.destroy(true);
        app.resizeTo = undefined as unknown as HTMLElement;
        app.canvas.remove();
    }

    /* ---------------------------- montaje ---------------------------- */

    private async buildStage(state: BattleState): Promise<void> {
        const dbs = this.dbs!;
        const { width, height, origin } = state.grid;
        this.state = state;

        if (origin) {
            const diorama = await buildMapDiorama(dbs, origin, width, height);
            if (this.destroyed) return;
            this.floor.addChild(diorama.floor);
            for (const prop of diorama.props) {
                prop.sprite.zIndex = prop.row * 10 + 5;
                this.units.addChild(prop.sprite);
                this.props.push(prop.sprite);
            }
        } else {
            const ground = new Graphics();
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    ground.rect(x * TILE, y * TILE, TILE, TILE).fill((x + y) % 2 ? 0x2b3a2a : 0x324432);
                }
            }
            this.floor.addChild(ground);
        }

        // Casillas bloqueadas sin gráfico propio: una sombra sutil para que se lean.
        const blocked = new Graphics();
        for (let i = 0; i < state.grid.blocked.length; i++) {
            if (!state.grid.blocked[i]) continue;
            const x = i % width;
            const y = Math.floor(i / width);
            blocked.rect(x * TILE, y * TILE, TILE, TILE).fill({ color: 0x000000, alpha: 0.28 });
        }
        this.floor.addChild(blocked);

        // Luz: ambiente frío y unidades con un halo cálido, dibujado en una RenderTexture y multiplicado.
        const lw = width * TILE + PAD * 2;
        const lh = height * TILE + PAD * 2;
        this.lights = new LightLayer(lw, lh, 0x6f7aa0, PAD);
        this.lightTexture = RenderTexture.create({ width: lw, height: lh });
        this.lightSprite = new Sprite(this.lightTexture);
        this.lightSprite.position.set(-PAD, -PAD);
        this.lightSprite.blendMode = "multiply";
        this.lightSprite.eventMode = "none";
        this.world.addChild(this.lightSprite, this.fxLayer, this.particles.view, this.textLayer);
        this.world.hitArea = new Rectangle(0, 0, width * TILE, height * TILE);
        // Recorte del diorama al borde de la luz, para que lo de afuera no quede sin iluminar.
        const mask = new Graphics().rect(-PAD, -PAD, lw, lh).fill(0xffffff);
        this.world.addChild(mask);
        this.world.mask = mask;

        for (const c of Object.values(state.combatants)) this.ensureUnit(c);
        this.syncUnits(state);
        this.layout();
    }

    private ensureUnit(c: Combatant): UnitView {
        const existing = this.views.get(c.id);
        if (existing) return existing;
        const root = new Container();
        const shadow = new Graphics().ellipse(TILE / 2, TILE - 3, 11, 4).fill({ color: 0x000000, alpha: 0.45 });
        const ring = new Graphics();
        const body = new BattleCharacterSprite(this.dbs!, c.appearance);
        const bars = new Graphics();
        root.addChild(ring, shadow, body.view, bars);
        this.units.addChild(root);
        void body.setHeading(c.heading);

        const lightColor = c.team === "heroes" ? 0xffd9a0 : 0xff9a8a;
        const light = this.lights!.add(0, 0, c.team === "heroes" ? 78 : 56, lightColor, { alpha: 0.9, flicker: 0.12 });
        const view: UnitView = {
            id: c.id,
            root,
            body,
            shadow,
            ring,
            bars,
            light,
            hp: c.res.hp,
            maxHp: c.res.maxHp,
            alive: c.alive,
            team: c.team,
        };
        this.views.set(c.id, view);
        this.placeUnit(view, c.pos);
        return view;
    }

    private placeUnit(view: UnitView, pos: { x: number; y: number }): void {
        view.root.position.set(pos.x * TILE, pos.y * TILE);
        view.root.zIndex = pos.y * 10 + 6;
        view.light.sprite.position.set(pos.x * TILE + TILE / 2, pos.y * TILE + TILE / 2);
    }

    /** Lleva cada unidad al estado autoritativo (posición, orientación, vida, muerte). */
    private syncUnits(state: BattleState): void {
        for (const c of Object.values(state.combatants)) {
            const view = this.ensureUnit(c);
            this.placeUnit(view, c.pos);
            void view.body.setHeading(c.heading);
            view.hp = c.res.hp;
            view.maxHp = c.res.maxHp;
            this.setAlive(view, c.alive, false);
            this.drawBars(view);
        }
    }

    private setAlive(view: UnitView, alive: boolean, animate: boolean): void {
        if (view.alive === alive && animate) return;
        view.alive = alive;
        const target = alive ? 1 : 0.28;
        view.light.baseAlpha = alive ? 0.9 : 0;
        view.light.sprite.alpha = view.light.baseAlpha;
        if (!animate) {
            view.root.alpha = target;
            view.body.view.rotation = 0;
            return;
        }
        const from = view.root.alpha;
        void this.tween(450, (t) => {
            view.root.alpha = from + (target - from) * ease.outCubic(t);
        });
    }

    private drawBars(view: UnitView): void {
        const g = view.bars;
        g.clear();
        if (!view.alive) return;
        const pct = Math.max(0, Math.min(1, view.hp / Math.max(1, view.maxHp)));
        const w = 26;
        const x = (TILE - w) / 2;
        const y = -24;
        g.roundRect(x - 1, y - 1, w + 2, 5, 2).fill({ color: 0x000000, alpha: 0.7 });
        const color = view.team === "heroes" ? (pct > 0.35 ? 0x5ef08a : 0xffc04a) : pct > 0.35 ? 0xff5a5a : 0xff9a3a;
        g.roundRect(x, y, Math.max(1, w * pct), 3, 1.5).fill(color);
    }

    setInsets(top: number, bottom: number): void {
        if (this.insets.top === top && this.insets.bottom === bottom) return;
        this.insets = { top, bottom };
        if (this.ready) this.layout();
    }

    private layout(): void {
        if (!this.state) return;
        const { width, height } = this.state.grid;
        const sw = this.app.screen.width;
        const sh = this.app.screen.height;
        // Se deja lugar para la barra de acciones abajo y la línea de turnos arriba.
        const { top, bottom } = this.insets;
        const usableH = Math.max(120, sh - top - bottom);
        const scale = Math.max(0.75, Math.min((sw - 40) / (width * TILE), usableH / (height * TILE)));
        this.world.scale.set(scale);
        this.world.position.set(
            Math.round((sw - width * TILE * scale) / 2),
            Math.round(top + (usableH - height * TILE * scale) / 2),
        );
        this.root.filterArea = this.app.screen;
    }

    /* ---------------------------- bucle ---------------------------- */

    private update(deltaMs: number): void {
        if (!this.state || this.destroyed) return;
        for (const tween of [...this.tweens]) {
            tween.elapsed += deltaMs;
            const t = Math.min(1, tween.elapsed / tween.duration);
            try {
                tween.step(t);
            } catch (error) {
                // Un paso roto no puede trabar la cola de animación: se da por terminado.
                console.error("[battle] error en animación", error);
                tween.elapsed = tween.duration;
            }
            if (t >= 1 || tween.elapsed >= tween.duration) {
                this.tweens.delete(tween);
                tween.done();
            }
        }
        for (const view of this.views.values()) view.body.update(deltaMs);
        this.fadeOccludingProps(deltaMs);
        this.particles.update(deltaMs);
        this.postFx.update(deltaMs);

        if (this.shake > 0) {
            this.shake = Math.max(0, this.shake - deltaMs / 300);
            const amount = this.shake * 6;
            this.root.position.set((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
        } else {
            this.root.position.set(0, 0);
        }

        if (this.lights && this.lightTexture) {
            this.lights.update(deltaMs);
            this.app.renderer.render({ container: this.lights.scene, target: this.lightTexture, clear: true });
        }

        this.highlightClock += deltaMs;
        this.drawHighlights();
        if (!this.playing) void this.playNext();
    }

    private fadeOccludingProps(deltaMs: number): void {
        for (const prop of this.props) {
            const b = { x: prop.x, y: prop.y, w: prop.width, h: prop.height };
            let covers = false;
            for (const view of this.views.values()) {
                if (!view.alive || view.root.zIndex >= prop.zIndex) continue;
                const cx = view.root.x + TILE / 2;
                const cy = view.root.y + TILE / 2;
                if (cx > b.x && cx < b.x + b.w && cy > b.y && cy < b.y + b.h) {
                    covers = true;
                    break;
                }
            }
            const target = covers ? 0.4 : 1;
            prop.alpha += (target - prop.alpha) * Math.min(1, deltaMs / 120);
        }
    }

    private tween(duration: number, step: (t: number) => void): Promise<void> {
        return new Promise((resolve) => {
            this.tweens.add({ elapsed: 0, duration: Math.max(1, duration), step, done: resolve });
        });
    }

    private wait(ms: number): Promise<void> {
        return this.tween(ms, () => {});
    }

    /* ------------------------ store e interacción ------------------------ */

    private onStoreChange(): void {
        if (!this.ready) return;
        const store = battleStore.get();
        // Un snapshot (resincronización) reemplaza el estado sin animar.
        if (store.state && store.state !== this.state && !store.animating && store.queue.length === 0 && !this.playing) {
            this.state = store.state;
            this.syncUnits(store.state);
        }
    }

    private myCombatant(): Combatant | null {
        const { you } = battleStore.get();
        return this.state && you ? (this.state.combatants[you] ?? null) : null;
    }

    private isMyTurn(): boolean {
        const store = battleStore.get();
        const phase = this.state?.phase;
        return (
            !this.playing &&
            !store.pending &&
            store.queue.length === 0 &&
            phase?.kind === "awaitingAction" &&
            phase.actorId === store.you
        );
    }

    private tileFromEvent(e: FederatedPointerEvent): Tile | null {
        if (!this.state) return null;
        const local = this.world.toLocal(e.global);
        const tile = { x: Math.floor(local.x / TILE), y: Math.floor(local.y / TILE) };
        if (tile.x < 0 || tile.y < 0 || tile.x >= this.state.grid.width || tile.y >= this.state.grid.height) return null;
        return tile;
    }

    private onPointerMove(e: FederatedPointerEvent): void {
        this.hover = this.tileFromEvent(e);
    }

    private onPointerTap(e: FederatedPointerEvent): void {
        if (e.button === 2) return;
        const tile = this.tileFromEvent(e);
        const me = this.myCombatant();
        if (!tile || !me || !this.state || !this.isMyTurn()) return;
        const mode = battleStore.get().mode;

        if (mode.kind === "move") {
            if (sameTile(tile, me.pos)) return;
            const path = pathTo(reachableTiles(this.state, me, me.res.mp), tile);
            if (!path || path.length === 0) return;
            battleStore.send({ kind: "action", action: { type: "move", actorId: me.id, path } });
            return;
        }

        const ability = ABILITIES[mode.abilityId];
        if (!ability) return;
        const error = checkTarget(this.state, me, ability, tile);
        if (error) {
            battleStore.receive({ kind: "notice", message: describeError(error) });
            return;
        }
        battleStore.send({ kind: "action", action: { type: "ability", actorId: me.id, abilityId: ability.id, target: tile } });
        battleStore.setMode({ kind: "move" });
    }

    private drawHighlights(): void {
        const g = this.highlights;
        g.clear();
        const state = this.state;
        if (!state) return;
        const pulse = 0.5 + Math.sin(this.highlightClock / 260) * 0.5;

        const phase = state.phase;
        if (phase.kind === "awaitingAction" || phase.kind === "turnStart") {
            const actor = state.combatants[phase.actorId];
            const view = actor && this.views.get(actor.id);
            if (actor && view) {
                const p = { x: view.root.x + TILE / 2, y: view.root.y + TILE - 3 };
                g.ellipse(p.x, p.y, 14 + pulse * 2, 6 + pulse).stroke({ color: actor.team === "heroes" ? 0xffd36b : 0xff6b6b, width: 1.5, alpha: 0.9 });
            }
        }

        const me = this.myCombatant();
        if (this.danger && !this.playing) this.drawDanger(g, state);

        // Como en Dofus: al pasar el mouse sobre un rival se ve hasta dónde camina y hasta dónde pega.
        const inspected = this.hoveredCombatant();
        if (inspected && inspected.team === "enemies" && !this.playing) this.drawThreat(g, state, inspected, pulse);

        if (!me || !me.alive || !this.isMyTurn()) {
            if (this.hover) g.rect(this.hover.x * TILE + 0.5, this.hover.y * TILE + 0.5, TILE - 1, TILE - 1).stroke({ color: 0xffffff, alpha: 0.25, width: 1 });
            return;
        }

        const mode = battleStore.get().mode;
        if (mode.kind === "move") {
            const reach = reachableTiles(state, me, me.res.mp);
            const danger = this.dangerFor(state);
            for (const node of reach.values()) {
                if (sameTile(node.tile, me.pos)) continue;
                g.rect(node.tile.x * TILE + 1, node.tile.y * TILE + 1, TILE - 2, TILE - 2).fill({ color: 0x4fb2ff, alpha: 0.18 + pulse * 0.08 });
                // Puntitos rojos: cuántos rivales te pueden pegar si terminás el turno en esa casilla.
                const foes = Math.min(4, danger.get(tileKey(node.tile)) ?? 0);
                for (let i = 0; i < foes; i++) g.circle(node.tile.x * TILE + 5 + i * 5, node.tile.y * TILE + 5, 1.8).fill({ color: 0xff4a4a, alpha: 0.95 });
            }
            if (this.hover && reach.has(tileKey(this.hover))) {
                const path = pathTo(reach, this.hover) ?? [];
                for (const step of path) {
                    const c = center(step);
                    g.circle(c.x, c.y, 3).fill({ color: 0xbfe6ff, alpha: 0.9 });
                }
                g.rect(this.hover.x * TILE + 1, this.hover.y * TILE + 1, TILE - 2, TILE - 2).stroke({ color: 0xbfe6ff, width: 1.5 });
            }
            return;
        }

        const ability = ABILITIES[mode.abilityId];
        if (!ability) return;
        for (let y = 0; y < state.grid.height; y++) {
            for (let x = 0; x < state.grid.width; x++) {
                const t = { x, y };
                const d = manhattan(me.pos, t);
                if (d < ability.minRange || d > ability.maxRange) continue;
                const ok = checkTarget(state, me, ability, t) === null;
                g.rect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2).fill({
                    color: ok ? 0xffb347 : 0x8a6a40,
                    alpha: ok ? 0.2 + pulse * 0.1 : 0.1,
                });
            }
        }
        if (this.hover && checkTarget(state, me, ability, this.hover) === null) {
            const color = abilityColor(ability);
            for (const t of areaTiles(state, me, ability, this.hover)) {
                g.rect(t.x * TILE + 1, t.y * TILE + 1, TILE - 2, TILE - 2).fill({ color, alpha: 0.35 }).stroke({ color, width: 1, alpha: 0.9 });
            }
        }
    }

    private zoneFor(state: BattleState, unit: Combatant): ThreatZone {
        let entry = this.threatCache.get(state);
        if (!entry) {
            entry = { zones: new Map() };
            this.threatCache.set(state, entry);
        }
        let zone = entry.zones.get(unit.id);
        if (!zone) {
            zone = threatZone(state, unit);
            entry.zones.set(unit.id, zone);
        }
        return zone;
    }

    private dangerFor(state: BattleState): Map<string, number> {
        let entry = this.threatCache.get(state);
        if (!entry) {
            entry = { zones: new Map() };
            this.threatCache.set(state, entry);
        }
        entry.danger ??= dangerMap(state, "enemies");
        return entry.danger;
    }

    /** Mapa de peligro: más rojo cuantos más rivales pueden atacar la casilla en su próximo turno. */
    private drawDanger(g: Graphics, state: BattleState): void {
        const tones = [0, 0xffc04a, 0xff8a3a, 0xff4a3a, 0xd01a4a];
        for (const [key, count] of this.dangerFor(state)) {
            const [x, y] = key.split(",").map(Number);
            const level = Math.min(4, count);
            g.rect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2).fill({ color: tones[level], alpha: 0.1 + level * 0.07 });
        }
    }

    private drawThreat(g: Graphics, state: BattleState, enemy: Combatant, pulse: number): void {
        const zone = this.zoneFor(state, enemy);
        const moves = new Set(zone.move.map(tileKey));
        for (const t of zone.attack) {
            if (moves.has(tileKey(t))) continue;
            g.rect(t.x * TILE + 1, t.y * TILE + 1, TILE - 2, TILE - 2).fill({ color: 0xff9a3a, alpha: 0.24 });
        }
        for (const t of zone.move) {
            g.rect(t.x * TILE + 1, t.y * TILE + 1, TILE - 2, TILE - 2).fill({ color: 0xff4a4a, alpha: 0.32 });
        }
        // Los héroes que quedan al alcance se marcan con un anillo rojo que late.
        const reachable = new Set(zone.attack.map(tileKey));
        for (const c of Object.values(state.combatants)) {
            if (!c.alive || c.team === enemy.team || !reachable.has(tileKey(c.pos))) continue;
            const p = { x: c.pos.x * TILE + TILE / 2, y: c.pos.y * TILE + TILE - 3 };
            g.ellipse(p.x, p.y, 15 + pulse * 2, 7 + pulse).stroke({ color: 0xff3a3a, width: 2, alpha: 0.95 });
        }
    }

    /** Enciende o apaga el mapa de peligro. */
    setDanger(on: boolean): void {
        this.danger = on;
    }

    /** Ficha de amenaza del rival bajo el cursor: hasta dónde llega y cuánto te pega el próximo turno. */
    hoverThreat(): { unitId: string; zone: ThreatZone; against: ThreatAgainst | null } | null {
        const state = this.state;
        const unit = this.hoveredCombatant();
        if (!state || !unit || unit.team !== "enemies") return null;
        const me = this.myCombatant();
        const zone = this.zoneFor(state, unit);
        return { unitId: unit.id, zone, against: me && me.alive ? threatAgainst(state, unit, me) : null };
    }

    /** Cuánto daño te quita Acorralado ahora mismo (0 a 0.3). */
    myGuard(): number {
        const me = this.myCombatant();
        return this.state && me && me.alive ? crowdGuard(this.state, me) : 0;
    }

    private hoveredCombatant(): Combatant | null {
        if (!this.state || !this.hover) return null;
        return Object.values(this.state.combatants).find((c) => c.alive && sameTile(c.pos, this.hover!)) ?? null;
    }

    /** Ficha del combatiente bajo el cursor, para el HUD. */
    hoverInfo(): Combatant | null {
        return this.hoveredCombatant();
    }

    /** Augurio para la habilidad elegida sobre el combatiente bajo el cursor (lo muestra el HUD). */
    previewForecast(): { target: Combatant; forecast: Forecast; abilityName: string } | null {
        const state = this.state;
        const me = this.myCombatant();
        const mode = battleStore.get().mode;
        if (!state || !me || !this.hover || mode.kind !== "ability") return null;
        const ability = ABILITIES[mode.abilityId];
        if (!ability) return null;
        const target = Object.values(state.combatants).find((c) => c.alive && sameTile(c.pos, this.hover!));
        if (!target || checkTarget(state, me, ability, target.pos)) return null;
        const forecast = forecastAbility(me, target, ability, state);
        return forecast ? { target, forecast, abilityName: ability.name } : null;
    }

    /* ---------------------------- animación ---------------------------- */

    private async playNext(): Promise<void> {
        if (!this.state) return;
        const batch = battleStore.get().queue.length > 0 ? battleStore.takeBatch() : null;
        if (!batch) return;
        this.playing = true;
        try {
            await this.playBatch(batch);
        } catch (error) {
            console.error("[battle] error animando eventos", error);
        }
        this.state = batch.state;
        this.syncUnits(batch.state);
        this.playing = false;
        battleStore.finishBatch(batch.state);
    }

    private async playBatch(batch: BattleBatch): Promise<void> {
        for (const event of batch.events) {
            if (this.destroyed) return;
            await this.playEvent(event, batch.state);
        }
    }

    private nameOf(id: string, state: BattleState): string {
        return state.combatants[id]?.name ?? this.state?.combatants[id]?.name ?? id;
    }

    private async playEvent(event: BattleEvent, after: BattleState): Promise<void> {
        const you = battleStore.get().you;
        switch (event.t) {
            case "battleStarted":
                this.postFx.flash([1, 0.85, 0.55], 0.35);
                await this.banner("¡Combate!", 0xffd36b, 900);
                return;
            case "roundStarted":
                battleStore.pushLog(`— Ronda ${event.round} —`, "warn");
                await this.banner(`Ronda ${event.round}`, 0xe8e2ff, 650);
                return;
            case "turnStarted": {
                const mine = event.actorId === you;
                if (this.state) this.state = { ...this.state, phase: { kind: "turnStart", actorId: event.actorId } };
                if (mine) {
                    this.postFx.flash([1, 0.95, 0.7], 0.18);
                    await this.banner("Tu turno", 0xffe08a, 520);
                } else {
                    await this.wait(160);
                }
                return;
            }
            case "moved": {
                const view = this.views.get(event.actorId);
                if (!view) return;
                view.body.setWalking(true);
                let from = { x: view.root.x / TILE, y: view.root.y / TILE };
                for (const step of event.path) {
                    const dx = step.x - from.x;
                    const dy = step.y - from.y;
                    await view.body.setHeading(dx > 0 ? 3 : dx < 0 ? 4 : dy < 0 ? 1 : 2);
                    const start = { ...from };
                    await this.tween(STEP_MS, (t) => this.placeUnit(view, { x: start.x + dx * t, y: start.y + dy * t }));
                    from = step;
                }
                view.body.setWalking(false);
                void view.body.setHeading(event.heading);
                return;
            }
            case "faced":
                await this.views.get(event.actorId)?.body.setHeading(event.heading);
                return;
            case "abilityCast":
                await this.playCast(event, after);
                return;
            case "itemUsed": {
                const view = this.views.get(event.targetId);
                if (!view) return;
                const c = this.viewCenter(view);
                const color = event.item === "pocionVida" ? 0xff5f7a : 0x5fa8ff;
                this.particles.burst(c.x, c.y + 6, { count: 26, color, speed: [20, 60], life: [400, 800], scale: [0.08, 0.16], gravity: -90, angle: -Math.PI / 2, spread: 1.4 });
                battleStore.pushLog(`${this.nameOf(event.actorId, after)} usa ${event.item === "pocionVida" ? "una poción roja" : "una poción azul"}.`, "good");
                await this.wait(350);
                return;
            }
            case "damaged": {
                const view = this.views.get(event.targetId);
                if (!view) return;
                view.hp = event.hpLeft;
                this.drawBars(view);
                const c = this.viewCenter(view);
                const color = SCHOOL_COLOR[event.school];
                this.particles.burst(c.x, c.y, { count: event.crit ? 34 : 16, color, speed: [40, 130], life: [220, 520], scale: [0.05, 0.12] });
                this.hitFlash(view);
                if (event.crit) {
                    this.shake = Math.max(this.shake, 0.9);
                    this.postFx.aberration(0.9);
                }
                const flank = event.flank === "back" ? " (espalda)" : event.flank === "side" ? " (flanco)" : "";
                this.floatText(c.x, c.y - 18, `${event.crit ? "¡" : ""}-${event.amount}${event.crit ? "!" : ""}`, event.crit ? 0xffd04a : 0xff6b6b, event.crit ? 15 : 12);
                battleStore.pushLog(
                    `${this.nameOf(event.sourceId, after)} daña a ${this.nameOf(event.targetId, after)}: ${event.amount}${event.crit ? " crítico" : ""}${flank}.`,
                    event.targetId === you ? "bad" : "info",
                );
                await this.wait(260);
                return;
            }
            case "healed": {
                const view = this.views.get(event.targetId);
                if (!view) return;
                view.hp = event.hpLeft;
                this.drawBars(view);
                const c = this.viewCenter(view);
                this.particles.burst(c.x, c.y + 8, { count: 22, color: 0x8dffb0, speed: [15, 50], life: [500, 900], scale: [0.06, 0.12], gravity: -70, angle: -Math.PI / 2, spread: 1.2 });
                this.floatText(c.x, c.y - 18, `+${event.amount}`, 0x7dff9e, 12);
                battleStore.pushLog(`${this.nameOf(event.targetId, after)} recupera ${event.amount} de vida.`, "good");
                await this.wait(240);
                return;
            }
            case "missed": {
                const view = this.views.get(event.targetId);
                if (!view) return;
                const c = this.viewCenter(view);
                this.floatText(c.x, c.y - 18, "Falla", 0xcfd6e6, 11);
                await this.tween(220, (t) => {
                    view.body.view.x = Math.sin(t * Math.PI) * 6;
                });
                battleStore.pushLog(`${this.nameOf(event.sourceId, after)} falla contra ${this.nameOf(event.targetId, after)}.`);
                return;
            }
            case "statusApplied": {
                const view = this.views.get(event.targetId);
                const def = STATUSES[event.status];
                if (!view || !def) return;
                const c = this.viewCenter(view);
                const color = def.kind === "buff" ? 0x9de6ff : 0xd28cff;
                this.floatText(c.x, c.y - 28, def.name, color, 10);
                this.particles.burst(c.x, c.y, { count: 12, color, speed: [10, 40], life: [400, 700], scale: [0.05, 0.1], gravity: -40 });
                battleStore.pushLog(`${this.nameOf(event.targetId, after)}: ${def.name} (${event.turns} t).`, def.kind === "buff" ? "good" : "warn");
                await this.wait(180);
                return;
            }
            case "statusResisted": {
                const view = this.views.get(event.targetId);
                if (!view) return;
                const c = this.viewCenter(view);
                this.floatText(c.x, c.y - 28, "Resiste", 0xe8e8e8, 10);
                await this.wait(160);
                return;
            }
            case "statusExpired": {
                const def = STATUSES[event.status];
                if (def) battleStore.pushLog(`${this.nameOf(event.targetId, after)} ya no está ${def.name.toLowerCase()}.`);
                return;
            }
            case "meditated": {
                const view = this.views.get(event.actorId);
                if (!view) return;
                const c = this.viewCenter(view);
                const light = this.lights?.add(c.x, c.y, 70, 0x5fa8ff, { alpha: 1, lifeMs: 900 });
                void light;
                this.particles.burst(c.x, c.y + 10, { count: 30, color: 0x6fb6ff, speed: [10, 40], life: [600, 1100], scale: [0.05, 0.1], gravity: -60 });
                this.floatText(c.x, c.y - 18, `+${event.manaGained} maná`, 0x8cc6ff, 11);
                battleStore.pushLog(`${this.nameOf(event.actorId, after)} medita (+${event.manaGained} maná).`, "good");
                await this.wait(500);
                return;
            }
            case "defended": {
                const view = this.views.get(event.actorId);
                if (!view) return;
                const c = this.viewCenter(view);
                this.lights?.add(c.x, c.y, 50, 0xc8d8ff, { alpha: 1, lifeMs: 600 });
                this.floatText(c.x, c.y - 28, "En guardia", 0xc8d8ff, 10);
                battleStore.pushLog(`${this.nameOf(event.actorId, after)} se pone en guardia.`);
                await this.wait(300);
                return;
            }
            case "riposted": {
                const view = this.views.get(event.actorId);
                if (!view) return;
                const c = this.viewCenter(view);
                this.lights?.add(c.x, c.y, 55, 0xffd36b, { alpha: 1, lifeMs: 500 });
                this.floatText(c.x, c.y - 28, "¡Represalia!", 0xffd36b, 11);
                battleStore.pushLog(`${this.nameOf(event.actorId, after)} devuelve el golpe a ${this.nameOf(event.targetId, after)}.`, "warn");
                await this.wait(250);
                return;
            }
            case "died": {
                const view = this.views.get(event.targetId);
                if (!view) return;
                const c = this.viewCenter(view);
                this.particles.burst(c.x, c.y, { count: 40, color: 0x8a1e2a, speed: [30, 110], life: [400, 900], scale: [0.06, 0.14], gravity: 120 });
                this.postFx.flash([0.6, 0.05, 0.08], 0.22);
                this.setAlive(view, false, true);
                battleStore.pushLog(`${this.nameOf(event.targetId, after)} cae.`, event.targetId === you ? "bad" : "good");
                await this.wait(480);
                return;
            }
            case "revived": {
                const view = this.views.get(event.targetId);
                if (!view) return;
                view.hp = event.hp;
                this.setAlive(view, true, true);
                this.drawBars(view);
                const c = this.viewCenter(view);
                this.lights?.add(c.x, c.y, 110, 0xfff1a8, { alpha: 1, lifeMs: 1200 });
                this.postFx.flash([1, 0.97, 0.8], 0.35);
                this.particles.burst(c.x, c.y + 10, { count: 50, color: 0xfff1a8, speed: [20, 70], life: [700, 1300], scale: [0.06, 0.14], gravity: -80 });
                battleStore.pushLog(`¡${this.nameOf(event.targetId, after)} vuelve a la vida!`, "good");
                await this.wait(600);
                return;
            }
            case "battleEnded": {
                const won = event.winner === "heroes";
                if (won) {
                    this.postFx.flash([1, 0.9, 0.6], 0.5);
                    await this.banner("¡Victoria!", 0xffd36b, 1300);
                } else {
                    this.postFx.setMood([0.8, 0.8, 0.9], 0.3);
                    await this.banner(event.winner === "draw" ? "Empate" : "Derrota", 0xff8080, 1300);
                }
                return;
            }
            case "pushed": {
                const view = this.views.get(event.targetId);
                if (!view) return;
                let from = { x: view.root.x / TILE, y: view.root.y / TILE };
                for (const step of event.path) {
                    const start = { ...from };
                    const dx = step.x - start.x;
                    const dy = step.y - start.y;
                    const c = this.viewCenter(view);
                    this.particles.burst(c.x, c.y + 12, { count: 6, color: 0xc8b48a, speed: [10, 40], life: [200, 420], scale: [0.04, 0.08] });
                    await this.tween(95, (t) => this.placeUnit(view, { x: start.x + dx * ease.outCubic(t), y: start.y + dy * ease.outCubic(t) }));
                    from = step;
                }
                if (event.collided) {
                    const c = this.viewCenter(view);
                    this.shake = Math.max(this.shake, 0.8);
                    this.particles.burst(c.x, c.y, { count: 24, color: 0xe8d8b0, speed: [40, 120], life: [200, 500], scale: [0.05, 0.1] });
                    this.floatText(c.x, c.y - 30, "¡Choque!", 0xffc46b, 10);
                }
                battleStore.pushLog(
                    `${this.nameOf(event.targetId, after)} sale despedido${event.collided ? " y choca" : ""}.`,
                    event.targetId === you ? "bad" : "info",
                );
                await this.wait(120);
                return;
            }
            case "teleported": {
                const view = this.views.get(event.actorId);
                if (!view) return;
                const a = center(event.from);
                this.particles.burst(a.x, a.y - 6, { count: 30, color: 0xb98cff, speed: [20, 80], life: [300, 600], scale: [0.05, 0.11] });
                this.lights?.add(a.x, a.y, 60, 0xb98cff, { alpha: 1, lifeMs: 400 });
                await this.tween(160, (t) => {
                    view.root.alpha = 1 - t;
                });
                this.placeUnit(view, event.to);
                const b = center(event.to);
                this.particles.burst(b.x, b.y - 6, { count: 30, color: 0xb98cff, speed: [20, 80], life: [300, 600], scale: [0.05, 0.11] });
                this.lights?.add(b.x, b.y, 60, 0xb98cff, { alpha: 1, lifeMs: 400 });
                this.postFx.aberration(0.6);
                await this.tween(160, (t) => {
                    view.root.alpha = t;
                });
                battleStore.pushLog(`${this.nameOf(event.actorId, after)} se desvanece y reaparece.`);
                return;
            }
            case "placed":
            case "resources":
            case "turnEnded":
                return;
        }
    }

    private async playCast(event: Extract<BattleEvent, { t: "abilityCast" }>, after: BattleState): Promise<void> {
        const ability = ABILITIES[event.abilityId];
        const caster = this.views.get(event.actorId);
        if (!caster) return;
        const color = abilityColor(ability);
        const from = this.viewCenter(caster);
        const to = center(event.target);
        const distance = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
        battleStore.pushLog(`${this.nameOf(event.actorId, after)} usa ${ability?.name ?? event.abilityId}.`);

        // Pequeño impulso hacia el objetivo y luz de canalización.
        const castLight = this.lights?.add(from.x, from.y, 60, color, { alpha: 1, lifeMs: 500 });
        void castLight;
        const dirX = Math.sign(to.x - from.x);
        const dirY = Math.sign(to.y - from.y);
        await this.tween(140, (t) => {
            const k = Math.sin(t * Math.PI) * 4;
            caster.body.view.position.set(dirX * k, dirY * k);
        });

        const isWeapon = ability?.effects.some((e) => e.kind === "weapon") ?? false;
        if (distance > TILE * 1.5) {
            // Proyectil: un orbe con estela de partículas y su propia luz.
            const orb = new Sprite(getGlowTexture());
            orb.anchor.set(0.5);
            orb.tint = color;
            orb.blendMode = "add";
            orb.scale.set(isWeapon ? 0.12 : 0.22);
            this.fxLayer.addChild(orb);
            const light = this.lights?.add(from.x, from.y, 55, color, { alpha: 1 });
            const duration = Math.min(520, 120 + distance * 2.2);
            await this.tween(duration, (t) => {
                const k = ease.inOutCubic(t);
                const x = from.x + (to.x - from.x) * k;
                const y = from.y + (to.y - from.y) * k - Math.sin(t * Math.PI) * (isWeapon ? 10 : 4);
                orb.position.set(x, y);
                light?.sprite.position.set(x, y);
                this.particles.burst(x, y, { count: 2, color, speed: [5, 20], life: [150, 320], scale: [0.04, 0.08] });
            });
            orb.destroy();
            if (light) this.lights?.remove(light);
        }

        // Impacto: animación original del hechizo (fxGrh), destello de luz y partículas.
        const tiles = event.tiles.length > 0 ? event.tiles : [event.target];
        const big = tiles.length >= 5;
        const spellFx = ability?.spellId ? this.dbs?.spells[String(ability.spellId)]?.fxGrh : undefined;
        for (const tile of tiles) {
            const c = center(tile);
            this.particles.burst(c.x, c.y, { count: big ? 14 : 22, color, speed: [30, 110], life: [250, 600], scale: [0.05, 0.13] });
            if (spellFx) void this.playSpellFx(spellFx, tile);
        }
        this.lights?.add(to.x, to.y, big ? 150 : 80, color, { alpha: 1, lifeMs: big ? 900 : 450 });
        if (big) {
            const global = this.world.toGlobal(to);
            const res = this.app.renderer.resolution;
            this.postFx.shockwave(global.x * res, global.y * res, 750);
            this.postFx.aberration(1.2);
            this.postFx.flash([1, 0.75, 0.45], 0.35);
            this.shake = 1.2;
        } else if (!isWeapon && ability?.hostile) {
            this.postFx.aberration(0.4);
        }
        await this.wait(spellFx ? 280 : 160);
    }

    private async playSpellFx(fxId: number, tile: Tile): Promise<void> {
        const sprite = await createSpellFx(this.dbs!, fxId);
        if (!sprite || this.destroyed) return;
        sprite.x += tile.x * TILE;
        sprite.y += tile.y * TILE;
        sprite.onComplete = () => sprite.destroy();
        this.fxLayer.addChild(sprite);
        sprite.play();
        // Por si el gráfico no dispara onComplete (un solo cuadro), se limpia igual.
        void this.wait(1500).then(() => {
            if (!sprite.destroyed) sprite.destroy();
        });
    }

    private viewCenter(view: UnitView): { x: number; y: number } {
        return { x: view.root.x + TILE / 2, y: view.root.y + TILE / 2 - 6 };
    }

    private hitFlash(view: UnitView): void {
        const parts = view.body.view;
        void this.tween(260, (t) => {
            parts.tint = t < 0.5 ? 0xff7070 : 0xffffff;
            parts.x = Math.sin(t * Math.PI * 4) * 2 * (1 - t);
        }).then(() => {
            parts.tint = 0xffffff;
            parts.x = 0;
        });
    }

    private floatText(x: number, y: number, text: string, color: number, size: number): void {
        const label = new Text({
            text,
            style: {
                fontFamily: "Georgia, serif",
                fontSize: size * 2,
                fontWeight: "bold",
                fill: color,
                stroke: { color: 0x000000, width: 4 },
            },
        });
        label.anchor.set(0.5);
        label.scale.set(0.5);
        label.position.set(x, y);
        this.textLayer.addChild(label);
        void this.tween(900, (t) => {
            label.y = y - ease.outCubic(t) * 18;
            label.alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
            label.scale.set(0.5 * (t < 0.15 ? 0.6 + ease.outBack(t / 0.15) * 0.4 : 1));
        }).then(() => label.destroy());
    }

    private async banner(text: string, color: number, holdMs: number): Promise<void> {
        const label = new Text({
            text,
            style: {
                fontFamily: "Georgia, serif",
                fontSize: 44,
                fontWeight: "bold",
                fill: color,
                stroke: { color: 0x000000, width: 6 },
                dropShadow: { color: 0x000000, blur: 12, distance: 0, alpha: 0.8 },
                letterSpacing: 2,
            },
        });
        label.anchor.set(0.5);
        label.position.set(this.app.screen.width / 2, this.app.screen.height * 0.42);
        label.alpha = 0;
        this.ui.addChild(label);
        await this.tween(240, (t) => {
            label.alpha = t;
            label.scale.set(1.3 - ease.outCubic(t) * 0.3);
        });
        await this.wait(holdMs * 0.6);
        await this.tween(240, (t) => {
            label.alpha = 1 - t;
        });
        label.destroy();
    }
}
