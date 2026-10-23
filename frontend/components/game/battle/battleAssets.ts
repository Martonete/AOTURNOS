import { AnimatedSprite, Assets, Container, Rectangle, Sprite, Texture } from "pixi.js";
import type {
    BodiesDB,
    FXsDB,
    GraphicData,
    GraphicsDB,
    HeadsDB,
    HelmetsDB,
    MapData,
    ShieldsDB,
    SpellsDB,
    WeaponsDB,
} from "../../../types/game";
import {
    getTileAt,
    loadBodiesDB,
    loadFXsDB,
    loadGraphicsDB,
    loadHeadsDB,
    loadHelmetsDB,
    loadMapData,
    loadShieldsDB,
    loadSpellsDB,
    loadWeaponsDB,
} from "../../../utils/gameLoader";

export type BattleDBs = {
    graphics: GraphicsDB;
    bodies: BodiesDB;
    heads: HeadsDB;
    weapons: WeaponsDB;
    shields: ShieldsDB;
    helmets: HelmetsDB;
    fxs: FXsDB;
    spells: SpellsDB;
};

let dbPromise: Promise<BattleDBs> | null = null;

/** Las mismas bases de datos de gráficos que usa Engine.ts, cargadas una sola vez. */
export function loadBattleDBs(): Promise<BattleDBs> {
    dbPromise ??= Promise.all([
        loadGraphicsDB(),
        loadBodiesDB(),
        loadHeadsDB(),
        loadWeaponsDB(),
        loadShieldsDB(),
        loadHelmetsDB(),
        loadFXsDB(),
        loadSpellsDB(),
    ]).then(([graphics, bodies, heads, weapons, shields, helmets, fxs, spells]) => ({
        graphics,
        bodies,
        heads,
        weapons,
        shields,
        helmets,
        fxs,
        spells,
    }));
    return dbPromise;
}

const baseTextures = new Map<string, Promise<Texture | null>>();
const frameTextures = new Map<string, Promise<Texture[]>>();

function loadBaseTexture(numFile: string | number): Promise<Texture | null> {
    const key = String(numFile);
    let promise = baseTextures.get(key);
    if (!promise) {
        promise = (async () => {
            for (const path of [`/graphics/${key}.png`, `/static/graphics/${key}.png`, `/static/graficosbk/${key}.png`]) {
                try {
                    const texture = await Assets.load<Texture>(path);
                    texture.source.scaleMode = "nearest";
                    return texture;
                } catch {
                    // probar la siguiente ruta
                }
            }
            return null;
        })();
        baseTextures.set(key, promise);
    }
    return promise;
}

async function textureFor(data: GraphicData): Promise<Texture | null> {
    const base = await loadBaseTexture(data.numFile);
    if (!base) return null;
    return new Texture({ source: base.source, frame: new Rectangle(data.sX, data.sY, data.width, data.height) });
}

/** Cuadros de un gráfico: uno si es estático, todos si es animado (frames del graficos.json). */
export function loadGraphicFrames(dbs: Pick<BattleDBs, "graphics">, graphicId: number): Promise<Texture[]> {
    const key = String(graphicId);
    let promise = frameTextures.get(key);
    if (!promise) {
        promise = (async () => {
            const data = dbs.graphics[key];
            if (!data) return [];
            if (data.numFrames > 1 && data.frames) {
                const ids = Object.keys(data.frames)
                    .sort((a, b) => Number(a) - Number(b))
                    .map((k) => data.frames[k]);
                const textures = await Promise.all(
                    ids.map((id) => (dbs.graphics[String(id)] ? textureFor(dbs.graphics[String(id)]) : Promise.resolve(null))),
                );
                return textures.filter((t): t is Texture => Boolean(t));
            }
            const single = await textureFor(data);
            return single ? [single] : [];
        })();
        frameTextures.set(key, promise);
    }
    return promise;
}

export type Appearance = { body: number; head: number; weapon: number; shield: number; helmet: number };

/** Ciclo de caminata de los cuerpos de AO, en milisegundos por vuelta. */
const WALK_CYCLE_MS = 600;

/**
 * Personaje armado con las mismas piezas y offsets que CharacterSpritePreview y characterLayout:
 * cuerpo, cabeza, casco, arma y escudo, por dirección (1 arriba, 2 abajo, 3 derecha, 4 izquierda).
 */
export class BattleCharacterSprite {
    readonly view = new Container();
    private parts = new Container();
    private animated: AnimatedSprite[] = [];
    private heading = 2;
    private walking = false;
    private walkClock = 0;
    private buildToken = 0;

    constructor(
        private readonly dbs: BattleDBs,
        private readonly appearance: Appearance,
    ) {
        this.view.addChild(this.parts);
    }

    async setHeading(heading: number): Promise<void> {
        if (heading === this.heading && this.parts.children.length > 0) return;
        this.heading = heading;
        await this.build();
    }

    setWalking(walking: boolean): void {
        this.walking = walking;
        if (!walking) for (const sprite of this.animated) sprite.currentFrame = 0;
    }

    update(deltaMs: number): void {
        if (!this.walking) return;
        this.walkClock = (this.walkClock + deltaMs) % WALK_CYCLE_MS;
        for (const sprite of this.animated) {
            const frames = sprite.textures.length;
            if (frames > 1) sprite.currentFrame = Math.floor((this.walkClock / WALK_CYCLE_MS) * frames) % frames;
        }
    }

    async build(): Promise<void> {
        const token = ++this.buildToken;
        const dir = String(this.heading) as "1" | "2" | "3" | "4";
        const { dbs, appearance } = this;
        const bodyData = dbs.bodies[String(appearance.body)];
        const headData = appearance.head ? dbs.heads[String(appearance.head)] : undefined;
        const helmetData = appearance.helmet ? dbs.helmets[String(appearance.helmet)] : undefined;
        const weaponData = appearance.weapon ? dbs.weapons[String(appearance.weapon)] : undefined;
        const shieldData = appearance.shield ? dbs.shields[String(appearance.shield)] : undefined;

        const [body, head, helmet, weapon, shield] = await Promise.all([
            bodyData?.[dir] ? loadGraphicFrames(dbs, bodyData[dir]) : Promise.resolve([]),
            headData?.[dir] ? loadGraphicFrames(dbs, headData[dir]) : Promise.resolve([]),
            helmetData?.[dir] ? loadGraphicFrames(dbs, helmetData[dir]) : Promise.resolve([]),
            weaponData?.[dir] ? loadGraphicFrames(dbs, weaponData[dir]) : Promise.resolve([]),
            shieldData?.[dir] ? loadGraphicFrames(dbs, shieldData[dir]) : Promise.resolve([]),
        ]);
        if (token !== this.buildToken) return;

        const parts = new Container();
        const animated: AnimatedSprite[] = [];
        const add = (textures: Texture[], x: number, y: number) => {
            if (textures.length === 0) return;
            const sprite = new AnimatedSprite(textures);
            sprite.autoUpdate = false;
            sprite.currentFrame = 0;
            sprite.position.set(Math.round(x), Math.round(y));
            parts.addChild(sprite);
            if (textures.length > 1) animated.push(sprite);
        };

        let bodyMetrics = { x: 0, y: 0, width: 32, height: 32 };
        if (body.length > 0) {
            const t = body[0];
            bodyMetrics = { x: 16 - Math.floor((t.width * 16) / 32), y: 32 - Math.floor((t.height * 32) / 32), width: t.width, height: t.height };
        }
        const headPos = (w: number) => ({
            x: bodyMetrics.x + bodyMetrics.width / 2 - w / 2 + (bodyData?.headOffsetX ?? 0),
            y: bodyMetrics.y + bodyMetrics.height - 50 + (bodyData?.headOffsetY ?? 0),
        });
        const equipPos = (kind: "weapon" | "shield", t: Texture) => ({
            x: 16 - Math.floor((t.width * 16) / 32),
            y: (kind === "weapon" ? 28 : 32) - Math.floor((t.height * 32) / 32),
        });

        // Orden de dibujo según hacia dónde mira, como en el cliente original.
        const drawShieldFirst = this.heading === 1 || this.heading === 4;
        if (drawShieldFirst && shield[0]) add(shield, equipPos("shield", shield[0]).x, equipPos("shield", shield[0]).y);
        if (this.heading === 1 && weapon[0]) add(weapon, equipPos("weapon", weapon[0]).x, equipPos("weapon", weapon[0]).y);
        add(body, bodyMetrics.x, bodyMetrics.y);
        if (head[0]) add(head, headPos(head[0].width).x, headPos(head[0].width).y);
        if (helmet[0]) {
            const p = headPos(helmet[0].width);
            add(helmet, p.x + (helmetData?.offsetX ?? 0), p.y + (helmetData?.offsetY ?? 0));
        }
        if (this.heading !== 1 && weapon[0]) add(weapon, equipPos("weapon", weapon[0]).x, equipPos("weapon", weapon[0]).y);
        if (!drawShieldFirst && shield[0]) add(shield, equipPos("shield", shield[0]).x, equipPos("shield", shield[0]).y);

        this.view.removeChild(this.parts);
        this.parts.destroy({ children: true });
        this.parts = parts;
        this.animated = animated;
        this.view.addChildAt(parts, 0);
        if (this.walking) this.update(0);
    }

    destroy(): void {
        this.buildToken++;
        this.view.destroy({ children: true });
    }
}

/** Piso del recorte del mapa: capas 1 y 2 en su casilla, capa 3 (árboles, muros) anclada abajo. */
export async function buildMapDiorama(
    dbs: BattleDBs,
    origin: { map: number; x: number; y: number },
    width: number,
    height: number,
): Promise<{ floor: Container; props: Array<{ sprite: Sprite; row: number }> }> {
    const floor = new Container();
    const props: Array<{ sprite: Sprite; row: number }> = [];
    let mapData: MapData;
    try {
        mapData = await loadMapData(origin.map);
    } catch {
        return { floor, props };
    }

    const jobs: Promise<void>[] = [];
    for (let gy = -1; gy <= height; gy++) {
        for (let gx = -1; gx <= width; gx++) {
            const tile = getTileAt(mapData, origin.map, origin.x + gx, origin.y + gy);
            const graphics = tile?.graphics ?? {};
            for (const layer of ["1", "2", "3"] as const) {
                const grh = Number(graphics[layer] ?? 0);
                if (!grh) continue;
                jobs.push(
                    loadGraphicFrames(dbs, grh).then((frames) => {
                        if (frames.length === 0) return;
                        const sprite = new Sprite(frames[0]);
                        let x = gx * 32;
                        let y = gy * 32;
                        if (layer === "3") {
                            x += 16 - Math.floor((frames[0].width * 16) / 32);
                            y += 32 - frames[0].height;
                            sprite.position.set(x, y);
                            props.push({ sprite, row: gy });
                        } else {
                            sprite.position.set(x, y);
                            sprite.zIndex = layer === "1" ? 0 : 1;
                            floor.addChild(sprite);
                        }
                    }),
                );
            }
        }
    }
    await Promise.all(jobs);
    floor.sortableChildren = true;
    return { floor, props };
}

/** Animación de efecto original de AO (fxGrh de spells.json) en un AnimatedSprite que se reproduce una vez. */
export async function createSpellFx(dbs: BattleDBs, fxId: number): Promise<AnimatedSprite | null> {
    const fx = dbs.fxs[String(fxId)];
    if (!fx) return null;
    const frames = await loadGraphicFrames(dbs, fx.grh);
    if (frames.length === 0) return null;
    const sprite = new AnimatedSprite(frames);
    sprite.loop = false;
    sprite.animationSpeed = 0.35;
    sprite.blendMode = "add";
    sprite.position.set(16 - frames[0].width / 2 + (fx.offsetX ?? 0), 32 - frames[0].height + (fx.offsetY ?? 0));
    return sprite;
}
