import type { BattleGrid, BattleState, Combatant, Heading, Tile } from "./types";

export const DIRECTIONS: ReadonlyArray<{ heading: Heading; dx: number; dy: number }> = [
    { heading: 1, dx: 0, dy: -1 },
    { heading: 2, dx: 0, dy: 1 },
    { heading: 3, dx: 1, dy: 0 },
    { heading: 4, dx: -1, dy: 0 },
];

export const tileKey = (t: Tile): string => `${t.x},${t.y}`;

export const sameTile = (a: Tile, b: Tile): boolean => a.x === b.x && a.y === b.y;

export const manhattan = (a: Tile, b: Tile): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function inBounds(grid: BattleGrid, t: Tile): boolean {
    return t.x >= 0 && t.y >= 0 && t.x < grid.width && t.y < grid.height;
}

export function isBlocked(grid: BattleGrid, t: Tile): boolean {
    return !inBounds(grid, t) || grid.blocked[t.y * grid.width + t.x] === 1;
}

function blocksSight(grid: BattleGrid, t: Tile): boolean {
    return !inBounds(grid, t) || grid.blocksSight[t.y * grid.width + t.x] === 1;
}

export function combatantAt(state: BattleState, t: Tile): Combatant | undefined {
    for (const c of Object.values(state.combatants)) {
        if (c.alive && sameTile(c.pos, t)) return c;
    }
    return undefined;
}

export function deadCombatantAt(state: BattleState, t: Tile): Combatant | undefined {
    for (const c of Object.values(state.combatants)) {
        if (!c.alive && sameTile(c.pos, t)) return c;
    }
    return undefined;
}

export function isFree(state: BattleState, t: Tile): boolean {
    return !isBlocked(state.grid, t) && !combatantAt(state, t);
}

export function headingBetween(from: Tile, to: Tile): Heading {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx > 0 ? 3 : 4;
    return dy > 0 ? 2 : 1;
}

/** Guerrero: salir de una casilla adyacente a un enemigo con zona de control cuesta 1 PM extra. */
function exitCost(state: BattleState, mover: Combatant, from: Tile): number {
    for (const { dx, dy } of DIRECTIONS) {
        const other = combatantAt(state, { x: from.x + dx, y: from.y + dy });
        if (other && other.team !== mover.team && other.tags.includes("zoneOfControl")) return 1;
    }
    return 0;
}

export type Reach = Map<string, { tile: Tile; cost: number; prev: string | null }>;

/** Casillas alcanzables con los PM indicados (Dijkstra sobre una grilla de costo 1 + zona de control). */
export function reachableTiles(state: BattleState, mover: Combatant, mp: number): Reach {
    const reach: Reach = new Map();
    const startKey = tileKey(mover.pos);
    reach.set(startKey, { tile: mover.pos, cost: 0, prev: null });
    const open: string[] = [startKey];

    while (open.length > 0) {
        open.sort((a, b) => reach.get(a)!.cost - reach.get(b)!.cost);
        const key = open.shift()!;
        const node = reach.get(key)!;
        const stepCost = 1 + exitCost(state, mover, node.tile);

        for (const { dx, dy } of DIRECTIONS) {
            const next = { x: node.tile.x + dx, y: node.tile.y + dy };
            if (!isFree(state, next)) continue;
            const cost = node.cost + stepCost;
            if (cost > mp) continue;
            const nextKey = tileKey(next);
            const known = reach.get(nextKey);
            if (known && known.cost <= cost) continue;
            reach.set(nextKey, { tile: next, cost, prev: key });
            open.push(nextKey);
        }
    }
    return reach;
}

/** Reconstruye el camino (sin la casilla de origen) hasta un destino calculado con reachableTiles. */
export function pathTo(reach: Reach, dest: Tile): Tile[] | null {
    const path: Tile[] = [];
    let key: string | null = tileKey(dest);
    if (!reach.has(key)) return null;
    while (key) {
        const node: { tile: Tile; prev: string | null } = reach.get(key)!;
        if (node.prev === null) break;
        path.unshift(node.tile);
        key = node.prev;
    }
    return path;
}

/** Costo en PM de recorrer un camino ya validado, o null si el camino es ilegal. */
export function pathCost(state: BattleState, mover: Combatant, path: Tile[]): number | null {
    let cost = 0;
    let current = mover.pos;
    for (const step of path) {
        if (manhattan(current, step) !== 1 || !isFree(state, step)) return null;
        cost += 1 + exitCost(state, mover, current);
        current = step;
    }
    return cost;
}

/** Línea de visión con Bresenham; las casillas extremas no cuentan, los combatientes no la cortan. */
export function hasLineOfSight(grid: BattleGrid, from: Tile, to: Tile): boolean {
    let x0 = from.x;
    let y0 = from.y;
    const dx = Math.abs(to.x - x0);
    const dy = -Math.abs(to.y - y0);
    const sx = x0 < to.x ? 1 : -1;
    const sy = y0 < to.y ? 1 : -1;
    let err = dx + dy;

    for (;;) {
        if (x0 === to.x && y0 === to.y) return true;
        const e2 = 2 * err;
        if (e2 >= dy) {
            err += dy;
            x0 += sx;
        }
        if (e2 <= dx) {
            err += dx;
            y0 += sy;
        }
        if (x0 === to.x && y0 === to.y) return true;
        if (blocksSight(grid, { x: x0, y: y0 })) return false;
    }
}

export function isStraightLine(from: Tile, to: Tile): boolean {
    return from.x === to.x || from.y === to.y;
}
