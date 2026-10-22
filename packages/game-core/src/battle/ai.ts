import { ABILITIES, type AbilityDef } from "../data/abilities";
import type { BattleEngine } from "./engine";
import { hasLineOfSight, manhattan, pathTo, reachableTiles, tileKey } from "./grid";
import { critChance, FLANK_DAMAGE, flankOf, hitChance, mitigate, spellDamage, weaponDamage } from "./rules";
import { hasStatus } from "./statuses";
import { abilityCosts, affectedCombatants, checkTarget } from "./targeting";
import type { BattleAction, BattleEvent, BattleState, Combatant, StatusId, Tile } from "./types";

/**
 * IA por utilidad: prueba cada habilidad desde cada casilla alcanzable, estima el valor
 * del resultado y elige la mejor. Recicla la idea de targetScoreWeights de npcs.ts
 * (preferir objetivos cercanos y heridos) pero en términos de turnos.
 */

type Plan = { score: number; moveTo: Tile | null; ability: AbilityDef; target: Tile };

const STATUS_VALUE: Partial<Record<StatusId, number>> = {
    paralizado: 45,
    inmovilizado: 14,
    aturdido: 16,
    envenenado: 12,
    quemadura: 8,
    provocado: 12,
    debilidad: 10,
    torpeza: 10,
    fuerza: 12,
    celeridad: 12,
};

function enemiesOf(state: BattleState, c: Combatant): Combatant[] {
    return Object.values(state.combatants).filter((o) => o.alive && o.team !== c.team);
}

function alliesOf(state: BattleState, c: Combatant): Combatant[] {
    return Object.values(state.combatants).filter((o) => o.alive && o.team === c.team);
}

function expectedValue(state: BattleState, actor: Combatant, ability: AbilityDef, target: Tile): number {
    let value = 0;
    for (const victim of affectedCombatants(state, actor, ability, target)) {
        const sign = victim.team === actor.team ? -1.5 : 1;
        let hitP = 1;
        let damage = 0;

        for (const effect of ability.effects) {
            switch (effect.kind) {
                case "weapon": {
                    const flank = flankOf(actor, victim);
                    hitP = hitChance(actor, victim, flank) / 100;
                    const avg = (actor.stats.hitMin + actor.stats.hitMax) / 2;
                    const crit = 1 + (critChance(actor) / 100) * 0.5;
                    damage += mitigate(weaponDamage(actor, avg, effect.mult) * FLANK_DAMAGE[flank] * crit, victim.stats.defense) * hitP;
                    break;
                }
                case "damage":
                    damage += Math.max(1, spellDamage(actor, victim, (effect.min + effect.max) / 2));
                    break;
                case "heal": {
                    if (victim.tags.includes("undead")) {
                        damage += (effect.min + effect.max) / 2;
                        break;
                    }
                    const missing = victim.res.maxHp - victim.res.hp;
                    if (missing / victim.res.maxHp > 0.2) value += Math.min(missing, (effect.min + effect.max) / 2) * 1.3;
                    break;
                }
                case "status":
                    if (!hasStatus(victim, effect.status) && !victim.immunities.includes(effect.status)) {
                        value += sign * (STATUS_VALUE[effect.status] ?? 6) * hitP;
                    }
                    break;
                case "cleanse":
                    if (effect.statuses.some((s) => hasStatus(victim, s))) value += 25;
                    break;
                case "revive":
                    value += 80;
                    break;
            }
        }

        if (damage > 0) {
            const capped = Math.min(damage, victim.res.hp);
            value += sign * capped;
            if (sign > 0 && damage >= victim.res.hp) value += 40;
            // Prioriza rematar a los heridos, como el targetScore de npcs.ts.
            if (sign > 0) value += (1 - victim.res.hp / victim.res.maxHp) * 10;
        }
    }
    // Normaliza por PA para no gastar todo en una habilidad cara que rinde poco.
    return value - ability.apCost * 0.2 - (ability.mana > 0 ? ability.mana / 200 : 0) - ability.stamina / 20;
}

function positionPenalty(state: BattleState, actor: Combatant, tile: Tile): number {
    if (actor.archetype === "melee" || actor.archetype === "support") return 0;
    let penalty = 0;
    for (const enemy of enemiesOf(state, actor)) {
        if (manhattan(enemy.pos, tile) === 1) penalty += 12;
    }
    return penalty;
}

function bestPlan(state: BattleState, actor: Combatant): Plan | null {
    const reach = reachableTiles(state, actor, actor.res.mp);
    const origin = actor.pos;
    let best: Plan | null = null;

    for (const id of actor.abilities) {
        const ability = ABILITIES[id];
        if (!ability || abilityCosts(actor, ability)) continue;

        for (const node of reach.values()) {
            actor.pos = node.tile;
            for (let dx = -ability.maxRange; dx <= ability.maxRange; dx++) {
                const span = ability.maxRange - Math.abs(dx);
                for (let dy = -span; dy <= span; dy++) {
                    const target = { x: node.tile.x + dx, y: node.tile.y + dy };
                    if (checkTarget(state, actor, ability, target)) continue;
                    const score = expectedValue(state, actor, ability, target) - node.cost * 0.3 - positionPenalty(state, actor, node.tile);
                    if (score > 0 && (!best || score > best.score)) {
                        best = { score, moveTo: node.cost > 0 ? node.tile : null, ability, target };
                    }
                }
            }
        }
    }
    actor.pos = origin;
    return best;
}

/** Casilla a la que conviene ir cuando no hay nada útil para hacer desde aquí. */
function repositionTarget(state: BattleState, actor: Combatant): Tile | null {
    const enemies = enemiesOf(state, actor);
    if (enemies.length === 0 || actor.res.mp === 0) return null;
    const reach = reachableTiles(state, actor, actor.res.mp);
    const preferred = actor.archetype === "melee" ? 1 : actor.archetype === "support" ? 3 : 4;
    let best: { tile: Tile; score: number } | null = null;

    for (const node of reach.values()) {
        const nearest = Math.min(...enemies.map((e) => manhattan(e.pos, node.tile)));
        let score = -Math.abs(nearest - preferred) * 3 - positionPenalty(state, actor, node.tile);
        if (actor.archetype !== "melee" && enemies.some((e) => hasLineOfSight(state.grid, node.tile, e.pos))) score += 2;
        if (actor.archetype === "support") {
            const hurt = alliesOf(state, actor).sort((a, b) => a.res.hp / a.res.maxHp - b.res.hp / b.res.maxHp)[0];
            if (hurt) score -= manhattan(hurt.pos, node.tile);
        }
        if (!best || score > best.score) best = { tile: node.tile, score };
    }
    return best && tileKey(best.tile) !== tileKey(actor.pos) ? best.tile : null;
}

/** Elige la próxima acción de la IA, o null para pasar el turno. */
export function chooseAiAction(state: BattleState, actorId: string): BattleAction[] {
    const actor = state.combatants[actorId];
    const plan = bestPlan(state, actor);
    if (plan) {
        const actions: BattleAction[] = [];
        if (plan.moveTo) {
            const path = pathTo(reachableTiles(state, actor, actor.res.mp), plan.moveTo);
            if (path && path.length > 0) actions.push({ type: "move", actorId, path });
        }
        actions.push({ type: "ability", actorId, abilityId: plan.ability.id, target: plan.target });
        return actions;
    }

    const dest = repositionTarget(state, actor);
    if (dest) {
        const path = pathTo(reachableTiles(state, actor, actor.res.mp), dest);
        if (path && path.length > 0) return [{ type: "move", actorId, path }];
    }
    return [];
}

/** Juega el turno completo del combatiente activo. */
export function aiTakeTurn(engine: BattleEngine): BattleEvent[] {
    const events: BattleEvent[] = [];
    const phase = engine.state.phase;
    if (phase.kind !== "awaitingAction") return events;
    const actorId = phase.actorId;

    for (let guard = 0; guard < 8; guard++) {
        const current = engine.state.phase;
        if (current.kind !== "awaitingAction" || current.actorId !== actorId) return events;

        const actions = chooseAiAction(engine.state as BattleState, actorId);
        if (actions.length === 0) break;

        let progressed = false;
        for (const action of actions) {
            const result = engine.submit(action);
            if (!result.ok) break;
            progressed = true;
            events.push(...result.value);
            const after = engine.state.phase;
            if (after.kind !== "awaitingAction" || after.actorId !== actorId) return events;
        }
        if (!progressed) break;
    }

    const end = engine.state.phase;
    if (end.kind === "awaitingAction" && end.actorId === actorId) {
        const actor = engine.state.combatants[actorId];
        const threatened = enemiesOf(engine.state as BattleState, actor).some((e) => manhattan(e.pos, actor.pos) === 1);
        const result = engine.submit({ type: threatened ? "defend" : "endTurn", actorId });
        if (result.ok) events.push(...result.value);
    }
    return events;
}

