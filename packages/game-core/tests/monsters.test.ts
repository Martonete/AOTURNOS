import { describe, expect, it } from "vitest";
import { BattleEngine, createBattle, createEnemyFromNpc, createGrid, createHero, monsterFamilyFor, positionalValue, type BattleEvent } from "../src";

const npc = (name: string, worldId = name) =>
    createEnemyFromNpc(
        {
            worldId,
            name,
            hp: 200,
            maxHp: 200,
            minHit: 10,
            maxHit: 12,
            def: 5,
            attackPower: 500,
            evasion: 10,
            appearance: { body: 1, head: 0, weapon: 0, shield: 0, helmet: 0 },
        },
        0,
    );

/** Pone al enemigo a jugar primero, con todo lo demás quieto. */
function setup(enemy: ReturnType<typeof npc>, enemyPos: { x: number; y: number }, heroPos: { x: number; y: number }, blocked: { x: number; y: number }[] = []) {
    const hero = createHero({ characterId: "h", name: "Nieri", classId: 3, level: 20 });
    const state = createBattle({ id: "m", seed: 11, grid: createGrid(15, 11, { blocked }), heroes: [hero], enemies: [enemy] });
    hero.pos = heroPos;
    enemy.pos = enemyPos;
    const engine = new BattleEngine(state, { now: () => 0 });
    engine.begin();
    for (let i = 0; i < 10; i++) {
        const phase = engine.state.phase;
        if (phase.kind === "awaitingAction" && phase.actorId === enemy.id) break;
        if (phase.kind === "awaitingAction") engine.submit({ type: "endTurn", actorId: phase.actorId });
    }
    return { engine, hero, enemy: engine.state.combatants[enemy.id] };
}

describe("familias de monstruos", () => {
    it("reconoce la familia por el nombre, con prioridad para los casos ambiguos", () => {
        expect(monsterFamilyFor("Lobo").id).toBe("bestia");
        expect(monsterFamilyFor("Araña Gigante").id).toBe("aracnido");
        expect(monsterFamilyFor("Esqueleto Arquero").id).toBe("arquero");
        expect(monsterFamilyFor("Orco Brujo").id).toBe("hechicero");
        expect(monsterFamilyFor("Golem de Hielo").id).toBe("gigante");
        expect(npc("Lobo").res.maxMp).toBe(5);
        expect(npc("Golem").res.maxMp).toBe(2);
        expect(npc("Esqueleto").tags).toContain("undead");
    });

    it("el coloso empuja y el choque contra un muro hace daño extra", () => {
        const { engine, hero, enemy } = setup(npc("Golem"), { x: 5, y: 5 }, { x: 6, y: 5 }, [{ x: 7, y: 5 }]);
        const hpBefore = hero.res.hp;
        const result = engine.submit({ type: "ability", actorId: enemy.id, abilityId: "aplastar", target: { x: 6, y: 5 } });
        expect(result.ok).toBe(true);
        const events = result.ok ? result.value : [];
        const pushed = events.find((e): e is Extract<BattleEvent, { t: "pushed" }> => e.t === "pushed");
        expect(pushed?.collided).toBe(true);
        expect(engine.state.combatants[hero.id].pos).toEqual({ x: 6, y: 5 });
        expect(engine.state.combatants[hero.id].res.hp).toBeLessThan(hpBefore);
    });

    it("el empuje mueve al objetivo si hay lugar", () => {
        const { engine, hero, enemy } = setup(npc("Golem"), { x: 5, y: 5 }, { x: 6, y: 5 });
        engine.submit({ type: "ability", actorId: enemy.id, abilityId: "aplastar", target: { x: 6, y: 5 } });
        expect(engine.state.combatants[hero.id].pos).toEqual({ x: 8, y: 5 });
    });

    it("el espectro se teletransporta a una casilla libre", () => {
        const { engine, enemy } = setup(npc("Fantasma"), { x: 5, y: 5 }, { x: 10, y: 9 });
        const result = engine.submit({ type: "ability", actorId: enemy.id, abilityId: "parpadeo", target: { x: 5, y: 2 } });
        expect(result.ok).toBe(true);
        expect(engine.state.combatants[enemy.id].pos).toEqual({ x: 5, y: 2 });
        const occupied = engine.submit({ type: "ability", actorId: enemy.id, abilityId: "parpadeo", target: { x: 10, y: 9 } });
        expect(occupied.ok).toBe(false);
    });

    it("el tirador prefiere quedarse a distancia y la bestia busca la espalda", () => {
        const archer = setup(npc("Esqueleto Arquero"), { x: 5, y: 5 }, { x: 5, y: 8 });
        const s = archer.engine.state;
        const a = s.combatants[archer.enemy.id];
        expect(positionalValue(s, a, { x: 5, y: 4 })).toBeGreaterThan(positionalValue(s, a, { x: 5, y: 7 }));

        const wolf = setup(npc("Lobo"), { x: 2, y: 2 }, { x: 7, y: 5 });
        const w = wolf.engine.state.combatants[wolf.enemy.id];
        const hero = wolf.engine.state.combatants[wolf.hero.id];
        hero.heading = 1; // mira hacia arriba: la espalda es la casilla de abajo
        expect(positionalValue(wolf.engine.state, w, { x: 7, y: 6 })).toBeGreaterThan(positionalValue(wolf.engine.state, w, { x: 7, y: 4 }));
    });
});
