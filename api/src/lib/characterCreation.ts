export const CHARACTER_CLASSES = [
    "mago",
    "clerigo",
    "guerrero",
    "asesino",
    "bardo",
    "druida",
    "paladin",
    "cazador",
] as const;
/** Clases que se pueden elegir al crear personaje. El resto queda deshabilitado por ahora. */
export const PLAYABLE_CHARACTER_CLASSES = [
    "mago",
    "paladin",
    "clerigo",
    "cazador",
] as const satisfies readonly (typeof CHARACTER_CLASSES)[number][];
export const CHARACTER_RACES = [
    "humano",
    "elfo",
    "elfoDrow",
    "enano",
    "gnomo",
] as const;
export const CHARACTER_GENDERS = ["male", "female"] as const;

export type CharacterClassKey = (typeof CHARACTER_CLASSES)[number];
export type RaceKey = (typeof CHARACTER_RACES)[number];
export type GenderKey = (typeof CHARACTER_GENDERS)[number];

type RaceGenderConfig = {
    bodyId: number;
    startHeadId: number;
    endHeadId: number;
};

type RaceOption = {
    key: RaceKey;
    baseStats: {
        fuerza: number;
        agilidad: number;
        inteligencia: number;
        carisma: number;
        constitucion: number;
    };
    genders: Record<GenderKey, RaceGenderConfig>;
};

type DerivedCreationStats = {
    fuerza: number;
    agilidad: number;
    inteligencia: number;
    carisma: number;
    constitucion: number;
    hp: number;
    mana: number;
    minHit: number;
    maxHit: number;
    expNextLevel: number;
};

type ClassProgress = {
    vida: number;
    manaInicial: number;
    multMana: number;
    hitPre36: number;
    hitPost36: number;
};

export const CLASS_ID_MAP: Record<CharacterClassKey, number> = {
    mago: 1,
    clerigo: 2,
    guerrero: 3,
    asesino: 4,
    bardo: 6,
    druida: 7,
    paladin: 8,
    cazador: 9,
};

export const RACE_ID_MAP: Record<RaceKey, number> = {
    humano: 1,
    elfo: 2,
    elfoDrow: 3,
    enano: 4,
    gnomo: 5,
};

export const GENDER_ID_MAP: Record<GenderKey, number> = {
    male: 1,
    female: 2,
};

const classProgressById: Record<number, ClassProgress> = {
    1: {
        vida: 7.5,
        manaInicial: 8.33,
        multMana: 2.65,
        hitPre36: 1,
        hitPost36: 1,
    },
    2: { vida: 8.5, manaInicial: 2.5, multMana: 2, hitPre36: 2, hitPost36: 2 },
    3: { vida: 10.5, manaInicial: 0, multMana: 0, hitPre36: 3, hitPost36: 2 },
    4: { vida: 9, manaInicial: 2.5, multMana: 1, hitPre36: 3, hitPost36: 2 },
    5: { vida: 8, manaInicial: 0, multMana: 0, hitPre36: 3, hitPost36: 2 },
    6: { vida: 8.5, manaInicial: 2.5, multMana: 2, hitPre36: 2, hitPost36: 2 },
    7: { vida: 8.5, manaInicial: 2.5, multMana: 2, hitPre36: 2, hitPost36: 2 },
    8: { vida: 10, manaInicial: 2.5, multMana: 1, hitPre36: 3, hitPost36: 2 },
    9: { vida: 10, manaInicial: 0, multMana: 0, hitPre36: 3, hitPost36: 2 },
    10: { vida: 8.5, manaInicial: 0, multMana: 0, hitPre36: 3, hitPost36: 2 },
    11: { vida: 10, manaInicial: 0, multMana: 0, hitPre36: 3, hitPost36: 2 },
};

export const MAX_LEVEL = 50;
export const MAX_EXP_LEVEL = 50;
const LAST_LEGACY_EXP_LEVEL = 46;

export function clampLevel(level: number): number {
    return Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
}

export function getLegacyExpNextLevelForLevel(level: number): number {
    const safeLevel = Math.max(1, Math.min(MAX_EXP_LEVEL, Math.floor(level)));
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

export function getHitModifierForLevel(classId: number, level: number): number {
    const safeLevel = clampLevel(level);
    const classProgress = classProgressById[classId];

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

export function getMinHitForLevel(classId: number, level: number): number {
    return 1 + getHitModifierForLevel(classId, level);
}

export function getMaxHitForLevel(classId: number, level: number): number {
    return 2 + getHitModifierForLevel(classId, level);
}

export function getMaxHpForLevel(
    classId: number,
    constitucion: number,
    level: number,
): number {
    const safeLevel = clampLevel(level);
    const classProgress = classProgressById[classId];
    const total =
        constitucion +
        (classProgress.vida - (21 - constitucion) * 0.5) * (safeLevel - 1);
    return Math.round(total);
}

export function getMaxManaForLevel(
    classId: number,
    inteligencia: number,
    level: number,
): number {
    const safeLevel = clampLevel(level);
    const classProgress = classProgressById[classId];
    const total =
        inteligencia * classProgress.manaInicial +
        classProgress.multMana * inteligencia * (safeLevel - 1);
    return Math.max(0, Math.round(total));
}

const raceOptions: Record<RaceKey, RaceOption> = {
    humano: {
        key: "humano",
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
    elfo: {
        key: "elfo",
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
    elfoDrow: {
        key: "elfoDrow",
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
    enano: {
        key: "enano",
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
    gnomo: {
        key: "gnomo",
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
};

export function getBaseStats(
    characterClassKey: CharacterClassKey,
    raceKey: RaceKey,
): DerivedCreationStats {
    const classId = CLASS_ID_MAP[characterClassKey];
    const raceOption = raceOptions[raceKey];
    const classProgress = classProgressById[classId];
    const { fuerza, agilidad, inteligencia, carisma, constitucion } =
        raceOption.baseStats;

    return {
        fuerza,
        agilidad,
        inteligencia,
        carisma,
        constitucion,
        hp: getMaxHpForLevel(classId, constitucion, 1),
        mana: getMaxManaForLevel(classId, inteligencia, 1),
        minHit: getMinHitForLevel(classId, 1),
        maxHit: getMaxHitForLevel(classId, 1),
        expNextLevel: getLegacyExpNextLevelForLevel(1),
    };
}

export function getAllowedAppearance(
    raceKey: RaceKey,
    genderKey: GenderKey,
): RaceGenderConfig {
    return raceOptions[raceKey].genders[genderKey];
}

export function isValidHeadId(
    raceKey: RaceKey,
    genderKey: GenderKey,
    headId: number,
): boolean {
    const appearance = getAllowedAppearance(raceKey, genderKey);
    return headId >= appearance.startHeadId && headId <= appearance.endHeadId;
}
