import type { AbilityDef } from "../data/abilities";
import { manhattan } from "./grid";
import {
    critChance,
    crowdGuard,
    damageTakenMultiplier,
    FLANK_DAMAGE,
    flankOf,
    hitChance,
    longShotBonus,
    mitigate,
    spellDamage,
    weaponDamage,
} from "./rules";
import type { BattleState, Combatant, Flank } from "./types";

/** Lo que el HUD anticipa antes de confirmar una habilidad sobre un objetivo. */
export type Forecast = {
    kind: "damage" | "heal";
    /** Rango sin crítico, ya mitigado. */
    min: number;
    max: number;
    /** 100 para hechizos, que no fallan. */
    hitChance: number;
    critChance: number;
    flank: Flank;
    /** El golpe mínimo ya alcanza para matarlo. */
    lethal: boolean;
    /** El golpe máximo (o el crítico) puede matarlo. */
    canKill: boolean;
    /** Parte del daño que absorbe Acorralado (0 a 0.3). */
    guard: number;
};

/**
 * Previsión de daño o curación con las mismas fórmulas que applyEffects en resolution.ts.
 * No tira dados ni cambia el estado; ignora empujes, estados y el drenaje. Con `state`
 * descuenta además Acorralado, que depende de quién rodea al objetivo.
 */
export function forecastAbility(actor: Combatant, target: Combatant, ability: AbilityDef, state?: BattleState): Forecast | null {
    const guard = state ? crowdGuard(state, target) : 0;
    const finalAmount = (raw: number) =>
        Math.max(1, Math.round(raw * (1 - guard) * damageTakenMultiplier(target)));
    const flank = flankOf(actor, target);
    const distance = manhattan(actor.pos, target.pos);
    let min = 0;
    let max = 0;
    let chance = 100;
    let crit = 0;
    let kind: Forecast["kind"] = "damage";

    for (const effect of ability.effects) {
        if (effect.kind === "weapon") {
            chance = Math.round(hitChance(actor, target, flank));
            crit = Math.round(critChance(actor));
            const scale = FLANK_DAMAGE[flank] * longShotBonus(actor, distance);
            min += finalAmount(mitigate(weaponDamage(actor, actor.stats.hitMin, effect.mult) * scale, target.stats.defense));
            max += finalAmount(mitigate(weaponDamage(actor, actor.stats.hitMax, effect.mult) * scale, target.stats.defense));
        } else if (effect.kind === "damage") {
            const raw = (roll: number) =>
                effect.school === "physical"
                    ? mitigate(roll * FLANK_DAMAGE[flank] * longShotBonus(actor, distance), target.stats.defense / 2)
                    : spellDamage(actor, target, roll);
            min += finalAmount(raw(effect.min));
            max += finalAmount(raw(effect.max));
        } else if (effect.kind === "heal") {
            if (target.tags.includes("undead")) {
                min += effect.min;
                max += effect.max;
            } else {
                kind = "heal";
                min += Math.min(effect.min, target.res.maxHp - target.res.hp);
                max += Math.min(effect.max, target.res.maxHp - target.res.hp);
            }
        }
    }

    if (max <= 0 && kind === "damage") return null;
    const critMax = crit > 0 ? Math.round(max * 1.5) : max;
    return {
        kind,
        min,
        max,
        hitChance: chance,
        critChance: crit,
        flank,
        lethal: kind === "damage" && min >= target.res.hp,
        canKill: kind === "damage" && critMax >= target.res.hp,
        guard,
    };
}
