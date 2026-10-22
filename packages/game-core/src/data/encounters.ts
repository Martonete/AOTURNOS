export type EncounterDef = {
    id: string;
    name: string;
    /** Enemigos base para un héroe; se agregan más según el tamaño de la party. */
    enemies: string[];
    /** Enemigos extra por cada héroe adicional, en orden. */
    perExtraHero: string[];
    grid: { width: number; height: number };
    exp: number;
    gold: number;
};

/** Encuentros de la rebanada vertical (Acto I). */
export const ENCOUNTERS: Record<string, EncounterDef> = {
    lobos: {
        id: "lobos",
        name: "Manada de lobos",
        enemies: ["lobo", "lobo"],
        perExtraHero: ["lobo", "goblin", "lobo"],
        grid: { width: 15, height: 11 },
        exp: 150,
        gold: 20,
    },
    goblins: {
        id: "goblins",
        name: "Emboscada goblin",
        enemies: ["goblin", "esqueleto"],
        perExtraHero: ["goblin", "esqueleto", "goblin"],
        grid: { width: 15, height: 11 },
        exp: 220,
        gold: 40,
    },
    orcos: {
        id: "orcos",
        name: "Campamento orco",
        enemies: ["orco"],
        perExtraHero: ["orco_brujo", "goblin", "orco"],
        grid: { width: 15, height: 11 },
        exp: 900,
        gold: 120,
    },
};

export function encounterEnemies(encounter: EncounterDef, heroCount: number): string[] {
    return [...encounter.enemies, ...encounter.perExtraHero.slice(0, Math.max(0, heroCount - 1))];
}
