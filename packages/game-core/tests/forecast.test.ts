import { describe, expect, it } from "vitest";
import { ABILITIES, BattleEngine, createBattle, createEnemy, createGrid, createHero, forecastAbility } from "../src";

/** Lanza la habilidad con varias semillas y devuelve el daño real de cada tiro que acertó. */
function rolls(abilityId: string, heroClass: 1 | 8 | 9, distance: number) {
    const amounts: number[] = [];
    let forecast = null as ReturnType<typeof forecastAbility>;
    for (let seed = 1; seed <= 40; seed++) {
        const hero = createHero({ characterId: "h", name: "H", classId: heroClass, level: 20 });
        const wolf = createEnemy("lobo", 0);
        wolf.res.hp = wolf.res.maxHp = 5000;
        const state = createBattle({ id: `f${seed}`, seed, grid: createGrid(15, 11), heroes: [hero], enemies: [wolf] });
        const h = state.combatants[hero.id];
        const w = state.combatants[wolf.id];
        h.pos = { x: 2, y: 5 };
        w.pos = { x: 2 + distance, y: 5 };
        h.heading = 3;
        w.heading = 4;
        const engine = new BattleEngine(state, { now: () => 0 });
        engine.begin();
        for (let i = 0; i < 10 && !(state.phase.kind === "awaitingAction" && state.phase.actorId === h.id); i++) {
            if (state.phase.kind === "awaitingAction") engine.submit({ type: "endTurn", actorId: state.phase.actorId });
        }
        w.pos = { x: 2 + distance, y: 5 };
        w.heading = 4;
        forecast = forecastAbility(h, w, ABILITIES[abilityId]);
        const result = engine.submit({ type: "ability", actorId: h.id, abilityId, target: w.pos });
        if (!result.ok) throw new Error(result.error);
        for (const e of result.value) if (e.t === "damaged" && e.targetId === w.id && !e.crit) amounts.push(e.amount);
    }
    return { forecast: forecast!, amounts };
}

describe("previsión de daño", () => {
    it("los hechizos no fallan y caen dentro del rango previsto", () => {
        const { forecast, amounts } = rolls("dardo_magico", 1, 3);
        expect(forecast.hitChance).toBe(100);
        expect(amounts.length).toBeGreaterThan(0);
        for (const a of amounts) {
            expect(a).toBeGreaterThanOrEqual(forecast.min);
            expect(a).toBeLessThanOrEqual(forecast.max);
        }
    });

    it("los golpes con arma respetan el rango sin crítico", () => {
        const { forecast, amounts } = rolls("golpe", 8, 1);
        expect(forecast.hitChance).toBeLessThan(100);
        expect(amounts.length).toBeGreaterThan(0);
        for (const a of amounts) {
            expect(a).toBeGreaterThanOrEqual(forecast.min);
            expect(a).toBeLessThanOrEqual(forecast.max);
        }
    });

    it("marca como letal un golpe que no deja vivo al objetivo", () => {
        const hero = createHero({ characterId: "h", name: "H", classId: 1, level: 20 });
        const wolf = createEnemy("lobo", 0);
        hero.pos = { x: 1, y: 1 };
        wolf.pos = { x: 4, y: 1 };
        wolf.res.hp = 1;
        const forecast = forecastAbility(hero, wolf, ABILITIES.proyectil_magico)!;
        expect(forecast.lethal).toBe(true);
        expect(forecast.canKill).toBe(true);
    });

    it("la curación sobre un aliado no pasa de su vida máxima", () => {
        const cleric = createHero({ characterId: "c", name: "C", classId: 2, level: 20 });
        const ally = createHero({ characterId: "a", name: "A", classId: 8, level: 20 });
        ally.res.hp = ally.res.maxHp - 3;
        const forecast = forecastAbility(cleric, ally, ABILITIES.curar_leves)!;
        expect(forecast.kind).toBe("heal");
        expect(forecast.max).toBeLessThanOrEqual(3);
    });
});
