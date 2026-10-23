import { describe, expect, it } from "vitest";
import {
    ABILITIES,
    applyStatus,
    CLASSES,
    createBattle,
    createEnemy,
    createGrid,
    createHero,
    crowdGuard,
    dangerMap,
    forecastAbility,
    PLAYABLE_CLASS_IDS,
    resolveAction,
    Rng,
    threatAgainst,
    threatZone,
    tileKey,
    TurnManager,
    type BattleEvent,
    type Combatant,
} from "../src";

/** Arma una batalla de prueba con las posiciones dadas, sin pasar por la colocación. */
function arena(heroes: Combatant[], enemies: Combatant[], seed = 7) {
    const state = createBattle({ id: `b${seed}`, seed, grid: createGrid(15, 11), heroes, enemies });
    return state;
}

describe("economía de PA", () => {
    it("ninguna habilidad cuesta 1 o 5 PA: con 6 PA todo turno cierra justo", () => {
        for (const ability of Object.values(ABILITIES)) {
            expect([2, 3, 4, 6], ability.id).toContain(ability.apCost);
        }
    });

    it("cada clase jugable tiene una carta de 2 PA para usar el resto del turno", () => {
        for (const id of PLAYABLE_CLASS_IDS) {
            const cls = CLASSES[id];
            const cheap = cls.abilities.filter((a) => a.level === 1 && ABILITIES[a.id].apCost === 2);
            expect(cheap.length, cls.name).toBeGreaterThan(0);
        }
    });
});

describe("contra la superioridad numérica", () => {
    it("el bando chico queda repartido a lo largo de la ronda", () => {
        const heroes = [1, 2].map((i) => createHero({ characterId: `h${i}`, name: `H${i}`, classId: 8, level: 30 }));
        const enemies = [0, 1, 2, 3].map((i) => createEnemy("esqueleto", i));
        const state = arena(heroes, enemies);
        const order = TurnManager.computeOrder(state, new Rng(state));
        const teams = order.map((id) => state.combatants[id].team[0]).join("");
        expect(teams).toBe("heehee");
    });

    it("Acorralado: cada rival pegado de más quita 10 % del daño, hasta 30 %", () => {
        const hero = createHero({ characterId: "h", name: "H", classId: 8, level: 10 });
        const wolves = [0, 1, 2, 3].map((i) => createEnemy("lobo", i));
        const state = arena([hero], wolves);
        hero.pos = { x: 7, y: 5 };
        const around = [
            { x: 6, y: 5 },
            { x: 8, y: 5 },
            { x: 7, y: 4 },
            { x: 7, y: 6 },
        ];
        wolves.forEach((w, i) => (w.pos = { x: 0, y: i }));
        expect(crowdGuard(state, hero)).toBe(0);
        wolves[0].pos = around[0];
        expect(crowdGuard(state, hero)).toBe(0);
        wolves[1].pos = around[1];
        expect(crowdGuard(state, hero)).toBeCloseTo(0.1);
        wolves[2].pos = around[2];
        wolves[3].pos = around[3];
        expect(crowdGuard(state, hero)).toBeCloseTo(0.3);

        const alone = forecastAbility(wolves[0], hero, ABILITIES.mordida)!;
        const guarded = forecastAbility(wolves[0], hero, ABILITIES.mordida, state)!;
        expect(guarded.guard).toBeCloseTo(0.3);
        expect(guarded.max).toBeLessThan(alone.max);
        // Los rivales no tienen Acorralado: rodear a un jefe sigue rindiendo.
        expect(crowdGuard(state, wolves[0])).toBe(0);
    });

    it("quien defiende devuelve medio golpe a los ataques cuerpo a cuerpo", () => {
        let ripostes = 0;
        for (let seed = 1; seed <= 30; seed++) {
            const hero = createHero({ characterId: "h", name: "H", classId: 8, level: 20 });
            const wolf = createEnemy("lobo", 0);
            const state = arena([hero], [wolf], seed);
            hero.pos = { x: 7, y: 5 };
            wolf.pos = { x: 7, y: 4 };
            applyStatus(hero, "defendiendo", 1, hero.id);
            const events = resolveAction(state, { type: "ability", actorId: wolf.id, abilityId: "mordida", target: hero.pos }, new Rng(state));
            const hit = events.some((e) => e.t === "damaged" && e.targetId === hero.id);
            const riposted = events.some((e) => e.t === "riposted");
            expect(riposted).toBe(hit);
            if (riposted) ripostes++;
        }
        expect(ripostes).toBeGreaterThan(0);
    });

    it("sin defender no hay represalia", () => {
        const hero = createHero({ characterId: "h", name: "H", classId: 8, level: 20 });
        const wolf = createEnemy("lobo", 0);
        const state = arena([hero], [wolf]);
        hero.pos = { x: 7, y: 5 };
        wolf.pos = { x: 7, y: 4 };
        const events = resolveAction(state, { type: "ability", actorId: wolf.id, abilityId: "mordida", target: hero.pos }, new Rng(state));
        expect(events.some((e) => e.t === "riposted")).toBe(false);
    });

    it("Barrido pega a todos los rivales pegados y a ningún aliado", () => {
        const pala = createHero({ characterId: "p", name: "P", classId: 8, level: 10 });
        const ally = createHero({ characterId: "m", name: "M", classId: 1, level: 10 });
        const wolves = [0, 1, 2].map((i) => createEnemy("lobo", i));
        const state = arena([pala, ally], wolves);
        pala.pos = { x: 7, y: 5 };
        ally.pos = { x: 7, y: 6 };
        wolves[0].pos = { x: 6, y: 5 };
        wolves[1].pos = { x: 8, y: 5 };
        wolves[2].pos = { x: 7, y: 2 };
        const events: BattleEvent[] = resolveAction(state, { type: "ability", actorId: pala.id, abilityId: "barrido", target: pala.pos }, new Rng(state));
        const cast = events.find((e) => e.t === "abilityCast");
        expect(cast && cast.t === "abilityCast" ? cast.affected.sort() : []).toEqual([wolves[0].id, wolves[1].id].sort());
    });
});

describe("amenaza de los rivales", () => {
    it("la zona de un lobo suma sus PM y el alcance de su mejor ataque", () => {
        const hero = createHero({ characterId: "h", name: "H", classId: 1, level: 10 });
        const wolf = createEnemy("lobo", 0);
        const state = arena([hero], [wolf]);
        hero.pos = { x: 1, y: 9 };
        wolf.pos = { x: 7, y: 5 };
        const zone = threatZone(state, wolf);
        const mp = wolf.res.maxMp;
        expect(zone.mp).toBe(mp);
        expect(Math.max(...zone.move.map((t) => Math.abs(t.x - 7) + Math.abs(t.y - 5)))).toBe(mp);
        const reach = Math.max(...zone.abilities.map((a) => a.maxRange));
        expect(Math.max(...zone.attack.map((t) => Math.abs(t.x - 7) + Math.abs(t.y - 5)))).toBe(mp + reach);
    });

    it("dice si te alcanza y cuánto te saca en el turno", () => {
        const hero = createHero({ characterId: "h", name: "H", classId: 1, level: 10 });
        const wolf = createEnemy("lobo", 0);
        const state = arena([hero], [wolf]);
        wolf.pos = { x: 7, y: 5 };
        hero.pos = { x: 7 - (wolf.res.maxMp + 1), y: 5 };
        const near = threatAgainst(state, wolf, hero);
        expect(near).not.toBeNull();
        expect(near!.uses).toBe(2);
        expect(near!.expected).toBeGreaterThan(0);
        expect(near!.worst).toBeGreaterThanOrEqual(near!.expected);

        hero.pos = { x: 0, y: 10 };
        wolf.pos = { x: 14, y: 0 };
        expect(threatAgainst(state, wolf, hero)).toBeNull();
        expect(dangerMap(state, "enemies").has(tileKey(hero.pos))).toBe(false);
    });
});
