import { ABILITIES, type AbilityDef } from "../data/abilities";
import {
    combatantAt,
    deadCombatantAt,
    DIRECTIONS,
    hasLineOfSight,
    headingBetween,
    inBounds,
    isFree,
    isStraightLine,
    manhattan,
    pathCost,
} from "./grid";
import { hasFlag, tauntSource } from "./statuses";
import type { BattleAction, BattleError, BattleState, Combatant, Tile } from "./types";

/** Casillas que cubre una habilidad apuntada a `target`. */
export function areaTiles(state: BattleState, caster: Combatant, ability: AbilityDef, target: Tile): Tile[] {
    const area = ability.area;
    const tiles: Tile[] = [];

    switch (area.kind) {
        case "single":
            tiles.push(target);
            break;
        case "cross":
            tiles.push(target);
            for (const { dx, dy } of DIRECTIONS) {
                for (let r = 1; r <= area.radius; r++) tiles.push({ x: target.x + dx * r, y: target.y + dy * r });
            }
            break;
        case "circle":
            for (let dx = -area.radius; dx <= area.radius; dx++) {
                for (let dy = -area.radius; dy <= area.radius; dy++) {
                    if (Math.abs(dx) + Math.abs(dy) <= area.radius) tiles.push({ x: target.x + dx, y: target.y + dy });
                }
            }
            break;
        case "line": {
            const heading = headingBetween(caster.pos, target);
            const dir = DIRECTIONS.find((d) => d.heading === heading)!;
            for (let r = 1; r <= area.length; r++) tiles.push({ x: caster.pos.x + dir.dx * r, y: caster.pos.y + dir.dy * r });
            break;
        }
    }
    return tiles.filter((t) => inBounds(state.grid, t));
}

/** Combatientes alcanzados por una habilidad, respetando a quién puede afectar. */
export function affectedCombatants(state: BattleState, caster: Combatant, ability: AbilityDef, target: Tile): Combatant[] {
    if (ability.target === "deadAlly") {
        const dead = deadCombatantAt(state, target);
        return dead && dead.team === caster.team ? [dead] : [];
    }

    const result: Combatant[] = [];
    for (const tile of areaTiles(state, caster, ability, target)) {
        const c = combatantAt(state, tile);
        if (!c) continue;
        const isAlly = c.team === caster.team;
        // Lo hostil va primero: Barrido y Pisotón se apuntan a uno mismo pero pegan a los rivales de alrededor.
        if (ability.hostile) {
            if (!isAlly || ability.friendlyFire) result.push(c);
        } else if (ability.target === "ally" || ability.target === "self") {
            if (isAlly) result.push(c);
        } else {
            result.push(c);
        }
    }
    return result;
}

/** Para Embestida: casilla adyacente al objetivo, en la línea, adonde llega el lanzador. */
export function dashLanding(state: BattleState, caster: Combatant, target: Tile): Tile | null {
    const heading = headingBetween(caster.pos, target);
    const dir = DIRECTIONS.find((d) => d.heading === heading)!;
    const landing = { x: target.x - dir.dx, y: target.y - dir.dy };
    let cur = { ...caster.pos };
    while (cur.x !== landing.x || cur.y !== landing.y) {
        cur = { x: cur.x + dir.dx, y: cur.y + dir.dy };
        if (!isFree(state, cur)) return null;
    }
    return landing;
}

export function abilityCosts(caster: Combatant, ability: AbilityDef): BattleError | null {
    if (caster.res.ap < ability.apCost) return "not_enough_ap";
    if (caster.res.mana < ability.mana) return "not_enough_mana";
    if (caster.res.stamina < ability.stamina) return "not_enough_stamina";
    if ((caster.cooldowns[ability.id] ?? 0) > 0) return "on_cooldown";
    if (ability.usesPerBattle !== undefined && (caster.usesThisBattle[ability.id] ?? 0) >= ability.usesPerBattle) {
        return "no_uses_left";
    }
    return null;
}

/** Valida alcance, línea de visión y objetivo. No mira recursos. */
export function checkTarget(state: BattleState, caster: Combatant, ability: AbilityDef, target: Tile): BattleError | null {
    if (!inBounds(state.grid, target)) return "out_of_range";
    const distance = manhattan(caster.pos, target);

    if (ability.target === "self") {
        return distance === 0 ? null : "invalid_target";
    }
    if (distance < ability.minRange || distance > ability.maxRange) return "out_of_range";
    if (ability.straightLine && !isStraightLine(caster.pos, target)) return "out_of_range";
    if (ability.los && distance > 1 && !hasLineOfSight(state.grid, caster.pos, target)) return "no_line_of_sight";

    const occupant = combatantAt(state, target);
    switch (ability.target) {
        case "enemy": {
            if (!occupant || occupant.team === caster.team) return "invalid_target";
            if (hasFlag(occupant, "hiddenAtRange") && distance > 2) return "invalid_target";
            const taunter = tauntSource(caster);
            if (taunter && occupant.id !== taunter && state.combatants[taunter]?.alive) return "taunted";
            break;
        }
        case "ally":
            if (!occupant || occupant.team !== caster.team) return "invalid_target";
            break;
        case "deadAlly": {
            const dead = deadCombatantAt(state, target);
            if (!dead || dead.team !== caster.team || occupant) return "invalid_target";
            break;
        }
        case "any":
            break;
        case "emptyTile":
            if (!isFree(state, target)) return "invalid_target";
            break;
    }

    if (ability.dash && !dashLanding(state, caster, target)) return "invalid_path";
    return null;
}

export function validateAction(state: BattleState, action: BattleAction): BattleError | null {
    const actor = state.combatants[action.actorId];
    if (!actor || !actor.alive) return "unknown_actor";

    switch (action.type) {
        case "move": {
            if (action.path.length === 0) return "invalid_path";
            if (hasFlag(actor, "rooted")) return "rooted";
            const cost = pathCost(state, actor, action.path);
            if (cost === null) return "invalid_path";
            if (cost > actor.res.mp) return "not_enough_mp";
            return null;
        }
        case "ability": {
            const ability = ABILITIES[action.abilityId];
            if (!ability || !actor.abilities.includes(action.abilityId)) return "unknown_ability";
            return abilityCosts(actor, ability) ?? checkTarget(state, actor, ability, action.target);
        }
        case "item": {
            if ((actor.consumables[action.item] ?? 0) <= 0) return "no_item";
            if (actor.res.ap < 2) return "not_enough_ap";
            const target = combatantAt(state, action.target);
            if (!target || target.team !== actor.team || manhattan(actor.pos, target.pos) > 1) return "invalid_target";
            return null;
        }
        case "meditate":
            if (actor.res.maxMana === 0) return "invalid_target";
            if (actor.movedThisTurn) return "already_moved";
            if (actor.res.ap < MEDITATE_AP) return "not_enough_ap";
            return null;
        case "defend":
        case "endTurn":
            return null;
    }
}

export const MEDITATE_AP = 4;
export const ITEM_AP = 2;

export function abilityById(id: string): AbilityDef | undefined {
    return ABILITIES[id];
}
