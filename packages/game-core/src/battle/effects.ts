import { STATUSES } from "../data/statuses";
import { damageTakenMultiplier } from "./rules";
import type { BattleEvent, Combatant, DamageSchool, Flank, StatusId } from "./types";

/** Aplica daño ya calculado (después de crítico y flanco). Devuelve los eventos. */
export function dealDamage(
    target: Combatant,
    sourceId: string,
    raw: number,
    school: DamageSchool,
    opts: { crit?: boolean; flank?: Flank } = {},
): BattleEvent[] {
    if (!target.alive) return [];
    const amount = Math.max(1, Math.round(raw * damageTakenMultiplier(target)));
    target.res.hp = Math.max(0, target.res.hp - amount);
    const events: BattleEvent[] = [
        {
            t: "damaged",
            targetId: target.id,
            sourceId,
            amount,
            school,
            crit: Boolean(opts.crit),
            flank: opts.flank ?? "front",
            hpLeft: target.res.hp,
        },
    ];
    if (target.res.hp === 0) events.push(...kill(target));
    return events;
}

export function kill(target: Combatant): BattleEvent[] {
    target.alive = false;
    target.statuses = [];
    target.res.ap = 0;
    target.res.mp = 0;
    return [{ t: "died", targetId: target.id }];
}

export function heal(target: Combatant, sourceId: string, raw: number): BattleEvent[] {
    if (!target.alive) return [];
    const amount = Math.min(target.res.maxHp - target.res.hp, Math.round(raw));
    target.res.hp += amount;
    return [{ t: "healed", targetId: target.id, sourceId, amount, hpLeft: target.res.hp }];
}

export function applyStatus(
    target: Combatant,
    id: StatusId,
    turns: number,
    sourceId: string,
    magnitude = 1,
): BattleEvent[] {
    if (!target.alive) return [];
    if (target.immunities.includes(id) || (id === "paralizado" && target.statuses.some((s) => s.id === "inmunidadParalisis"))) {
        return [{ t: "statusResisted", targetId: target.id, status: id }];
    }

    const def = STATUSES[id];
    const existing = target.statuses.find((s) => s.id === id);
    if (existing) {
        existing.turnsLeft = Math.max(existing.turnsLeft, turns);
        existing.stacks = Math.min(def.maxStacks, existing.stacks + 1);
        existing.magnitude = Math.max(existing.magnitude, magnitude);
        existing.sourceId = sourceId;
        return [{ t: "statusApplied", targetId: target.id, status: id, turns: existing.turnsLeft, stacks: existing.stacks }];
    }

    target.statuses.push({ id, turnsLeft: turns, stacks: 1, sourceId, magnitude });
    return [{ t: "statusApplied", targetId: target.id, status: id, turns, stacks: 1 }];
}

export function removeStatus(target: Combatant, id: StatusId): BattleEvent[] {
    const before = target.statuses.length;
    target.statuses = target.statuses.filter((s) => s.id !== id);
    return before !== target.statuses.length ? [{ t: "statusExpired", targetId: target.id, status: id }] : [];
}

function dot(target: Combatant, when: "dotAtTurnStart" | "dotAtTurnEnd"): BattleEvent[] {
    const events: BattleEvent[] = [];
    for (const s of [...target.statuses]) {
        const spec = STATUSES[s.id][when];
        if (!spec || !target.alive) continue;
        const raw = ((spec.pctMaxHp ?? 0) / 100) * target.res.maxHp + (spec.flat ?? 0);
        events.push(...dealDamage(target, s.sourceId, Math.ceil(raw) * s.stacks, spec.school));
    }
    return events;
}

/** Inicio del turno del afectado: vencen los estados de "hasta tu próximo turno" y corre el daño periódico. */
export function onTurnStart(c: Combatant): BattleEvent[] {
    const events: BattleEvent[] = [];
    for (const s of [...c.statuses]) {
        if (STATUSES[s.id].expiresAtTurnStart) events.push(...removeStatus(c, s.id));
    }
    events.push(...dot(c, "dotAtTurnStart"));
    return events;
}

/** Fin del turno del afectado: daño periódico y descuento de duraciones. */
export function onTurnEnd(c: Combatant): BattleEvent[] {
    const events: BattleEvent[] = [...dot(c, "dotAtTurnEnd")];
    if (!c.alive) return events;

    for (const s of [...c.statuses]) {
        const def = STATUSES[s.id];
        if (def.expiresAtTurnStart) continue;
        s.turnsLeft -= 1;
        if (s.turnsLeft <= 0) {
            events.push(...removeStatus(c, s.id));
            if (def.onExpireApply) {
                events.push(...applyStatus(c, def.onExpireApply.status, def.onExpireApply.turns, c.id));
            }
        }
    }
    return events;
}
