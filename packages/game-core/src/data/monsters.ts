import type { AbilityId, Behavior, Combatant, StatusId } from "../battle/types";

/**
 * Familias de monstruos, al estilo Dofus: cada una se mueve, se posiciona y pelea distinto.
 * El daño de sus habilidades sale del golpe real de cada NPC, así que la familia define
 * el "cómo" y game_npcs sigue definiendo el "cuánto".
 */
export type MonsterFamily = {
    id: string;
    /** Nombre para la ficha del rival. */
    label: string;
    /** Reconoce la familia por el nombre del NPC. */
    match: RegExp;
    mp: number;
    behavior: Behavior;
    preferredRange?: [number, number];
    archetype: Combatant["archetype"];
    abilities: AbilityId[];
    /** Placaje: salir de una casilla pegada a él cuesta 1 PM más. */
    tackle?: boolean;
    undead?: boolean;
    immunities?: StatusId[];
};

/**
 * En orden: gana la primera que coincide, así "esqueleto arquero" cae en tiradores antes que en no muertos
 * y "araña gigante" en alimañas antes que en colosos.
 */
export const MONSTER_FAMILIES: MonsterFamily[] = [
    {
        id: "dragon",
        label: "Dragón",
        match: /drag[oó]n|wyvern|hidra|serpiente marina/i,
        mp: 3,
        behavior: "brute",
        archetype: "melee",
        abilities: ["mordida", "aliento_fuego", "coletazo"],
        tackle: true,
        immunities: ["paralizado", "aturdido"],
    },
    {
        id: "arquero",
        label: "Tirador",
        match: /arquer|ballester|cazador|tirador/i,
        mp: 3,
        behavior: "kiter",
        preferredRange: [3, 5],
        archetype: "ranged",
        abilities: ["flechazo", "flecha_retroceso", "tajo"],
    },
    {
        id: "hechicero",
        label: "Hechicero",
        match: /brujo|bruja|mago|maga|hechicer|cham[aá]n|nigromant|druida|sacerdot|liche|lich/i,
        mp: 3,
        behavior: "kiter",
        preferredRange: [3, 5],
        archetype: "caster",
        abilities: ["misil_arcano", "bola_fuego", "rayo", "parpadeo"],
    },
    {
        id: "espectro",
        label: "Espectro",
        match: /fantasma|espectro|alma|sombra|aparici|banshee|espiritu|espíritu/i,
        mp: 3,
        behavior: "skirmisher",
        preferredRange: [2, 4],
        archetype: "caster",
        abilities: ["toque_helado", "drenar_vida", "parpadeo"],
        undead: true,
        immunities: ["envenenado"],
    },
    {
        id: "no_muerto",
        label: "No muerto",
        match: /esqueleto|zombi|muerto|momia|necr[oó]|calavera|ghoul|vampir/i,
        mp: 3,
        behavior: "brute",
        archetype: "melee",
        abilities: ["golpe_pesado", "mordida_infecta", "escudo_oseo"],
        tackle: true,
        undead: true,
        immunities: ["envenenado"],
    },
    {
        id: "aracnido",
        label: "Alimaña",
        match: /ara[ñn]a|escorpi|serpiente|v[ií]bora|cobra|lagart|alacr|ciempi|sapo/i,
        mp: 4,
        behavior: "skirmisher",
        preferredRange: [2, 4],
        archetype: "melee",
        abilities: ["picadura", "telarana"],
    },
    {
        id: "bestia",
        label: "Bestia",
        match: /lobo|perro|chacal|hiena|jabal|oso|tigre|le[oó]n|puma|pantera|zorro|rata|murci[eé]lago|gato|cerdo|toro|ciervo|caballo|lince|cocodrilo/i,
        mp: 5,
        behavior: "flanker",
        archetype: "melee",
        abilities: ["mordida", "abalanzarse", "desgarro", "aullido"],
    },
    {
        id: "gigante",
        label: "Coloso",
        match: /golem|g[oó]lem|gigante|ogro|troll|minotauro|ent\b|c[ií]clope|titan|tit[aá]n/i,
        mp: 2,
        behavior: "brute",
        archetype: "melee",
        abilities: ["aplastar", "pisoton", "lanzar_roca"],
        tackle: true,
        immunities: ["envenenado"],
    },
    {
        id: "humanoide",
        label: "Guerrero",
        match: /goblin|orco|bandido|ladr[oó]n|pirata|guerrer|soldad|guardia|caballer|mercenari|asesino|kobold|gnoll|enano|b[aá]rbaro/i,
        mp: 3,
        behavior: "charger",
        archetype: "melee",
        abilities: ["tajo", "carga", "lanza_arrojadiza", "grito_guerra"],
        tackle: true,
    },
];

/** Familia por defecto para criaturas que no coinciden con ninguna. */
const FALLBACK_MELEE: MonsterFamily = {
    id: "criatura",
    label: "Criatura",
    match: /.*/,
    mp: 3,
    behavior: "charger",
    archetype: "melee",
    abilities: ["tajo", "lanza_arrojadiza"],
};

const FALLBACK_CASTER: MonsterFamily = {
    id: "criatura_magica",
    label: "Criatura mágica",
    match: /.*/,
    mp: 3,
    behavior: "kiter",
    preferredRange: [3, 5],
    archetype: "caster",
    abilities: ["misil_arcano", "tajo", "parpadeo"],
};

export function monsterFamilyFor(name: string, hints: { caster?: boolean } = {}): MonsterFamily {
    return MONSTER_FAMILIES.find((f) => f.match.test(name)) ?? (hints.caster ? FALLBACK_CASTER : FALLBACK_MELEE);
}

/** Aplica la familia a un combatiente enemigo: PM, habilidades, personalidad y rasgos. */
export function applyMonsterFamily(c: Combatant, family: MonsterFamily): Combatant {
    c.family = family.label;
    c.behavior = family.behavior;
    c.preferredRange = family.preferredRange;
    c.archetype = family.archetype;
    c.abilities = [...family.abilities];
    c.res.maxMp = family.mp;
    c.res.mp = family.mp;
    const tags = new Set(c.tags);
    if (family.tackle) tags.add("zoneOfControl");
    if (family.undead) tags.add("undead");
    c.tags = [...tags];
    c.immunities = [...new Set([...c.immunities, ...(family.immunities ?? [])])];
    return c;
}
