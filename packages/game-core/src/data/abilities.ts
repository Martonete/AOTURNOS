import type { AbilityId, DamageSchool, StatusId } from "../battle/types";

export type AreaShape =
    | { kind: "single" }
    | { kind: "cross"; radius: number }
    | { kind: "circle"; radius: number }
    /** Línea recta desde el lanzador hacia el objetivo, de `length` casillas. */
    | { kind: "line"; length: number };

export type Effect =
    /** Ataque con el arma equipada: tira precisión y usa hitMin/hitMax del personaje. */
    | { kind: "weapon"; mult: number }
    /** Daño fijo de hechizo: no falla, lo reduce la resistencia mágica. */
    | { kind: "damage"; min: number; max: number; school: DamageSchool }
    | { kind: "heal"; min: number; max: number }
    | { kind: "status"; status: StatusId; turns: number; magnitude?: [number, number] }
    | { kind: "cleanse"; statuses: StatusId[] }
    | { kind: "revive"; hpPct: number };

export type AbilityTarget = "enemy" | "ally" | "self" | "any" | "deadAlly";

export type AbilityDef = {
    id: AbilityId;
    name: string;
    description: string;
    /** Id en server/jsons/spells.json, para sonidos y efectos gráficos del hechizo original. */
    spellId?: number;
    apCost: number;
    mana: number;
    stamina: number;
    minRange: number;
    maxRange: number;
    los: boolean;
    straightLine?: boolean;
    area: AreaShape;
    target: AbilityTarget;
    effects: Effect[];
    cooldown?: number;
    usesPerBattle?: number;
    /** El área daña también a los aliados (Apocalipsis). */
    friendlyFire?: boolean;
    /** El lanzador se desplaza en línea recta hasta quedar adyacente al objetivo antes de golpear. */
    dash?: boolean;
    /** Hace que el lanzador mire al objetivo y rompe la invisibilidad. */
    hostile: boolean;
};

const SINGLE: AreaShape = { kind: "single" };

/**
 * Habilidades de la rebanada vertical. Los valores de los hechizos parten de spells.json
 * (manaRequired, minHp/maxHp) y se les agregan PA, alcance y área. Las curaciones están
 * reescaladas porque en tiempo real se lanzaban varias por segundo.
 */
export const ABILITIES: Record<AbilityId, AbilityDef> = {
    // Comunes
    golpe: {
        id: "golpe",
        name: "Golpe",
        description: "Ataque cuerpo a cuerpo con el arma equipada.",
        apCost: 3,
        mana: 0,
        stamina: 0,
        minRange: 1,
        maxRange: 1,
        los: false,
        area: SINGLE,
        target: "enemy",
        effects: [{ kind: "weapon", mult: 1 }],
        hostile: true,
    },

    // Mago
    dardo_magico: {
        id: "dardo_magico",
        name: "Dardo Mágico",
        description: "Proyectil arcano barato.",
        spellId: 2,
        apCost: 2,
        mana: 10,
        stamina: 0,
        minRange: 1,
        maxRange: 6,
        los: true,
        area: SINGLE,
        target: "enemy",
        effects: [{ kind: "damage", min: 10, max: 15, school: "magic" }],
        hostile: true,
    },
    proyectil_magico: {
        id: "proyectil_magico",
        name: "Proyectil Mágico",
        description: "El proyectil clásico del mago.",
        spellId: 8,
        apCost: 3,
        mana: 45,
        stamina: 0,
        minRange: 1,
        maxRange: 6,
        los: true,
        area: SINGLE,
        target: "enemy",
        effects: [{ kind: "damage", min: 35, max: 45, school: "magic" }],
        hostile: true,
    },
    inmovilizar: {
        id: "inmovilizar",
        name: "Inmovilizar",
        description: "El objetivo no puede moverse durante 2 turnos, pero sí actuar.",
        spellId: 24,
        apCost: 3,
        mana: 300,
        stamina: 0,
        minRange: 1,
        maxRange: 5,
        los: true,
        area: SINGLE,
        target: "enemy",
        effects: [{ kind: "status", status: "inmovilizado", turns: 2 }],
        hostile: true,
    },
    tormenta_fuego: {
        id: "tormenta_fuego",
        name: "Tormenta de Fuego",
        description: "Cruz de fuego que deja quemaduras.",
        spellId: 15,
        apCost: 4,
        mana: 150,
        stamina: 0,
        minRange: 2,
        maxRange: 6,
        los: true,
        area: { kind: "cross", radius: 1 },
        target: "any",
        effects: [
            { kind: "damage", min: 45, max: 55, school: "fire" },
            { kind: "status", status: "quemadura", turns: 2 },
        ],
        hostile: true,
    },
    descarga_electrica: {
        id: "descarga_electrica",
        name: "Descarga Eléctrica",
        description: "Rayo en línea recta de 3 casillas.",
        spellId: 23,
        apCost: 4,
        mana: 460,
        stamina: 0,
        minRange: 1,
        maxRange: 3,
        los: true,
        straightLine: true,
        area: { kind: "line", length: 3 },
        target: "any",
        effects: [{ kind: "damage", min: 69, max: 77, school: "lightning" }],
        hostile: true,
    },
    paralizar: {
        id: "paralizar",
        name: "Paralizar",
        description: "El objetivo pierde su próximo turno.",
        spellId: 9,
        apCost: 5,
        mana: 400,
        stamina: 0,
        minRange: 1,
        maxRange: 4,
        los: true,
        area: SINGLE,
        target: "enemy",
        effects: [{ kind: "status", status: "paralizado", turns: 1 }],
        hostile: true,
    },
    apocalipsis: {
        id: "apocalipsis",
        name: "Apocalipsis",
        description: "Devastación en un círculo de radio 2. Golpea también a los aliados.",
        spellId: 25,
        apCost: 6,
        mana: 1000,
        stamina: 0,
        minRange: 3,
        maxRange: 7,
        los: false,
        area: { kind: "circle", radius: 2 },
        target: "any",
        effects: [{ kind: "damage", min: 91, max: 100, school: "fire" }],
        cooldown: 3,
        friendlyFire: true,
        hostile: true,
    },

    // Clérigo
    curar_leves: {
        id: "curar_leves",
        name: "Curar Heridas Leves",
        description: "Curación rápida.",
        spellId: 3,
        apCost: 2,
        mana: 10,
        stamina: 0,
        minRange: 0,
        maxRange: 4,
        los: true,
        area: SINGLE,
        target: "ally",
        effects: [{ kind: "heal", min: 15, max: 25 }],
        hostile: false,
    },
    curar_graves: {
        id: "curar_graves",
        name: "Curar Heridas Graves",
        description: "Curación fuerte que además quita el veneno.",
        spellId: 5,
        apCost: 3,
        mana: 40,
        stamina: 0,
        minRange: 0,
        maxRange: 4,
        los: true,
        area: SINGLE,
        target: "ally",
        effects: [
            { kind: "heal", min: 40, max: 60 },
            { kind: "cleanse", statuses: ["envenenado"] },
        ],
        hostile: false,
    },
    remover_paralisis: {
        id: "remover_paralisis",
        name: "Remover Parálisis",
        description: "Quita Paralizado e Inmovilizado.",
        spellId: 10,
        apCost: 2,
        mana: 150,
        stamina: 0,
        minRange: 0,
        maxRange: 4,
        los: true,
        area: SINGLE,
        target: "ally",
        effects: [{ kind: "cleanse", statuses: ["paralizado", "inmovilizado"] }],
        hostile: false,
    },
    fuerza: {
        id: "fuerza",
        name: "Fuerza",
        description: "Aumenta la fuerza de un aliado durante 3 turnos.",
        spellId: 20,
        apCost: 2,
        mana: 50,
        stamina: 0,
        minRange: 0,
        maxRange: 3,
        los: true,
        area: SINGLE,
        target: "ally",
        effects: [{ kind: "status", status: "fuerza", turns: 3, magnitude: [2, 5] }],
        hostile: false,
    },
    debilidad: {
        id: "debilidad",
        name: "Debilidad",
        description: "Reduce la fuerza de un enemigo durante 2 turnos.",
        spellId: 21,
        apCost: 2,
        mana: 45,
        stamina: 0,
        minRange: 1,
        maxRange: 5,
        los: true,
        area: SINGLE,
        target: "enemy",
        effects: [{ kind: "status", status: "debilidad", turns: 2, magnitude: [2, 5] }],
        hostile: true,
    },
    celeridad: {
        id: "celeridad",
        name: "Celeridad",
        description: "Más agilidad y 1 PM extra durante 3 turnos.",
        spellId: 18,
        apCost: 2,
        mana: 40,
        stamina: 0,
        minRange: 0,
        maxRange: 3,
        los: true,
        area: SINGLE,
        target: "ally",
        effects: [{ kind: "status", status: "celeridad", turns: 3, magnitude: [2, 5] }],
        hostile: false,
    },
    resucitar: {
        id: "resucitar",
        name: "Resucitar",
        description: "Revive a un aliado adyacente con 30 % de vida. Una vez por batalla.",
        spellId: 11,
        apCost: 6,
        mana: 550,
        stamina: 0,
        minRange: 1,
        maxRange: 1,
        los: false,
        area: SINGLE,
        target: "deadAlly",
        effects: [{ kind: "revive", hpPct: 30 }],
        usesPerBattle: 1,
        hostile: false,
    },

    // Guerrero
    embestida: {
        id: "embestida",
        name: "Embestida",
        description: "Carga en línea recta hasta el objetivo y lo golpea.",
        apCost: 4,
        mana: 0,
        stamina: 30,
        minRange: 2,
        maxRange: 3,
        los: true,
        straightLine: true,
        area: SINGLE,
        target: "enemy",
        effects: [{ kind: "weapon", mult: 1.1 }],
        dash: true,
        hostile: true,
    },
    provocar: {
        id: "provocar",
        name: "Provocar",
        description: "El enemigo debe atacar al guerrero en su próximo turno.",
        apCost: 2,
        mana: 0,
        stamina: 20,
        minRange: 1,
        maxRange: 3,
        los: true,
        area: SINGLE,
        target: "enemy",
        effects: [{ kind: "status", status: "provocado", turns: 1 }],
        cooldown: 2,
        hostile: true,
    },
    golpe_brutal: {
        id: "golpe_brutal",
        name: "Golpe Brutal",
        description: "Golpe pesado que aturde (−2 PA).",
        apCost: 5,
        mana: 0,
        stamina: 40,
        minRange: 1,
        maxRange: 1,
        los: false,
        area: SINGLE,
        target: "enemy",
        effects: [
            { kind: "weapon", mult: 1.5 },
            { kind: "status", status: "aturdido", turns: 1 },
        ],
        cooldown: 2,
        hostile: true,
    },

    // Arquero
    disparo: {
        id: "disparo",
        name: "Disparo",
        description: "Flecha con el arco equipado.",
        apCost: 3,
        mana: 0,
        stamina: 0,
        minRange: 2,
        maxRange: 6,
        los: true,
        area: SINGLE,
        target: "enemy",
        effects: [{ kind: "weapon", mult: 1 }],
        hostile: true,
    },
    flecha_elfica: {
        id: "flecha_elfica",
        name: "Flecha Élfica",
        description: "Flecha precisa de largo alcance.",
        spellId: 44,
        apCost: 4,
        mana: 0,
        stamina: 30,
        minRange: 2,
        maxRange: 7,
        los: true,
        area: SINGLE,
        target: "enemy",
        effects: [{ kind: "damage", min: 30, max: 35, school: "physical" }],
        hostile: true,
    },
    disparo_inmovilizante: {
        id: "disparo_inmovilizante",
        name: "Disparo Inmovilizante",
        description: "Flecha a las piernas: poco daño e Inmovilizado 2 turnos.",
        apCost: 4,
        mana: 0,
        stamina: 35,
        minRange: 2,
        maxRange: 6,
        los: true,
        area: SINGLE,
        target: "enemy",
        effects: [
            { kind: "weapon", mult: 0.5 },
            { kind: "status", status: "inmovilizado", turns: 2 },
        ],
        cooldown: 2,
        hostile: true,
    },
    flecha_electrica: {
        id: "flecha_electrica",
        name: "Flecha Eléctrica",
        description: "Flecha cargada de electricidad.",
        spellId: 7,
        apCost: 4,
        mana: 0,
        stamina: 40,
        minRange: 2,
        maxRange: 6,
        los: true,
        area: SINGLE,
        target: "enemy",
        effects: [{ kind: "damage", min: 25, max: 35, school: "lightning" }],
        hostile: true,
    },
    lluvia_flechas: {
        id: "lluvia_flechas",
        name: "Lluvia de Flechas",
        description: "Cubre un círculo de radio 1.",
        apCost: 5,
        mana: 0,
        stamina: 50,
        minRange: 3,
        maxRange: 6,
        los: false,
        area: { kind: "circle", radius: 1 },
        target: "any",
        effects: [{ kind: "weapon", mult: 0.8 }],
        cooldown: 2,
        hostile: true,
    },

    // Enemigos
    mordida: {
        id: "mordida",
        name: "Mordida",
        description: "Mordida de bestia.",
        apCost: 3,
        mana: 0,
        stamina: 0,
        minRange: 1,
        maxRange: 1,
        los: false,
        area: SINGLE,
        target: "enemy",
        effects: [{ kind: "weapon", mult: 1 }],
        hostile: true,
    },
    toxina: {
        id: "toxina",
        name: "Toxina",
        description: "Envenena durante 3 turnos.",
        spellId: 4,
        apCost: 3,
        mana: 24,
        stamina: 0,
        minRange: 1,
        maxRange: 5,
        los: true,
        area: SINGLE,
        target: "enemy",
        effects: [{ kind: "status", status: "envenenado", turns: 3 }],
        cooldown: 1,
        hostile: true,
    },
};

export function getAbility(id: AbilityId): AbilityDef | undefined {
    return ABILITIES[id];
}
