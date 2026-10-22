import { ABILITIES, type AbilityDef } from "../data/abilities";
import type { BattleEngine } from "./engine";
import { hasLineOfSight, manhattan, pathTo, reachableTiles, tileKey } from "./grid";
import { critChance, FLANK_DAMAGE, flankOf, hitChance, mitigate, spellDamage, weaponDamage } from "./rules";
import { hasStatus } from "./statuses";
import { abilityCosts, affectedCombatants, checkTarget } from "./targeting";
import { STATUSES } from "../data/statuses";
import type { BattleAction, BattleEvent, BattleState, Behavior, Combatant, StatusId, Tile } from "./types";

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
    ralentizado: 14,
    caparazon: 14,
};

/* ------------------------------------------------------------------ */
/* Personalidades de movimiento                                        */
/* ------------------------------------------------------------------ */

function hpRatio(c: Combatant): number {
    return c.res.hp / Math.max(1, c.res.maxHp);
}

/** Personalidad efectiva: los no-brutos que están malheridos pasan a escapar. */
export function behaviorOf(c: Combatant): Behavior {
    const base: Behavior =
        c.behavior ?? (c.archetype === "melee" ? "charger" : c.archetype === "support" ? "guardian" : "kiter");
    if (c.team === "enemies" && base !== "brute" && !c.tags.includes("boss") && hpRatio(c) < 0.25) return "coward";
    return base;
}

function rangeOf(c: Combatant, behavior: Behavior): [number, number] {
    if (c.preferredRange) return c.preferredRange;
    if (behavior === "kiter") return [3, 5];
    if (behavior === "skirmisher") return [2, 4];
    return [1, 1];
}

/** Casilla detrás del enemigo según hacia dónde mira (1 arriba, 2 abajo, 3 derecha, 4 izquierda). */
function backOf(enemy: Combatant): Tile {
    const d = { 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] }[enemy.heading] ?? [0, 1];
    return { x: enemy.pos.x + d[0], y: enemy.pos.y + d[1] };
}

/**
 * Cuánto le gusta a `actor` estar parado en `tile`, según su personalidad.
 * Es lo que hace que una manada rodee, que un arquero se aleje y que un coloso avance sin más.
 */
export function positionalValue(state: BattleState, actor: Combatant, tile: Tile, behavior = behaviorOf(actor)): number {
    const enemies = enemiesOf(state, actor);
    if (enemies.length === 0) return 0;
    let nearest = enemies[0];
    let d = Infinity;
    let adjacent = 0;
    for (const e of enemies) {
        const dist = manhattan(e.pos, tile);
        if (dist < d) {
            d = dist;
            nearest = e;
        }
        if (dist === 1) adjacent += 1;
    }
    const [lo, hi] = rangeOf(actor, behavior);
    const inBand = (w: number) => (d < lo ? -(lo - d) * w : d > hi ? -(d - hi) * 2 : 4);
    const sight = enemies.some((e) => hasLineOfSight(state.grid, tile, e.pos)) ? 3 : 0;

    switch (behavior) {
        case "charger":
            return -d * 2;
        case "brute":
            return -d * 2.5;
        case "flanker": {
            let v = -d * 2;
            const back = backOf(nearest);
            if (back.x === tile.x && back.y === tile.y) v += 7;
            else if (d === 1 && nearest.pos.x !== tile.x && nearest.pos.y !== tile.y) v += 0;
            else if (d === 1) v += 3;
            // La manada se reparte: no le gusta pegarse a otro miembro.
            for (const ally of alliesOf(state, actor)) {
                if (ally.id !== actor.id && manhattan(ally.pos, tile) === 1) v -= 2;
            }
            return v;
        }
        case "kiter":
            return inBand(7) - adjacent * 10 + sight;
        case "skirmisher":
            return inBand(5) - adjacent * 6 + sight;
        case "guardian": {
            const hurt = alliesOf(state, actor)
                .filter((a) => a.id !== actor.id)
                .sort((a, b) => hpRatio(a) - hpRatio(b))[0];
            return -(hurt ? manhattan(hurt.pos, tile) : 0) * 2 - Math.max(0, d - 3);
        }
        case "coward":
            return d * 4 - adjacent * 15;
    }
}

/** Peso de la posición al elegir desde dónde atacar. */
const POSITION_WEIGHT: Record<Behavior, number> = {
    charger: 0,
    brute: 0,
    flanker: 0.6,
    kiter: 1,
    skirmisher: 0.3,
    guardian: 0.5,
    coward: 1.5,
};

function enemiesOf(state: BattleState, c: Combatant): Combatant[] {
    return Object.values(state.combatants).filter((o) => o.alive && o.team !== c.team);
}

function alliesOf(state: BattleState, c: Combatant): Combatant[] {
    return Object.values(state.combatants).filter((o) => o.alive && o.team === c.team);
}

function expectedValue(state: BattleState, actor: Combatant, ability: AbilityDef, target: Tile): number {
    let value = 0;
    if (ability.effects.some((e) => e.kind === "teleport")) {
        // Parpadeo: vale lo que mejora la posición, y solo si la mejora es clara.
        const gain = positionalValue(state, actor, target) - positionalValue(state, actor, actor.pos);
        value += gain > 6 ? gain : -5;
    }
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
                        // Un buff vale en un aliado y un debuff en un enemigo; al revés, resta.
                        const good = (STATUSES[effect.status].kind === "buff") === (victim.team === actor.team);
                        value += (good ? 1 : -1.5) * (STATUS_VALUE[effect.status] ?? 6) * hitP;
                    }
                    break;
                case "push":
                    if (victim.team !== actor.team) {
                        value += effect.tiles * 3 * hitP;
                        // Para quien pelea a distancia, sacarse de encima a alguien vale mucho.
                        const b = behaviorOf(actor);
                        if ((b === "kiter" || b === "skirmisher") && manhattan(victim.pos, actor.pos) === 1) value += 12 * hitP;
                    }
                    break;
                case "pull":
                    if (victim.team !== actor.team) {
                        const b = behaviorOf(actor);
                        value += (b === "kiter" || b === "coward" ? -6 : 8) * hitP;
                    }
                    break;
                case "drain":
                    value += ((1 - hpRatio(actor)) * effect.pct) / 4;
                    break;
                case "teleport":
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
    // Las personalidades con criterio propio ya pesan la cercanía en positionalValue.
    if (actor.behavior || actor.archetype === "melee" || actor.archetype === "support") return 0;
    let penalty = 0;
    for (const enemy of enemiesOf(state, actor)) {
        if (manhattan(enemy.pos, tile) === 1) penalty += 12;
    }
    return penalty;
}

function bestPlan(state: BattleState, actor: Combatant): Plan | null {
    const reach = reachableTiles(state, actor, actor.res.mp);
    const origin = actor.pos;
    const behavior = behaviorOf(actor);
    const weight = POSITION_WEIGHT[behavior];
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
                    const score =
                        expectedValue(state, actor, ability, target) -
                        node.cost * 0.3 +
                        (weight > 0 ? weight * positionalValue(state, actor, node.tile, behavior) : 0) -
                        positionPenalty(state, actor, node.tile);
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

/** Casilla a la que conviene ir cuando no hay nada útil para hacer desde aquí (acercarse, rodear o alejarse). */
function repositionTarget(state: BattleState, actor: Combatant): Tile | null {
    const enemies = enemiesOf(state, actor);
    if (enemies.length === 0 || actor.res.mp === 0) return null;
    const reach = reachableTiles(state, actor, actor.res.mp);
    let behavior = behaviorOf(actor);
    // Pega y se aleja: si ya no le quedan PA para otro golpe, se retira a su distancia.
    if (behavior === "skirmisher" && actor.res.ap < 3) behavior = "kiter";
    const current = positionalValue(state, actor, actor.pos, behavior);
    let best: { tile: Tile; score: number } | null = null;

    for (const node of reach.values()) {
        const score = positionalValue(state, actor, node.tile, behavior) - node.cost * 0.1 - positionPenalty(state, actor, node.tile);
        if (!best || score > best.score) best = { tile: node.tile, score };
    }
    if (!best || tileKey(best.tile) === tileKey(actor.pos) || best.score <= current + 0.5) return null;
    return best.tile;
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

