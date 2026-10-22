import { ABILITIES, type AbilityDef } from "../data/abilities";
import { forecastAbility, type Forecast } from "./forecast";
import { hasLineOfSight, inBounds, isStraightLine, manhattan, reachableTiles, sameTile, tileKey } from "./grid";
import { flatModifier, hasFlag } from "./statuses";
import type { BattleState, Combatant, Tile } from "./types";

/**
 * Lo que un combatiente puede hacer en su próximo turno: hasta dónde camina y qué casillas
 * alcanza a golpear desde ahí. Es lo que el HUD dibuja al pasar el mouse sobre un rival.
 */
export type ThreatZone = {
    unitId: string;
    /** PA y PM con los que va a arrancar su turno (con estados como Aturdido o Inmovilizado). */
    ap: number;
    mp: number;
    /** Casillas a las que puede caminar, sin contar la propia. */
    move: Tile[];
    /** Casillas que puede atacar moviéndose primero (incluye las de `move`). */
    attack: Tile[];
    /** Habilidades ofensivas que podría usar con esos PA. */
    abilities: AbilityDef[];
};

/** Lo que un rival le haría a un objetivo concreto en su próximo turno. */
export type ThreatAgainst = {
    /** La habilidad que más daño promedio hace. */
    ability: AbilityDef;
    forecast: Forecast;
    /** Cuántas veces puede usarla en un turno con sus PA, maná, energía y recarga. */
    uses: number;
    /** Daño esperado del turno completo: promedio × acierto × usos. */
    expected: number;
    /** El peor caso del turno: todo acierta con el máximo. */
    worst: number;
};

/** PA y PM con los que arranca su próximo turno. */
export function nextTurnBudget(c: Combatant): { ap: number; mp: number } {
    return {
        ap: Math.max(0, c.res.maxAp + flatModifier(c, "ap")),
        mp: hasFlag(c, "rooted") ? 0 : Math.max(0, c.res.maxMp + flatModifier(c, "mp")),
    };
}

function offensive(c: Combatant, ap: number): AbilityDef[] {
    return c.abilities
        .map((id) => ABILITIES[id])
        .filter(
            (a): a is AbilityDef =>
                Boolean(a) &&
                a.hostile &&
                a.apCost <= ap &&
                c.res.mana >= a.mana &&
                c.res.stamina >= a.stamina &&
                // La recarga baja al terminar su turno: con 1 ya la tiene lista la próxima vez.
                (c.cooldowns[a.id] ?? 0) <= 1,
        );
}

/** Si `ability` lanzada desde `from` llega a la casilla `t`, sin mirar si hay alguien. */
function canHit(state: BattleState, from: Tile, ability: AbilityDef, t: Tile): boolean {
    if (!inBounds(state.grid, t)) return false;
    const d = manhattan(from, t);
    if (ability.target === "self") {
        const area = ability.area;
        if (area.kind === "cross") return d > 0 && d <= area.radius && (from.x === t.x || from.y === t.y);
        return area.kind === "circle" && d > 0 && d <= area.radius;
    }
    if (d < Math.max(1, ability.minRange) || d > ability.maxRange) return false;
    if (ability.straightLine && !isStraightLine(from, t)) return false;
    return !ability.los || d <= 1 || hasLineOfSight(state.grid, from, t);
}

/** Casillas que `ability` alcanza lanzada desde `from`. */
function castTiles(state: BattleState, from: Tile, ability: AbilityDef): Tile[] {
    const r = ability.target === "self" ? (ability.area.kind === "circle" || ability.area.kind === "cross" ? ability.area.radius : 0) : ability.maxRange;
    const out: Tile[] = [];
    for (let dx = -r; dx <= r; dx++) {
        const span = r - Math.abs(dx);
        for (let dy = -span; dy <= span; dy++) {
            const t = { x: from.x + dx, y: from.y + dy };
            if (canHit(state, from, ability, t)) out.push(t);
        }
    }
    return out;
}

/** Zona de amenaza de `unit` para su próximo turno. */
export function threatZone(state: BattleState, unit: Combatant): ThreatZone {
    const { ap, mp } = nextTurnBudget(unit);
    const reach = reachableTiles(state, unit, mp);
    const abilities = offensive(unit, ap);
    const move: Tile[] = [];
    const attack = new Map<string, Tile>();

    for (const node of reach.values()) {
        if (!sameTile(node.tile, unit.pos)) move.push(node.tile);
        for (const ability of abilities) {
            // Embestida se mueve sola; el resto no deja PA para caminar después, así que no sumamos PM.
            for (const t of castTiles(state, node.tile, ability)) attack.set(tileKey(t), t);
        }
    }
    return { unitId: unit.id, ap, mp, move, attack: [...attack.values()], abilities };
}

/** Cuántas veces entra `ability` en un turno con estos recursos. */
export function usesPerTurn(c: Combatant, ability: AbilityDef, ap: number): number {
    let uses = Math.floor(ap / Math.max(1, ability.apCost));
    if (ability.mana > 0) uses = Math.min(uses, Math.floor(c.res.mana / ability.mana));
    if (ability.stamina > 0) uses = Math.min(uses, Math.floor(c.res.stamina / ability.stamina));
    if (ability.cooldown) uses = Math.min(uses, 1);
    return Math.max(0, uses);
}

/**
 * Lo peor que `unit` puede hacerle a `target` el próximo turno, eligiendo la casilla y la habilidad
 * con más daño promedio por turno. null si no lo alcanza.
 */
export function threatAgainst(state: BattleState, unit: Combatant, target: Combatant): ThreatAgainst | null {
    const { ap, mp } = nextTurnBudget(unit);
    const reach = reachableTiles(state, unit, mp);
    let best: ThreatAgainst | null = null;

    for (const ability of offensive(unit, ap)) {
        const uses = usesPerTurn(unit, ability, ap);
        if (uses === 0) continue;
        for (const node of reach.values()) {
            if (!canHit(state, node.tile, ability, target.pos)) continue;
            // Simula al rival parado en esa casilla, sin tocar el estado.
            const ghost: Combatant = { ...unit, pos: node.tile };
            const forecast = forecastAbility(ghost, target, ability, state);
            if (!forecast || forecast.kind !== "damage") continue;
            const avg = (forecast.min + forecast.max) / 2;
            const expected = Math.round(avg * (forecast.hitChance / 100) * uses);
            const worst = Math.round((forecast.critChance > 0 ? forecast.max * 1.5 : forecast.max) * uses);
            if (!best || expected > best.expected) best = { ability, forecast, uses, expected, worst };
        }
    }
    return best;
}

/** Cuántos rivales de `team` pueden atacar cada casilla el próximo turno. Clave: tileKey. */
export function dangerMap(state: BattleState, team: Combatant["team"]): Map<string, number> {
    const map = new Map<string, number>();
    for (const c of Object.values(state.combatants)) {
        if (!c.alive || c.team !== team) continue;
        for (const t of threatZone(state, c).attack) {
            const key = tileKey(t);
            map.set(key, (map.get(key) ?? 0) + 1);
        }
    }
    return map;
}
