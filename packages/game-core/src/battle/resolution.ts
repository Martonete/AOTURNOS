import { ABILITIES, type AbilityDef } from "../data/abilities";
import { applyStatus, dealDamage, heal, removeStatus } from "./effects";
import { DIRECTIONS, headingBetween, isFree, manhattan, pathCost, sameTile } from "./grid";
import type { Rng } from "./rng";
import {
    critChance,
    FLANK_DAMAGE,
    flankOf,
    hitChance,
    longShotBonus,
    mitigate,
    spellDamage,
    weaponDamage,
} from "./rules";
import { affectedCombatants, areaTiles, dashLanding, ITEM_AP, MEDITATE_AP } from "./targeting";
import { STATUSES } from "../data/statuses";
import type { BattleAction, BattleEvent, BattleState, Combatant, Tile } from "./types";

/** Aplica una acción ya validada. Muta el estado y devuelve los eventos en orden. */
export function resolveAction(state: BattleState, action: BattleAction, rng: Rng): BattleEvent[] {
    const actor = state.combatants[action.actorId];

    switch (action.type) {
        case "move":
            return resolveMove(state, actor, action.path);
        case "ability":
            return resolveAbility(state, actor, ABILITIES[action.abilityId], action.target, rng);
        case "item":
            return resolveItem(state, actor, action.item, action.target);
        case "meditate": {
            const gained = Math.min(actor.res.maxMana - actor.res.mana, Math.floor(actor.res.maxMana * 0.25));
            actor.res.mana += gained;
            actor.res.ap -= MEDITATE_AP;
            return [{ t: "meditated", actorId: actor.id, manaGained: gained }];
        }
        case "defend":
            return [...applyStatus(actor, "defendiendo", 1, actor.id), { t: "defended", actorId: actor.id }];
        case "endTurn":
            return [];
    }
}

function resolveMove(state: BattleState, actor: Combatant, path: Tile[]): BattleEvent[] {
    const cost = pathCost(state, actor, path)!;
    const last = path[path.length - 1];
    const prev = path.length > 1 ? path[path.length - 2] : actor.pos;
    actor.heading = headingBetween(prev, last);
    actor.pos = { ...last };
    actor.res.mp -= cost;
    actor.movedThisTurn = true;
    return [{ t: "moved", actorId: actor.id, path: path.map((t) => ({ ...t })), heading: actor.heading, mpLeft: actor.res.mp }];
}

function resolveItem(state: BattleState, actor: Combatant, item: "pocionVida" | "pocionMana", targetTile: Tile): BattleEvent[] {
    const target = Object.values(state.combatants).find((c) => c.alive && sameTile(c.pos, targetTile))!;
    actor.consumables[item] = (actor.consumables[item] ?? 0) - 1;
    actor.res.ap -= ITEM_AP;
    const events: BattleEvent[] = [{ t: "itemUsed", actorId: actor.id, item, targetId: target.id }];

    if (item === "pocionVida") {
        events.push(...heal(target, actor.id, target.res.maxHp * 0.3));
    } else {
        const gained = Math.min(target.res.maxMana - target.res.mana, Math.floor(target.res.maxMana * 0.3));
        target.res.mana += gained;
        events.push({ t: "resources", targetId: target.id, res: { mana: target.res.mana } });
    }
    return events;
}

function resolveAbility(state: BattleState, actor: Combatant, ability: AbilityDef, target: Tile, rng: Rng): BattleEvent[] {
    const events: BattleEvent[] = [];

    actor.res.ap -= ability.apCost;
    actor.res.mana -= ability.mana;
    actor.res.stamina -= ability.stamina;
    if (ability.cooldown) actor.cooldowns[ability.id] = ability.cooldown;
    if (ability.usesPerBattle !== undefined) actor.usesThisBattle[ability.id] = (actor.usesThisBattle[ability.id] ?? 0) + 1;

    if (ability.dash) {
        const landing = dashLanding(state, actor, target)!;
        const path: Tile[] = [];
        let cur = actor.pos;
        while (!sameTile(cur, landing)) {
            const h = headingBetween(cur, landing);
            cur = { x: cur.x + (h === 3 ? 1 : h === 4 ? -1 : 0), y: cur.y + (h === 2 ? 1 : h === 1 ? -1 : 0) };
            path.push(cur);
        }
        if (path.length > 0) {
            actor.pos = { ...landing };
            events.push({ t: "moved", actorId: actor.id, path, heading: headingBetween(landing, target), mpLeft: actor.res.mp });
        }
    }

    if (ability.target !== "self" && !sameTile(actor.pos, target)) {
        actor.heading = headingBetween(actor.pos, target);
        events.push({ t: "faced", actorId: actor.id, heading: actor.heading });
    }

    if (ability.hostile) {
        for (const s of [...actor.statuses]) {
            if (STATUSES[s.id].breaksOnAttack) events.push(...removeStatus(actor, s.id));
        }
    }

    const affected = affectedCombatants(state, actor, ability, target);
    events.push({
        t: "abilityCast",
        actorId: actor.id,
        abilityId: ability.id,
        target: { ...target },
        tiles: areaTiles(state, actor, ability, target),
        affected: affected.map((c) => c.id),
    });

    if (ability.effects.some((e) => e.kind === "teleport") && isFree(state, target)) {
        const from = { ...actor.pos };
        actor.pos = { ...target };
        events.push({ t: "teleported", actorId: actor.id, from, to: { ...target } });
    }

    // Los empujes se resuelven del más lejano al más cercano para que no choquen entre sí.
    const ordered = [...affected].sort((a, b) => manhattan(actor.pos, b.pos) - manhattan(actor.pos, a.pos));
    for (const victim of ordered) {
        events.push(...applyEffects(state, actor, victim, ability, rng));
    }
    return events;
}

/** Daño al chocar contra un obstáculo, por casilla de empuje que quedó sin recorrer. */
const COLLISION_DAMAGE = 7;

/**
 * Desplaza a la víctima en línea: alejándose del lanzador (push) o hacia él (pull).
 * Si algo la frena antes de terminar, recibe daño por choque.
 */
function forcedMove(state: BattleState, actor: Combatant, victim: Combatant, tiles: number, away: boolean): BattleEvent[] {
    if (!victim.alive || sameTile(actor.pos, victim.pos)) return [];
    const heading = away ? headingBetween(actor.pos, victim.pos) : headingBetween(victim.pos, actor.pos);
    const dir = DIRECTIONS.find((d) => d.heading === heading)!;
    const path: Tile[] = [];
    let cur = victim.pos;
    let blocked = 0;
    for (let i = 0; i < tiles; i++) {
        const next = { x: cur.x + dir.dx, y: cur.y + dir.dy };
        if (!away && sameTile(next, actor.pos)) break;
        if (!isFree(state, next)) {
            blocked = tiles - i;
            break;
        }
        path.push(next);
        cur = next;
    }
    const events: BattleEvent[] = [];
    if (path.length > 0) victim.pos = { ...cur };
    const collided = away && blocked > 0;
    if (path.length > 0 || collided) events.push({ t: "pushed", targetId: victim.id, path, collided });
    if (collided) events.push(...dealDamage(victim, actor.id, COLLISION_DAMAGE * blocked, "physical", { flank: "front" }));
    return events;
}

function applyEffects(state: BattleState, actor: Combatant, victim: Combatant, ability: AbilityDef, rng: Rng): BattleEvent[] {
    const events: BattleEvent[] = [];
    const flank = flankOf(actor, victim);
    const distance = manhattan(actor.pos, victim.pos);
    let landed = true;

    for (const effect of ability.effects) {
        if (!landed) break;
        switch (effect.kind) {
            case "weapon": {
                if (!rng.chance(hitChance(actor, victim, flank))) {
                    events.push({ t: "missed", targetId: victim.id, sourceId: actor.id });
                    landed = false;
                    break;
                }
                const crit = rng.chance(critChance(actor));
                const roll = rng.int(actor.stats.hitMin, actor.stats.hitMax);
                const raw = mitigate(
                    weaponDamage(actor, roll, effect.mult) * FLANK_DAMAGE[flank] * longShotBonus(actor, distance) * (crit ? 1.5 : 1),
                    victim.stats.defense,
                );
                events.push(...dealDamage(victim, actor.id, raw, "physical", { crit, flank }));
                break;
            }
            case "damage": {
                const roll = rng.int(effect.min, effect.max);
                const raw =
                    effect.school === "physical"
                        ? mitigate(roll * FLANK_DAMAGE[flank] * longShotBonus(actor, distance), victim.stats.defense / 2)
                        : spellDamage(actor, victim, roll);
                events.push(...dealDamage(victim, actor.id, raw, effect.school, { flank }));
                break;
            }
            case "heal": {
                const roll = rng.int(effect.min, effect.max);
                // Las curas dañan a los no muertos, como en las leyendas de AO.
                if (victim.tags.includes("undead")) events.push(...dealDamage(victim, actor.id, roll, "holy", { flank }));
                else events.push(...heal(victim, actor.id, roll));
                break;
            }
            case "status": {
                const magnitude = effect.magnitude ? rng.int(effect.magnitude[0], effect.magnitude[1]) : 1;
                events.push(...applyStatus(victim, effect.status, effect.turns, actor.id, magnitude));
                break;
            }
            case "cleanse":
                for (const id of effect.statuses) events.push(...removeStatus(victim, id));
                break;
            case "push":
            case "pull":
                events.push(...forcedMove(state, actor, victim, effect.tiles, effect.kind === "push"));
                break;
            case "teleport":
                break;
            case "drain": {
                const dealt = events.reduce(
                    (sum, e) => (e.t === "damaged" && e.targetId === victim.id && e.sourceId === actor.id ? sum + e.amount : sum),
                    0,
                );
                if (dealt > 0 && actor.alive) events.push(...heal(actor, actor.id, (dealt * effect.pct) / 100));
                break;
            }
            case "revive": {
                victim.alive = true;
                victim.res.hp = Math.max(1, Math.round((victim.res.maxHp * effect.hpPct) / 100));
                events.push({ t: "revived", targetId: victim.id, hp: victim.res.hp });
                break;
            }
        }
    }
    return events;
}
