export type CharacterClassKey =
    | "mago"
    | "clerigo"
    | "guerrero"
    | "asesino"
    | "bardo"
    | "druida"
    | "paladin"
    | "cazador";

export type RaceKey = "humano" | "elfo" | "elfoDrow" | "enano" | "gnomo";
export type GenderKey = "male" | "female";

export type BaseStats = {
    fuerza: number;
    agilidad: number;
    inteligencia: number;
    carisma: number;
    constitucion: number;
    vida: number;
    mana: number;
    golpeMin: number;
    golpeMax: number;
    expProximoNivel: number;
};

export type CharacterClassOption = {
    key: CharacterClassKey;
    label: string;
    /** Rol en el combate por turnos; vacío en las clases no disponibles. */
    role: string;
    available: boolean;
};

type ClassProgress = {
    vida: number;
    manaInicial: number;
    multMana: number;
    hitPre36: number;
    hitPost36: number;
};

type RaceGenderConfig = {
    bodyId: number;
    startHeadId: number;
    endHeadId: number;
};

export type RaceOption = {
    key: RaceKey;
    label: string;
    summary: string;
    baseStats: Pick<
        BaseStats,
        "fuerza" | "agilidad" | "inteligencia" | "carisma" | "constitucion"
    >;
    genders: Record<GenderKey, RaceGenderConfig>;
};

export const characterClassOptions: CharacterClassOption[] = [
    {
        key: "mago",
        label: "Mago",
        role: "Magia de daño y control a distancia",
        available: true,
    },
    {
        key: "paladin",
        label: "Paladín",
        role: "Golpe fuerte, primera línea y pocos hechizos",
        available: true,
    },
    {
        key: "clerigo",
        label: "Clérigo",
        role: "Sanador y soporte del grupo",
        available: true,
    },
    {
        key: "cazador",
        label: "Cazador / Arquero",
        role: "Daño físico a distancia",
        available: true,
    },
    { key: "guerrero", label: "Guerrero", role: "", available: false },
    { key: "asesino", label: "Asesino", role: "", available: false },
    { key: "bardo", label: "Bardo", role: "", available: false },
    { key: "druida", label: "Druida", role: "", available: false },
];

const classProgressByKey: Record<CharacterClassKey, ClassProgress> = {
    mago: {
        vida: 7.5,
        manaInicial: 8.33,
        multMana: 2.65,
        hitPre36: 1,
        hitPost36: 1,
    },
    clerigo: {
        vida: 8.5,
        manaInicial: 2.5,
        multMana: 2,
        hitPre36: 2,
        hitPost36: 2,
    },
    guerrero: {
        vida: 10.5,
        manaInicial: 0,
        multMana: 0,
        hitPre36: 3,
        hitPost36: 2,
    },
    asesino: {
        vida: 9,
        manaInicial: 2.5,
        multMana: 1,
        hitPre36: 3,
        hitPost36: 2,
    },
    bardo: {
        vida: 8.5,
        manaInicial: 2.5,
        multMana: 2,
        hitPre36: 2,
        hitPost36: 2,
    },
    druida: {
        vida: 8.5,
        manaInicial: 2.5,
        multMana: 2,
        hitPre36: 2,
        hitPost36: 2,
    },
    paladin: {
        vida: 10,
        manaInicial: 2.5,
        multMana: 1,
        hitPre36: 3,
        hitPost36: 2,
    },
    cazador: {
        vida: 10,
        manaInicial: 0,
        multMana: 0,
        hitPre36: 3,
        hitPost36: 2,
    },
};

const MAX_LEVEL = 50;
const LAST_LEGACY_EXP_LEVEL = 46;

export const raceOptions: RaceOption[] = [
    {
        key: "humano",
        label: "Humano",
        summary: "Balanceado y adaptable.",
        baseStats: {
            fuerza: 19,
            agilidad: 19,
            inteligencia: 18,
            carisma: 18,
            constitucion: 20,
        },
        genders: {
            male: { bodyId: 21, startHeadId: 1, endHeadId: 41 },
            female: { bodyId: 39, startHeadId: 50, endHeadId: 80 },
        },
    },
    {
        key: "elfo",
        label: "Elfo",
        summary: "Agil y arcano.",
        baseStats: {
            fuerza: 18,
            agilidad: 20,
            inteligencia: 20,
            carisma: 19,
            constitucion: 19,
        },
        genders: {
            male: { bodyId: 21, startHeadId: 101, endHeadId: 122 },
            female: { bodyId: 39, startHeadId: 170, endHeadId: 179 },
        },
    },
    {
        key: "elfoDrow",
        label: "Elfo Drow",
        summary: "Oscuro, veloz y extremo.",
        baseStats: {
            fuerza: 20,
            agilidad: 19,
            inteligencia: 19,
            carisma: 17,
            constitucion: 19,
        },
        genders: {
            male: { bodyId: 32, startHeadId: 201, endHeadId: 221 },
            female: { bodyId: 40, startHeadId: 270, endHeadId: 279 },
        },
    },
    {
        key: "enano",
        label: "Enano",
        summary: "Robusto y resistente.",
        baseStats: {
            fuerza: 21,
            agilidad: 18,
            inteligencia: 15,
            carisma: 17,
            constitucion: 21,
        },
        genders: {
            male: { bodyId: 53, startHeadId: 301, endHeadId: 319 },
            female: { bodyId: 60, startHeadId: 370, endHeadId: 379 },
        },
    },
    {
        key: "gnomo",
        label: "Gnomo",
        summary: "Brillante y tecnico.",
        baseStats: {
            fuerza: 16,
            agilidad: 21,
            inteligencia: 22,
            carisma: 20,
            constitucion: 18,
        },
        genders: {
            male: { bodyId: 53, startHeadId: 401, endHeadId: 418 },
            female: { bodyId: 60, startHeadId: 470, endHeadId: 479 },
        },
    },
];

export function getClassOption(key: CharacterClassKey): CharacterClassOption {
    const option = characterClassOptions.find((item) => item.key === key);

    if (!option) {
        throw new Error(`Unknown class: ${key}`);
    }

    return option;
}

export function getRaceOption(key: RaceKey): RaceOption {
    const option = raceOptions.find((item) => item.key === key);

    if (!option) {
        throw new Error(`Unknown race: ${key}`);
    }

    return option;
}

export function getRaceAppearance(raceKey: RaceKey, genderKey: GenderKey) {
    const race = getRaceOption(raceKey);
    return race.genders[genderKey];
}

export function getHeadIds(raceKey: RaceKey, genderKey: GenderKey): number[] {
    const appearance = getRaceAppearance(raceKey, genderKey);
    const headIds: number[] = [];

    for (let id = appearance.startHeadId; id <= appearance.endHeadId; id += 1) {
        headIds.push(id);
    }

    return headIds;
}

function clampLevel(level: number): number {
    return Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
}

function getLegacyExpNextLevelForLevel(level: number): number {
    const safeLevel = clampLevel(level);
    const expCurveLevel = Math.min(safeLevel, LAST_LEGACY_EXP_LEVEL);
    let expNextLevel = 300;

    for (
        let currentLevel = 2;
        currentLevel <= expCurveLevel;
        currentLevel += 1
    ) {
        if (currentLevel < 15) {
            expNextLevel = Math.floor(expNextLevel * 1.4);
        } else if (currentLevel < 21) {
            expNextLevel = Math.floor(expNextLevel * 1.35);
        } else if (currentLevel < 33) {
            expNextLevel = Math.floor(expNextLevel * 1.3);
        } else if (currentLevel < 41) {
            expNextLevel = Math.floor(expNextLevel * 1.225);
        } else {
            expNextLevel = Math.floor(expNextLevel * 1.25);
        }
    }

    return expNextLevel;
}

function getHitModifierForLevel(
    classKey: CharacterClassKey,
    level: number,
): number {
    const safeLevel = clampLevel(level);
    const classProgress = classProgressByKey[classKey];

    if (safeLevel <= 1) {
        return 0;
    }

    if (safeLevel <= 36) {
        return (safeLevel - 1) * classProgress.hitPre36;
    }

    return (
        35 * classProgress.hitPre36 + (safeLevel - 36) * classProgress.hitPost36
    );
}

function getMaxHpForLevel(
    classKey: CharacterClassKey,
    constitucion: number,
    level: number,
): number {
    const safeLevel = clampLevel(level);
    const classProgress = classProgressByKey[classKey];
    const total =
        constitucion +
        (classProgress.vida - (21 - constitucion) * 0.5) * (safeLevel - 1);

    return Math.round(total);
}

function getMaxManaForLevel(
    classKey: CharacterClassKey,
    inteligencia: number,
    level: number,
): number {
    const safeLevel = clampLevel(level);
    const classProgress = classProgressByKey[classKey];
    const total =
        inteligencia * classProgress.manaInicial +
        classProgress.multMana * inteligencia * (safeLevel - 1);

    return Math.max(0, Math.round(total));
}

export function getBaseStats(
    characterClassKey: CharacterClassKey,
    raceKey: RaceKey,
): BaseStats {
    const raceOption = getRaceOption(raceKey);
    const fuerza = raceOption.baseStats.fuerza;
    const agilidad = raceOption.baseStats.agilidad;
    const inteligencia = raceOption.baseStats.inteligencia;
    const carisma = raceOption.baseStats.carisma;
    const constitucion = raceOption.baseStats.constitucion;

    return {
        fuerza,
        agilidad,
        inteligencia,
        carisma,
        constitucion,
        vida: getMaxHpForLevel(characterClassKey, constitucion, 1),
        mana: getMaxManaForLevel(characterClassKey, inteligencia, 1),
        golpeMin: 1 + getHitModifierForLevel(characterClassKey, 1),
        golpeMax: 2 + getHitModifierForLevel(characterClassKey, 1),
        expProximoNivel: getLegacyExpNextLevelForLevel(1),
    };
}
