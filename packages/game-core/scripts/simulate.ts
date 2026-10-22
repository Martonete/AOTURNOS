/**
 * Simulación de balance: IA contra IA en cada encuentro, para cada clase.
 * Uso: pnpm simulate [batallas por combinación] [nivel]
 */
import {
    aiTakeTurn,
    BattleEngine,
    CLASSES,
    createBattle,
    createEnemy,
    createGrid,
    createHero,
    encounterEnemies,
    ENCOUNTERS,
    PLAYABLE_CLASS_IDS,
} from "../src";

const runs = Number(process.argv[2] ?? 200);
const level = Number(process.argv[3] ?? 20);

for (const encounter of Object.values(ENCOUNTERS)) {
    for (const party of [1, 4]) {
        for (const classId of party === 1 ? PLAYABLE_CLASS_IDS : [0]) {
            let wins = 0;
            let rounds = 0;
            for (let r = 0; r < runs; r++) {
                const classes = party === 1 ? [classId] : PLAYABLE_CLASS_IDS;
                const heroes = classes.map((id, i) =>
                    createHero({ characterId: `h${i}`, name: `H${i}`, classId: id as 1, level, controller: "ai" }),
                );
                const enemies = encounterEnemies(encounter, heroes.length).map((id, i) => createEnemy(id, i));
                const state = createBattle({ id: `${encounter.id}-${classId}-${r}`, grid: createGrid(15, 11), heroes, enemies });
                const engine = new BattleEngine(state, { now: () => 0 });
                engine.begin();
                for (let i = 0; i < 1000 && state.phase.kind !== "finished"; i++) aiTakeTurn(engine);
                if (state.phase.kind === "finished" && state.phase.winner === "heroes") wins++;
                rounds += state.round;
            }
            const label = party === 1 ? CLASSES[classId as 1].name : "Grupo de 4";
            console.log(
                `${encounter.name.padEnd(20)} ${label.padEnd(12)} victorias ${((wins / runs) * 100).toFixed(0).padStart(3)} %  rondas ${(rounds / runs).toFixed(1)}`,
            );
        }
    }
}
