"use client";

import { useEffect, useRef, useState } from "react";
import { CLASSES, ENCOUNTERS, PLAYABLE_CLASS_IDS, type ClassId } from "@aoturnos/game-core";
import { BattleOverlay } from "../../components/game/battle/BattleOverlay";
import { useBattleStore } from "../../components/game/battle/battleStore";
import { startLocalBattle } from "../../components/game/battle/localBattle";

/** Combate de práctica contra la IA, sin servidor ni cuenta: sirve para probar el sistema táctico. */
export default function PracticePage() {
    const stage = useBattleStore((s) => s.stage);
    const [classId, setClassId] = useState<ClassId>(1);
    const [encounter, setEncounter] = useState("lobos");
    const [level, setLevel] = useState(10);
    const stopRef = useRef<(() => void) | null>(null);

    useEffect(() => () => stopRef.current?.(), []);

    const start = () => {
        stopRef.current?.();
        // ?auto=1 deja que la IA juegue también al héroe, para ver un combate entero.
        const auto = new URLSearchParams(window.location.search).has("auto");
        stopRef.current = startLocalBattle({ classId, level, encounter, auto });
    };

    return (
        <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-white">
            <div className="relative h-[min(760px,92vh)] w-[min(1200px,96vw)] overflow-hidden rounded-3xl border border-white/10 bg-black">
                {stage === "idle" ? (
                    <div className="flex h-full flex-col items-center justify-center gap-6 bg-[radial-gradient(ellipse_at_center,rgba(120,90,200,0.25),transparent_70%)]">
                        <h1 className="font-serif text-4xl font-bold text-amber-100">Combate de práctica</h1>
                        <div className="flex flex-wrap justify-center gap-2">
                            {PLAYABLE_CLASS_IDS.map((id) => (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => setClassId(id)}
                                    className={`rounded-xl border px-4 py-2 ${classId === id ? "border-amber-300 bg-amber-300/20" : "border-white/15 bg-white/5 hover:bg-white/10"}`}
                                >
                                    {CLASSES[id].name}
                                </button>
                            ))}
                        </div>
                        <div className="flex flex-wrap justify-center gap-2">
                            {Object.values(ENCOUNTERS).map((enc) => (
                                <button
                                    key={enc.id}
                                    type="button"
                                    onClick={() => setEncounter(enc.id)}
                                    className={`rounded-xl border px-4 py-2 text-sm ${encounter === enc.id ? "border-sky-300 bg-sky-300/20" : "border-white/15 bg-white/5 hover:bg-white/10"}`}
                                >
                                    {enc.name}
                                </button>
                            ))}
                        </div>
                        <label className="flex items-center gap-3 text-sm text-white/80">
                            Nivel {level}
                            <input type="range" min={1} max={40} value={level} onChange={(e) => setLevel(Number(e.target.value))} />
                        </label>
                        <button
                            type="button"
                            onClick={start}
                            className="rounded-2xl border border-amber-300/60 bg-amber-400/20 px-8 py-3 text-lg font-semibold text-amber-100 hover:bg-amber-400/30"
                        >
                            ⚔ Empezar
                        </button>
                    </div>
                ) : (
                    <BattleOverlay />
                )}
            </div>
        </main>
    );
}
