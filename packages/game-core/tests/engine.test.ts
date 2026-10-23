import { describe, expect, it } from "vitest";
import {
    aiTakeTurn,
    BattleEngine,
    createBattle,
    createEnemy,
    createGrid,
    createHero,
    encounterEnemies,
    ENCOUNTERS,
    hasLineOfSight,
    reachableTiles,
    type BattleEvent,
} from "../src";
import { duel } from "./helpers";

const mago = () => createHero({ characterId: "m", name: "Nieri", classId: 1, level: 20 });
const paladin = () => createHero({ characterId: "g", name: "Brutus", classId: 8, level: 20 });

/** Hace que el héroe sea el primero en actuar, sin depender de la iniciativa. */
function startWithHero(engine: BattleEngine, heroId: string) {
    engine.begin();
    let guard = 0;
    while (guard++ < 20) {
        const phase = engine.state.phase;
        if (phase.kind === "awaitingAction" && phase.actorId === heroId) return;
        if (phase.kind !== "awaitingAction") throw new Error(`fase inesperada ${phase.kind}`);
        engine.submit({ type: "endTurn", actorId: phase.actorId });
    }
    throw new Error("el héroe nunca recibió el turno");
}

describe("BattleEngine", () => {
    it("arranca en colocación y la primera ronda alterna bandos por iniciativa", () => {
        const heroes = [mago(), paladin()];
        const enemies = [createEnemy("lobo", 0), createEnemy("goblin", 1)];
        const state = createBattle({ id: "b1", seed: 7, grid: createGrid(15, 11), heroes, enemies });
        const engine = new BattleEngine(state, { now: () => 0 });
        expect(state.phase.kind).toBe("placement");

        const events = engine.begin();
        expect(events[0].t).toBe("battleStarted");
        const order = state.turnOrder.map((id) => state.combatants[id].team);
        for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
        expect(state.phase.kind).toBe("awaitingAction");
    });

    it("rechaza acciones fuera de turno y movimientos sin PM", () => {
        const hero = paladin();
        const wolf = createEnemy("lobo", 0);
        const { engine } = duel(hero, [wolf], { x: 7, y: 9 }, { x: 7, y: 1 });
        startWithHero(engine, hero.id);

        expect(engine.submit({ type: "endTurn", actorId: wolf.id })).toEqual({ ok: false, error: "not_your_turn" });
        const tooFar = [8, 7, 6, 5, 4].map((y) => ({ x: 7, y }));
        expect(engine.submit({ type: "move", actorId: hero.id, path: tooFar })).toEqual({ ok: false, error: "not_enough_mp" });
        const ok = engine.submit({ type: "move", actorId: hero.id, path: [{ x: 7, y: 8 }, { x: 7, y: 7 }] });
        expect(ok.ok).toBe(true);
        expect(hero.res.mp).toBe(2);
        expect(hero.heading).toBe(1);
    });

    it("el hechizo descuenta PA y mana, hace daño y respeta el alcance", () => {
        const hero = mago();
        const wolf = createEnemy("lobo", 0);
        const { engine } = duel(hero, [wolf], { x: 7, y: 9 }, { x: 7, y: 4 });
        startWithHero(engine, hero.id);

        const manaBefore = hero.res.mana;
        const res = engine.submit({ type: "ability", actorId: hero.id, abilityId: "proyectil_magico", target: { x: 7, y: 4 } });
        expect(res.ok).toBe(true);
        expect(hero.res.ap).toBe(3);
        expect(hero.res.mana).toBe(manaBefore - 45);
        expect(wolf.res.hp).toBeLessThan(75);

        const far = engine.submit({ type: "ability", actorId: hero.id, abilityId: "golpe", target: { x: 7, y: 4 } });
        expect(far).toEqual({ ok: false, error: "out_of_range" });
    });

    it("Inmovilizar deja al objetivo sin PM en su turno y expira a los 2 turnos", () => {
        const hero = mago();
        const wolf = createEnemy("lobo", 0);
        const { engine, state } = duel(hero, [wolf], { x: 7, y: 9 }, { x: 7, y: 4 });
        startWithHero(engine, hero.id);

        engine.submit({ type: "ability", actorId: hero.id, abilityId: "inmovilizar", target: { x: 7, y: 4 } });
        engine.submit({ type: "endTurn", actorId: hero.id });
        expect(state.phase).toMatchObject({ kind: "awaitingAction", actorId: wolf.id });
        expect(wolf.res.mp).toBe(0);
        expect(engine.submit({ type: "move", actorId: wolf.id, path: [{ x: 7, y: 5 }] })).toEqual({ ok: false, error: "rooted" });
        engine.submit({ type: "endTurn", actorId: wolf.id });
        engine.submit({ type: "endTurn", actorId: hero.id });
        expect(wolf.res.mp).toBe(0);
        const events = engine.submit({ type: "endTurn", actorId: wolf.id });
        expect(events.ok && events.value.some((e) => e.t === "statusExpired" && e.status === "inmovilizado")).toBe(true);
    });

    it("Paralizar salta el turno del objetivo y luego da inmunidad", () => {
        const hero = mago();
        hero.abilities.push("paralizar");
        const wolf = createEnemy("lobo", 0);
        const { engine, state } = duel(hero, [wolf], { x: 7, y: 9 }, { x: 7, y: 6 });
        startWithHero(engine, hero.id);

        engine.submit({ type: "ability", actorId: hero.id, abilityId: "paralizar", target: { x: 7, y: 6 } });
        const res = engine.submit({ type: "endTurn", actorId: hero.id });
        expect(res.ok).toBe(true);
        // El lobo no recibe turno: vuelve a ser el turno del héroe en la ronda siguiente.
        expect(state.phase).toMatchObject({ kind: "awaitingAction", actorId: hero.id });
        expect(wolf.statuses.some((s) => s.id === "inmunidadParalisis")).toBe(true);
    });

    it("la victoria termina la batalla", () => {
        const hero = paladin();
        const wolf = createEnemy("lobo", 0);
        wolf.res.hp = 1;
        wolf.stats.evasion = -500;
        const { engine, state } = duel(hero, [wolf], { x: 7, y: 6 }, { x: 7, y: 5 });
        startWithHero(engine, hero.id);
        const res = engine.submit({ type: "ability", actorId: hero.id, abilityId: "golpe", target: { x: 7, y: 5 } });
        expect(res.ok && res.value.at(-1)).toEqual({ t: "battleEnded", winner: "heroes" });
        expect(state.phase).toEqual({ kind: "finished", winner: "heroes" });
    });

    it("vencer el reloj deja al personaje defendiendo", () => {
        const hero = paladin();
        const { engine, tick } = duel(hero, [createEnemy("lobo", 0)], { x: 7, y: 9 }, { x: 7, y: 1 });
        startWithHero(engine, hero.id);
        expect(engine.expireTurn(1_000)).toEqual([]);
        tick(46_000);
        const events = engine.expireTurn(100_000);
        expect(events.some((e) => e.t === "defended")).toBe(true);
    });

    it("la línea de visión la cortan los obstáculos", () => {
        const grid = createGrid(10, 10, { sightBlockers: [{ x: 5, y: 5 }] });
        expect(hasLineOfSight(grid, { x: 5, y: 2 }, { x: 5, y: 8 })).toBe(false);
        expect(hasLineOfSight(grid, { x: 2, y: 2 }, { x: 8, y: 2 })).toBe(true);
    });

    it("la zona de control del paladín encarece salir de su lado", () => {
        const hero = paladin();
        const wolf = createEnemy("lobo", 0);
        const { state } = duel(hero, [wolf], { x: 7, y: 6 }, { x: 7, y: 5 });
        const reach = reachableTiles(state, wolf, 2);
        // Sin zona de control llegaría a (7,3); con ella salir cuesta 2.
        expect(reach.has("7,3")).toBe(false);
        expect(reach.has("7,4")).toBe(true);
    });

    it("misma semilla y mismas acciones dan el mismo resultado", () => {
        const run = () => {
            const heroes = [createHero({ characterId: "a", name: "A", classId: 9, level: 15, controller: "ai" })];
            const enemies = encounterEnemies(ENCOUNTERS.goblins, 1).map((id, i) => createEnemy(id, i));
            const state = createBattle({ id: "rep", seed: 99, grid: createGrid(15, 11), heroes, enemies });
            const engine = new BattleEngine(state, { now: () => 0 });
            const events: BattleEvent[] = [...engine.begin()];
            for (let i = 0; i < 400 && state.phase.kind !== "finished"; i++) events.push(...aiTakeTurn(engine));
            return JSON.stringify(events);
        };
        expect(run()).toBe(run());
    });

    it("IA contra IA termina las batallas de la rebanada vertical", () => {
        for (const encounter of Object.values(ENCOUNTERS)) {
            for (const classId of [1, 2, 8, 9] as const) {
                const heroes = [createHero({ characterId: "h", name: "H", classId, level: 20, controller: "ai" })];
                const enemies = encounterEnemies(encounter, 1).map((id, i) => createEnemy(id, i));
                const state = createBattle({ id: `${encounter.id}-${classId}`, grid: createGrid(15, 11), heroes, enemies });
                const engine = new BattleEngine(state, { now: () => 0 });
                engine.begin();
                for (let i = 0; i < 500 && state.phase.kind !== "finished"; i++) aiTakeTurn(engine);
                expect(state.phase.kind, `${encounter.id} clase ${classId}`).toBe("finished");
            }
        }
    });
});
