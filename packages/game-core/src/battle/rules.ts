import { combatantAt, DIRECTIONS, headingBetween } from "./grid";
import { effectiveAttr, flatModifier } from "./statuses";
import type { BattleState, Combatant, Flank } from "./types";

/**
 * Fórmulas de combate. Conservan la forma de las de server/src/game.ts
 * (poderAtaqueArma contra poderEvasion, clampChance entre 5 y 95, modificadores por clase)
 * pero sin depender del estado global del servidor.
 */

export const clampChance = (value: number, min = 5, max = 95): number => Math.max(min, Math.min(max, value));

const OPPOSITE = { 1: 2, 2: 1, 3: 4, 4: 3 } as const;

/** Desde dónde llega el ataque según hacia dónde mira el objetivo. */
export function flankOf(attacker: Combatant, target: Combatant): Flank {
    const fromTarget = headingBetween(target.pos, attacker.pos);
    if (fromTarget === target.heading) return "front";
    if (fromTarget === OPPOSITE[target.heading]) return "back";
    return "side";
}

export const FLANK_DAMAGE: Record<Flank, number> = { front: 1, side: 1.1, back: 1.25 };
export const FLANK_ACCURACY: Record<Flank, number> = { front: 0, side: 5, back: 15 };

export function evasionOf(c: Combatant): number {
    const agilidadBonus = (effectiveAttr(c, "agilidad") - c.stats.agilidad) * 2;
    return c.stats.evasion + agilidadBonus + flatModifier(c, "evasion");
}

export function hitChance(attacker: Combatant, target: Combatant, flank: Flank): number {
    return clampChance(50 + (attacker.stats.attackPower - evasionOf(target)) * 0.4 + FLANK_ACCURACY[flank]);
}

export function critChance(attacker: Combatant): number {
    return clampChance(5 + effectiveAttr(attacker, "agilidad") / 4, 0, 40);
}

/** Multiplicador por daño recibido (Defendiendo). */
export function damageTakenMultiplier(target: Combatant): number {
    return Math.max(0, 1 + flatModifier(target, "damageTakenPct") / 100);
}

/** Acorralado: cada rival pegado además del primero quita 10 % del daño recibido, hasta 30 %. */
export const CROWD_GUARD_STEP = 0.1;
export const CROWD_GUARD_MAX = 0.3;

/** Rivales vivos en las cuatro casillas pegadas a `c`. */
export function adjacentFoes(state: BattleState, c: Combatant): number {
    let count = 0;
    for (const { dx, dy } of DIRECTIONS) {
        const other = combatantAt(state, { x: c.pos.x + dx, y: c.pos.y + dy });
        if (other && other.alive && other.team !== c.team) count++;
    }
    return count;
}

/**
 * Contra la superioridad numérica: un héroe rodeado se cubre mejor. Solo protege a los héroes,
 * así una party que rodea a un jefe no le regala la defensa.
 */
export function crowdGuard(state: BattleState, target: Combatant): number {
    if (target.team !== "heroes") return 0;
    return Math.min(CROWD_GUARD_MAX, Math.max(0, adjacentFoes(state, target) - 1) * CROWD_GUARD_STEP);
}

/** Represalia: quien defiende devuelve medio golpe a cada ataque cuerpo a cuerpo que recibe. */
export const RIPOSTE_MULT = 0.5;

/** Cazador: +10 % por casilla por encima de 3, hasta +30 %. */
export function longShotBonus(attacker: Combatant, distance: number): number {
    if (!attacker.tags.includes("longShot")) return 1;
    return 1 + Math.min(0.3, Math.max(0, distance - 3) * 0.1);
}

/** La defensa reduce en proporción y nunca anula el golpe: 10 de defensa = −25 %, 30 = −50 %. */
export function mitigate(raw: number, defense: number): number {
    return raw * (30 / (30 + Math.max(0, defense)));
}

export function weaponDamage(attacker: Combatant, roll: number, mult: number): number {
    const fuerzaBonus = Math.max(0, effectiveAttr(attacker, "fuerza") - 10) * 0.5;
    return (roll * attacker.stats.physicalDamageMod + fuerzaBonus) * mult;
}

/** Daño de hechizo: modDmgMagia del lanzador y resistencia mágica del objetivo. Báculo: +15 %. */
export function spellDamage(caster: Combatant, target: Combatant, roll: number): number {
    const staff = caster.tags.includes("staff") ? 1.15 : 1;
    const mod = caster.stats.magicDamageMod > 0 ? caster.stats.magicDamageMod : 1;
    return roll * mod * staff * (1 - Math.min(80, target.stats.magicResist) / 100);
}

export function initiativeOf(c: Combatant): number {
    return 10 + 2 * effectiveAttr(c, "agilidad") + c.stats.level + flatModifier(c, "initiative");
}
