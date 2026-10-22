import {
    aiTakeTurn,
    BattleEngine,
    createBattle,
    createEnemy,
    createGrid,
    createHero,
    encounterEnemies,
    ENCOUNTERS,
    type BattleClientMessage,
    type BattleEvent,
    type ClassId,
} from "@aoturnos/game-core";
import { battleStore } from "./battleStore";

/**
 * Combate de práctica sin servidor: corre el mismo motor de game-core en el navegador
 * y responde como lo haría el BattleManager del server, para probar la escena y el HUD.
 */
export function startLocalBattle(opts: { classId: ClassId; level: number; encounter: string; name?: string; auto?: boolean }): () => void {
    const encounter = ENCOUNTERS[opts.encounter] ?? ENCOUNTERS.lobos;
    const hero = createHero({ characterId: "local", name: opts.name ?? "Nieri", classId: opts.classId, level: opts.level, controller: opts.auto ? "ai" : "player" });
    const enemies = encounterEnemies(encounter, 1).map((id, i) => createEnemy(id, i));
    const battleId = `local-${Date.now().toString(36)}`;
    const state = createBattle({
        id: battleId,
        grid: createGrid(encounter.grid.width, encounter.grid.height, { origin: { map: 1, x: 44, y: 44 } }),
        heroes: [hero],
        enemies,
    });
    const engine = new BattleEngine(state);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const snapshot = () => structuredClone(engine.state);
    const deliver = (message: Parameters<typeof battleStore.receive>[0]) => {
        if (!stopped) battleStore.receive(message);
    };

    const publish = (events: BattleEvent[], delay = 900) => {
        if (stopped) return;
        if (events.length > 0) deliver({ kind: "events", battleId, version: engine.state.version, events, state: snapshot() });
        if (timer) clearTimeout(timer);
        timer = null;
        const phase = engine.state.phase;
        if (phase.kind === "finished") {
            const won = phase.winner === "heroes";
            deliver({ kind: "end", battleId, winner: phase.winner, rewards: { exp: won ? encounter.exp : 0, gold: won ? encounter.gold : 0 } });
            return;
        }
        if (phase.kind !== "awaitingAction") return;
        const actor = engine.state.combatants[phase.actorId];
        if (actor.controller === "ai") {
            const busy = events.filter((e) => e.t === "moved" || e.t === "abilityCast").length;
            timer = setTimeout(() => publish(aiTakeTurn(engine)), delay + busy * 350);
        } else {
            timer = setTimeout(() => publish(engine.expireTurn(Date.now())), Math.max(0, phase.deadline - Date.now()) + 50);
        }
    };

    battleStore.attachLocalTransport((message: BattleClientMessage) => {
        switch (message.kind) {
            case "snapshot":
                deliver({ kind: "snapshot", battleId, state: snapshot() });
                return;
            case "forfeit":
                publish(engine.forfeit(hero.id));
                return;
            case "action": {
                const result = engine.submit(message.action);
                if (!result.ok) {
                    deliver({ kind: "rejected", battleId, error: result.error, version: engine.state.version });
                    return;
                }
                publish(result.value);
                return;
            }
            case "start":
                return;
        }
    });

    const startEvents = engine.begin();
    deliver({ kind: "start", battleId, you: hero.id, encounter: encounter.name, state: snapshot() });
    publish(startEvents, 1200);

    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        battleStore.attachLocalTransport(null);
    };
}
