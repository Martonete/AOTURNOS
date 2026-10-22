import type { AbilityId, Combatant, StatusId } from "../battle/types";

export type EnemyTemplate = {
    id: string;
    name: string;
    /** Id en la tabla game_npcs, de donde salen los valores base. */
    npcIndex: number;
    level: number;
    hp: number;
    mana: number;
    hitMin: number;
    hitMax: number;
    /** poderAtaque / poderEvasion de game_npcs. */
    attackPower: number;
    evasion: number;
    /** def de game_npcs. */
    defense: number;
    magicResist: number;
    agilidad: number;
    maxMp: number;
    abilities: AbilityId[];
    archetype: Combatant["archetype"];
    tags: Combatant["tags"];
    immunities: StatusId[];
    appearance: Combatant["appearance"];
    /** Experiencia y oro que aporta al encuentro. */
    exp: number;
    gold: number;
};

const npc = (body: number): Combatant["appearance"] => ({ body, head: 0, weapon: 0, shield: 0, helmet: 0 });

/** Plantillas tácticas tomadas de game_npcs (database/aoweb.sql). */
export const ENEMIES: Record<string, EnemyTemplate> = {
    lobo: {
        id: "lobo",
        name: "Lobo",
        npcIndex: 501,
        level: 3,
        hp: 75,
        mana: 0,
        hitMin: 4,
        hitMax: 18,
        attackPower: 80,
        evasion: 25,
        defense: 8,
        magicResist: 0,
        agilidad: 20,
        maxMp: 5,
        abilities: ["mordida"],
        archetype: "melee",
        tags: [],
        immunities: [],
        appearance: npc(10),
        exp: 100,
        gold: 0,
    },
    esqueleto: {
        id: "esqueleto",
        name: "Esqueleto",
        npcIndex: 503,
        level: 2,
        hp: 50,
        mana: 0,
        hitMin: 3,
        hitMax: 10,
        attackPower: 30,
        evasion: 30,
        defense: 10,
        magicResist: 0,
        agilidad: 12,
        maxMp: 3,
        abilities: ["golpe"],
        archetype: "melee",
        tags: ["undead"],
        immunities: ["envenenado"],
        appearance: npc(12),
        exp: 47,
        gold: 10,
    },
    goblin: {
        id: "goblin",
        name: "Goblin",
        npcIndex: 505,
        level: 4,
        hp: 110,
        mana: 0,
        hitMin: 4,
        hitMax: 12,
        attackPower: 60,
        evasion: 40,
        defense: 15,
        magicResist: 0,
        agilidad: 18,
        maxMp: 4,
        abilities: ["golpe"],
        archetype: "melee",
        tags: [],
        immunities: [],
        appearance: npc(14),
        exp: 95,
        gold: 15,
    },
    orco: {
        id: "orco",
        name: "Orco",
        npcIndex: 522,
        level: 10,
        hp: 350,
        mana: 0,
        hitMin: 5,
        hitMax: 35,
        attackPower: 100,
        evasion: 75,
        defense: 30,
        magicResist: 0,
        agilidad: 14,
        maxMp: 3,
        abilities: ["golpe"],
        archetype: "melee",
        tags: [],
        immunities: [],
        appearance: npc(185),
        exp: 395,
        gold: 44,
    },
    orco_brujo: {
        id: "orco_brujo",
        name: "Orco Brujo",
        npcIndex: 549,
        level: 14,
        // En game_npcs tiene 1900 PV pensados para el mundo abierto; en la grilla es un lanzador.
        hp: 260,
        mana: 600,
        hitMin: 10,
        hitMax: 25,
        attackPower: 90,
        evasion: 60,
        defense: 20,
        magicResist: 10,
        agilidad: 15,
        maxMp: 3,
        abilities: ["golpe", "proyectil_magico", "toxina"],
        archetype: "caster",
        tags: [],
        immunities: [],
        appearance: npc(186),
        exp: 600,
        gold: 80,
    },
};
