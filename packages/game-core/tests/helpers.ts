import { BattleEngine, createBattle, createEnemy, createGrid, createHero, type Combatant, type Tile } from "../src";

export function duel(hero: Combatant, enemies: Combatant[], heroPos: Tile, enemyPos: Tile | Tile[], seed = 42) {
    const positions = Array.isArray(enemyPos) ? enemyPos : [enemyPos];
    const grid = createGrid(15, 11);
    const state = createBattle({ id: "test", seed, grid, heroes: [hero], enemies });
    hero.pos = heroPos;
    enemies.forEach((e, i) => (e.pos = positions[i]));
    let now = 1_000;
    const engine = new BattleEngine(state, { now: () => now, turnTimeMs: 45_000 });
    return { state, engine, tick: (ms: number) => (now += ms) };
}

export { createEnemy, createHero };
