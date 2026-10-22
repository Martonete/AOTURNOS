import { CLASSES } from "../data/classes";
import { ENEMIES } from "../data/enemies";
import { seedFromString } from "./rng";
import type { BattleGrid, BattleState, ClassId, Combatant, ItemKind, Team, Tile } from "./types";

export type HeroInput = {
    /** Id de RuntimeCharacter en el server. */
    characterId: string;
    name: string;
    classId: ClassId;
    level: number;
    controller?: "player" | "ai";
    /** Apariencia real del personaje; si falta se usa la de la clase. */
    appearance?: Partial<Combatant["appearance"]>;
    /** PV y mana actuales del personaje; si faltan entra al máximo. */
    hp?: number;
    mana?: number;
    consumables?: Partial<Record<ItemKind, number>>;
};

const BASE_AP = 6;
const STAMINA_MAX = 100;

/** Construye un combatiente de una de las cuatro clases a partir del nivel. */
export function createHero(input: HeroInput, team: Team = "heroes"): Combatant {
    const cls = CLASSES[input.classId];
    const level = Math.max(1, Math.min(50, Math.floor(input.level)));
    const growth = level / 10;
    const attrs = {
        fuerza: cls.baseAttrs.fuerza + Math.floor(growth),
        agilidad: cls.baseAttrs.agilidad + Math.floor(growth),
        inteligencia: cls.baseAttrs.inteligencia + Math.floor(growth),
        constitucion: cls.baseAttrs.constitucion,
    };
    const maxHp = Math.round(20 + level * cls.vida * (1 + (attrs.constitucion - 14) / 40));
    const maxMana = cls.multMana > 0 ? Math.round(attrs.inteligencia * 3 + level * cls.multMana * attrs.inteligencia * 0.95) : 0;
    const hitMin = Math.round(cls.weapon.min + level * cls.weapon.perLevel * 0.5);
    const hitMax = Math.round(cls.weapon.max + level * cls.weapon.perLevel);

    return {
        id: `hero:${input.characterId}`,
        name: input.name,
        team,
        source: { kind: "character", characterId: input.characterId },
        classId: cls.id,
        appearance: {
            ...cls.appearance,
            ...Object.fromEntries(Object.entries(input.appearance ?? {}).filter(([, v]) => typeof v === "number" && v > 0)),
        },
        pos: { x: 0, y: 0 },
        heading: team === "heroes" ? 1 : 2,
        res: {
            hp: Math.min(maxHp, input.hp ?? maxHp),
            maxHp,
            mana: Math.min(maxMana, input.mana ?? maxMana),
            maxMana,
            stamina: cls.usesStamina ? STAMINA_MAX : 0,
            maxStamina: cls.usesStamina ? STAMINA_MAX : 0,
            ap: BASE_AP,
            maxAp: BASE_AP,
            mp: cls.maxMp,
            maxMp: cls.maxMp,
        },
        stats: {
            level,
            ...attrs,
            hitMin,
            hitMax,
            attackPower: Math.round((60 + attrs.agilidad * 3 + level) * cls.modAtaque),
            evasion: Math.round((40 + attrs.agilidad * 2) * cls.modEvasion),
            defense: cls.defense + Math.floor(level / 4),
            magicResist: cls.modResistenciaMagica,
            magicDamageMod: cls.modDmgMagia,
            physicalDamageMod: cls.modDmg,
        },
        abilities: cls.abilities.filter((a) => a.level <= level).map((a) => a.id),
        statuses: [],
        cooldowns: {},
        consumables: { pocionVida: 2, pocionMana: cls.multMana > 0 ? 2 : 0, ...input.consumables },
        tags: [...cls.tags],
        immunities: [],
        controller: input.controller ?? "player",
        archetype: cls.archetype,
        alive: true,
        usesThisBattle: {},
        movedThisTurn: false,
    };
}

export function createEnemy(templateId: string, index: number, team: Team = "enemies"): Combatant {
    const t = ENEMIES[templateId];
    if (!t) throw new Error(`Plantilla de enemigo desconocida: ${templateId}`);
    return {
        id: `npc:${templateId}:${index}`,
        name: t.name,
        team,
        source: { kind: "npc", templateId },
        appearance: { ...t.appearance },
        pos: { x: 0, y: 0 },
        heading: team === "heroes" ? 1 : 2,
        res: {
            hp: t.hp,
            maxHp: t.hp,
            mana: t.mana,
            maxMana: t.mana,
            stamina: 0,
            maxStamina: 0,
            ap: BASE_AP,
            maxAp: BASE_AP,
            mp: t.maxMp,
            maxMp: t.maxMp,
        },
        stats: {
            level: t.level,
            fuerza: 10,
            agilidad: t.agilidad,
            inteligencia: 10,
            constitucion: 10,
            hitMin: t.hitMin,
            hitMax: t.hitMax,
            attackPower: t.attackPower,
            evasion: t.evasion,
            defense: t.defense,
            magicResist: t.magicResist,
            magicDamageMod: 1,
            physicalDamageMod: 1,
        },
        abilities: [...t.abilities],
        statuses: [],
        cooldowns: {},
        consumables: {},
        tags: [...t.tags],
        immunities: [...t.immunities],
        controller: "ai",
        archetype: t.archetype,
        alive: true,
        usesThisBattle: {},
        movedThisTurn: false,
    };
}

/** Grilla rectangular a partir de una lista de casillas bloqueadas. */
export function createGrid(
    width: number,
    height: number,
    opts: { blocked?: Tile[]; sightBlockers?: Tile[]; spawns?: Partial<Record<Team, Tile[]>>; origin?: BattleGrid["origin"] } = {},
): BattleGrid {
    const blocked = new Array<number>(width * height).fill(0);
    const blocksSight = new Array<number>(width * height).fill(0);
    for (const t of opts.blocked ?? []) blocked[t.y * width + t.x] = 1;
    for (const t of opts.sightBlockers ?? []) {
        blocked[t.y * width + t.x] = 1;
        blocksSight[t.y * width + t.x] = 1;
    }

    const defaultSpawns = (rows: number[]): Tile[] => {
        const out: Tile[] = [];
        for (const y of rows) {
            for (let x = 2; x < width - 2; x++) if (!blocked[y * width + x]) out.push({ x, y });
        }
        return out;
    };

    return {
        width,
        height,
        blocked,
        blocksSight,
        spawns: {
            heroes: opts.spawns?.heroes ?? defaultSpawns([height - 2, height - 3]),
            enemies: opts.spawns?.enemies ?? defaultSpawns([1, 2]),
        },
        origin: opts.origin,
    };
}

export type CreateBattleInput = {
    id: string;
    seed?: number;
    grid: BattleGrid;
    heroes: Combatant[];
    enemies: Combatant[];
    /** true deja la batalla en fase de colocación; si no, hay que llamar a engine.begin() igual. */
    placement?: boolean;
};

/** Ubica a cada bando en sus casillas iniciales y deja la batalla lista para engine.begin(). */
export function createBattle(input: CreateBattleInput): BattleState {
    const combatants: Record<string, Combatant> = {};
    const place = (list: Combatant[], spawns: Tile[]) => {
        // Reparte a los combatientes en el centro de la fila de spawn.
        const ordered = [...spawns].sort((a, b) => Math.abs(a.x - input.grid.width / 2) - Math.abs(b.x - input.grid.width / 2));
        list.forEach((c, i) => {
            const tile = ordered[i] ?? ordered[ordered.length - 1];
            c.pos = { ...tile };
            combatants[c.id] = c;
        });
    };
    place(input.heroes, input.grid.spawns.heroes);
    place(input.enemies, input.grid.spawns.enemies);

    return {
        id: input.id,
        rng: input.seed ?? seedFromString(input.id),
        grid: input.grid,
        combatants,
        round: 0,
        turnOrder: [],
        turnIndex: 0,
        phase: { kind: "placement" },
        version: 0,
    };
}
