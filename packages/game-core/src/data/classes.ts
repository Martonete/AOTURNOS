import type { AbilityId, ClassId, Combatant } from "../battle/types";

export type ClassDef = {
    id: ClassId;
    name: string;
    role: string;
    archetype: Combatant["archetype"];
    /** Vida por nivel (classProgress.vida en balanceData.ts). */
    vida: number;
    /** Multiplicador de mana (classProgress.multMana). 0 = no usa mana. */
    multMana: number;
    usesStamina: boolean;
    maxMp: number;
    /** Modificadores de balanceData.ts para esta clase. */
    modAtaque: number;
    modDmg: number;
    modDmgMagia: number;
    modEvasion: number;
    modResistenciaMagica: number;
    baseAttrs: { fuerza: number; agilidad: number; inteligencia: number; constitucion: number };
    /** Golpe base del arma inicial a nivel 1 y cuánto sube por nivel. */
    weapon: { min: number; max: number; perLevel: number };
    defense: number;
    /** Habilidades y el nivel en que se desbloquean. */
    abilities: Array<{ id: AbilityId; level: number }>;
    tags: Combatant["tags"];
    appearance: Combatant["appearance"];
};

/**
 * Las cuatro clases iniciales. Los modificadores salen de DEFAULT_BALANCE_DATA en
 * server/src/balanceData.ts (modAtaqueArmas/Proyectiles, modDmgArmas/Proyectiles,
 * modDmgMagia, modEvasion, modResistenciaMagica) y la apariencia de vars.charactersPvP.
 */
export const CLASSES: Record<ClassId, ClassDef> = {
    1: {
        id: 1,
        name: "Mago",
        role: "Daño mágico a distancia y control",
        archetype: "caster",
        vida: 7.5,
        multMana: 2.65,
        usesStamina: false,
        maxMp: 3,
        modAtaque: 0.5,
        modDmg: 0.5,
        modDmgMagia: 1,
        modEvasion: 0.2,
        modResistenciaMagica: 0,
        baseAttrs: { fuerza: 12, agilidad: 16, inteligencia: 21, constitucion: 14 },
        weapon: { min: 2, max: 5, perLevel: 0.15 },
        defense: 2,
        abilities: [
            { id: "golpe", level: 1 },
            { id: "dardo_magico", level: 1 },
            { id: "proyectil_magico", level: 1 },
            { id: "inmovilizar", level: 5 },
            { id: "tormenta_fuego", level: 10 },
            { id: "descarga_electrica", level: 15 },
            { id: "paralizar", level: 20 },
            { id: "apocalipsis", level: 25 },
        ],
        tags: ["staff"],
        appearance: { body: 56, head: 1, weapon: 10, shield: 0, helmet: 4 },
    },
    2: {
        id: 2,
        name: "Clérigo",
        role: "Curación y soporte",
        archetype: "support",
        vida: 8.5,
        multMana: 2,
        usesStamina: false,
        maxMp: 3,
        modAtaque: 0.98,
        modDmg: 0.85,
        modDmgMagia: 0.88,
        modEvasion: 0.8,
        modResistenciaMagica: 4,
        baseAttrs: { fuerza: 15, agilidad: 15, inteligencia: 18, constitucion: 16 },
        weapon: { min: 4, max: 9, perLevel: 0.4 },
        defense: 6,
        abilities: [
            { id: "golpe", level: 1 },
            { id: "curar_leves", level: 1 },
            { id: "fuerza", level: 1 },
            { id: "remover_paralisis", level: 1 },
            { id: "curar_graves", level: 8 },
            { id: "debilidad", level: 12 },
            { id: "celeridad", level: 16 },
            { id: "resucitar", level: 20 },
        ],
        tags: [],
        appearance: { body: 56, head: 1, weapon: 24, shield: 6, helmet: 6 },
    },
    8: {
        id: 8,
        name: "Paladín",
        role: "Primera línea: golpe fuerte y pocos hechizos de apoyo",
        archetype: "melee",
        vida: 10,
        multMana: 1,
        usesStamina: true,
        maxMp: 4,
        modAtaque: 1.03,
        modDmg: 1,
        modDmgMagia: 0.78,
        modEvasion: 0.85,
        modResistenciaMagica: 5,
        baseAttrs: { fuerza: 19, agilidad: 16, inteligencia: 14, constitucion: 19 },
        weapon: { min: 7, max: 14, perLevel: 0.8 },
        defense: 10,
        abilities: [
            { id: "golpe", level: 1 },
            { id: "embestida", level: 1 },
            { id: "curar_leves", level: 1 },
            { id: "provocar", level: 5 },
            { id: "remover_paralisis", level: 8 },
            { id: "golpe_brutal", level: 10 },
        ],
        tags: ["zoneOfControl"],
        appearance: { body: 107, head: 1, weapon: 13, shield: 6, helmet: 6 },
    },
    9: {
        id: 9,
        name: "Cazador",
        role: "Daño físico a distancia y remate",
        archetype: "ranged",
        vida: 10,
        multMana: 0,
        usesStamina: true,
        maxMp: 3,
        modAtaque: 0.95,
        modDmg: 0.93,
        modDmgMagia: 0,
        modEvasion: 0.9,
        modResistenciaMagica: 6,
        baseAttrs: { fuerza: 16, agilidad: 20, inteligencia: 12, constitucion: 16 },
        weapon: { min: 6, max: 12, perLevel: 0.7 },
        defense: 5,
        abilities: [
            { id: "golpe", level: 1 },
            { id: "disparo", level: 1 },
            { id: "flecha_elfica", level: 1 },
            { id: "disparo_inmovilizante", level: 1 },
            { id: "flecha_electrica", level: 10 },
            { id: "lluvia_flechas", level: 15 },
        ],
        tags: ["longShot"],
        appearance: { body: 58, head: 1, weapon: 47, shield: 3, helmet: 6 },
    },
};

export const PLAYABLE_CLASS_IDS: ClassId[] = [1, 8, 2, 9];

export function isPlayableClass(id: number): id is ClassId {
    return id === 1 || id === 2 || id === 3 || id === 9;
}
