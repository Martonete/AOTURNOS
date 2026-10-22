import { STATUSES, type StatusFlag } from "../data/statuses";
import type { Combatant, StatusId } from "./types";

export function hasStatus(c: Combatant, id: StatusId): boolean {
    return c.statuses.some((s) => s.id === id);
}

export function hasFlag(c: Combatant, flag: StatusFlag): boolean {
    return c.statuses.some((s) => STATUSES[s.id].flags?.includes(flag));
}

/** Suma de modificadores planos (PA, PM, iniciativa, evasión, % de daño recibido). */
export function flatModifier(c: Combatant, key: "ap" | "mp" | "initiative" | "evasion" | "damageTakenPct"): number {
    let total = 0;
    for (const s of c.statuses) {
        const value = STATUSES[s.id].flat?.[key];
        if (value) total += value * s.stacks;
    }
    return total;
}

/** Fuerza o agilidad efectiva con los buffs y debuffs activos. */
export function effectiveAttr(c: Combatant, key: "fuerza" | "agilidad"): number {
    let total = c.stats[key];
    for (const s of c.statuses) {
        const def = STATUSES[s.id];
        const value = def.attrs?.[key];
        if (value) total += value * (def.scalesWithMagnitude ? s.magnitude : 1);
    }
    return Math.max(1, total);
}

/** Quién provocó a este combatiente, si está provocado. */
export function tauntSource(c: Combatant): string | null {
    return c.statuses.find((s) => s.id === "provocado")?.sourceId ?? null;
}
