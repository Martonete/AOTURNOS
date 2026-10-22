"use client";

import { useEffect, useRef, useState } from "react";
import {
    ABILITIES,
    abilityCosts,
    ENCOUNTERS,
    ITEM_AP,
    MEDITATE_AP,
    STATUSES,
    behaviorOf,
    type Behavior,
    type Combatant,
} from "@aoturnos/game-core";
import { BattleScene } from "./BattleScene";
import { battleStore, describeError, useBattleStore } from "./battleStore";

const glass =
    "rounded-2xl border border-white/15 bg-slate-950/55 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-md";

function Bar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
    if (max <= 0) return null;
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    return (
        <div className="w-full">
            <div className="mb-0.5 flex justify-between text-[10px] uppercase tracking-wider text-white/70">
                <span>{label}</span>
                <span className="tabular-nums">
                    {value}/{max}
                </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-black/50">
                <div className={`h-full rounded-full transition-[width] duration-300 ${color}`} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

function Pips({ value, max, color }: { value: number; max: number; color: string }) {
    return (
        <div className="flex gap-1">
            {Array.from({ length: max }, (_, i) => (
                <span key={i} className={`h-2.5 w-2.5 rotate-45 rounded-[2px] ${i < value ? color : "bg-white/10"}`} />
            ))}
        </div>
    );
}

function StatusChips({ unit }: { unit: Combatant }) {
    if (unit.statuses.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1">
            {unit.statuses.map((s) => {
                const def = STATUSES[s.id];
                const buff = def?.kind === "buff";
                return (
                    <span
                        key={s.id}
                        className={`rounded-md px-1.5 py-0.5 text-[10px] ${buff ? "bg-sky-500/25 text-sky-100" : "bg-fuchsia-500/25 text-fuchsia-100"}`}
                    >
                        {def?.name ?? s.id} {s.turnsLeft}t{s.stacks > 1 ? ` ×${s.stacks}` : ""}
                    </span>
                );
            })}
        </div>
    );
}

const BEHAVIOR_LABEL: Record<Behavior, string> = {
    charger: "Agresivo: va directo al más cercano",
    flanker: "Manada: te rodea y busca tu espalda",
    skirmisher: "Hostigador: pega y se aleja",
    kiter: "A distancia: mantiene la distancia y huye si lo encierran",
    brute: "Bruto: avanza sin detenerse",
    guardian: "Protector: cuida a sus aliados",
    coward: "Malherido: intenta escapar",
};

/** Ficha del combatiente bajo el cursor: cómo se mueve, qué alcance tiene y qué hechizos usa. */
function UnitInspector({ unit }: { unit: Combatant }) {
    const enemy = unit.team === "enemies";
    const behavior = behaviorOf(unit);
    return (
        <div className={`${glass} pointer-events-none absolute left-3 top-20 w-72 p-3 text-xs`}>
            <div className="flex items-baseline justify-between">
                <span className={`text-sm font-semibold ${enemy ? "text-rose-200" : "text-sky-200"}`}>{unit.name}</span>
                <span className="text-[10px] uppercase tracking-wider text-white/50">{unit.family ?? `Nv ${unit.stats.level}`}</span>
            </div>
            {enemy && <div className="mt-0.5 text-[11px] text-amber-100/80">{BEHAVIOR_LABEL[behavior]}</div>}
            <div className="mt-2">
                <Bar value={unit.res.hp} max={unit.res.maxHp} color={enemy ? "bg-rose-400" : "bg-emerald-400"} label="Vida" />
            </div>
            <div className="mt-1.5 flex gap-3 text-[11px] text-white/70">
                <span>
                    <span className="text-amber-200">{unit.res.maxAp}</span> PA
                </span>
                <span>
                    <span className="text-sky-200">{unit.res.maxMp}</span> PM
                </span>
                {unit.tags.includes("zoneOfControl") && <span title="Salir de su lado cuesta 1 PM más">Placaje</span>}
                {unit.tags.includes("undead") && <span className="text-fuchsia-200">No muerto</span>}
            </div>
            <div className="mt-2 space-y-1">
                {unit.abilities.map((id) => {
                    const a = ABILITIES[id];
                    if (!a) return null;
                    const range = a.target === "self" ? "propio" : a.minRange === a.maxRange ? `${a.maxRange}c` : `${a.minRange}-${a.maxRange}c`;
                    return (
                        <div key={id} className="rounded-md bg-white/5 px-2 py-1">
                            <div className="flex justify-between">
                                <span className="font-semibold text-white/90">{a.name}</span>
                                <span className="text-white/50">
                                    {a.apCost} PA · {range}
                                    {a.cooldown ? ` · ${a.cooldown}t` : ""}
                                </span>
                            </div>
                            <div className="text-[10px] text-white/55">{a.description}</div>
                        </div>
                    );
                })}
            </div>
            {enemy && <div className="mt-2 text-[10px] text-white/45">Rojo: hasta dónde camina. Naranja: hasta dónde llega a pegar.</div>}
        </div>
    );
}

/** Botón para iniciar un combate de prueba fuera de la batalla. */
function BattleLauncher() {
    const [open, setOpen] = useState(false);
    return (
        <div className="pointer-events-auto absolute bottom-3 left-3 z-30">
            {open && (
                <div className={`${glass} mb-2 flex flex-col gap-1 p-2`}>
                    {Object.values(ENCOUNTERS).map((enc) => (
                        <button
                            key={enc.id}
                            type="button"
                            className="rounded-lg px-3 py-1.5 text-left text-sm text-white/90 hover:bg-white/10"
                            onClick={() => {
                                setOpen(false);
                                if (!battleStore.send({ kind: "start", encounter: enc.id })) {
                                    battleStore.receive({ kind: "notice", message: "No hay conexión con el servidor." });
                                }
                            }}
                        >
                            {enc.name}
                        </button>
                    ))}
                </div>
            )}
            <button
                type="button"
                className={`${glass} px-3 py-1.5 text-sm font-semibold text-amber-200 hover:text-amber-100`}
                onClick={() => setOpen((v) => !v)}
            >
                ⚔ Combate
            </button>
        </div>
    );
}

function Countdown({ deadline }: { deadline: number }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(id);
    }, []);
    const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
    return <span className={`tabular-nums ${seconds <= 10 ? "text-rose-300" : "text-white/80"}`}>{seconds}s</span>;
}

export function BattleOverlay() {
    const stage = useBattleStore((s) => s.stage);
    const state = useBattleStore((s) => s.state);
    const you = useBattleStore((s) => s.you);
    const mode = useBattleStore((s) => s.mode);
    const log = useBattleStore((s) => s.log);
    const result = useBattleStore((s) => s.result);
    const notice = useBattleStore((s) => s.notice);
    const pending = useBattleStore((s) => s.pending);
    const busy = useBattleStore((s) => s.animating || s.queue.length > 0);
    const encounter = useBattleStore((s) => s.encounter);

    const hostRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<BattleScene | null>(null);
    const logRef = useRef<HTMLDivElement>(null);
    const [hitPreview, setHitPreview] = useState<{ name: string; chance: number } | null>(null);
    const [inspected, setInspected] = useState<Combatant | null>(null);
    const inBattle = stage !== "idle";

    useEffect(() => {
        if (!inBattle || !hostRef.current) return;
        const scene = new BattleScene(hostRef.current);
        sceneRef.current = scene;
        scene.init().catch((error) => console.error("[battle] no se pudo iniciar la escena", error));
        const id = setInterval(() => {
            setHitPreview(scene.previewHitChance());
            setInspected((prev) => {
                const next = scene.hoverInfo();
                // Mantiene la misma referencia mientras no cambie, para no re-renderizar de más.
                return prev && next && prev.id === next.id && prev.res.hp === next.res.hp && prev.statuses.length === next.statuses.length ? prev : next;
            });
        }, 120);
        return () => {
            clearInterval(id);
            scene.destroy();
            sceneRef.current = null;
        };
    }, [inBattle]);

    useEffect(() => {
        if (stage !== "intro") return;
        const id = setTimeout(() => battleStore.setStage("active"), 1600);
        return () => clearTimeout(id);
    }, [stage]);

    useEffect(() => {
        if (result && !busy && stage === "active") battleStore.setStage("results");
    }, [result, busy, stage]);

    // Red de seguridad: si alguna animación se traba, la pantalla de resultados aparece igual.
    useEffect(() => {
        if (!result || stage !== "active") return;
        const id = setTimeout(() => battleStore.setStage("results"), 8000);
        return () => clearTimeout(id);
    }, [result, stage]);

    useEffect(() => {
        if (!notice) return;
        const id = setTimeout(() => battleStore.clearNotice(), 2600);
        return () => clearTimeout(id);
    }, [notice]);

    useEffect(() => {
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    }, [log]);

    const phase = state?.phase;
    const me = state && you ? state.combatants[you] : undefined;
    const myTurn = phase?.kind === "awaitingAction" && phase.actorId === you && !busy && !pending;

    const act = (action: "endTurn" | "defend" | "meditate") => {
        if (!me) return;
        battleStore.send({ kind: "action", action: { type: action, actorId: me.id } });
    };
    const drinkPotion = (item: "pocionVida" | "pocionMana") => {
        if (!me) return;
        battleStore.send({ kind: "action", action: { type: "item", actorId: me.id, item, target: me.pos } });
    };

    useEffect(() => {
        if (!inBattle) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (e.key === "Escape") battleStore.setMode({ kind: "move" });
            if (!myTurn || !me) return;
            if (e.key === "e" || e.key === "E") act("endTurn");
            const n = Number(e.key);
            if (n >= 1 && n <= 9 && me.abilities[n - 1]) battleStore.setMode({ kind: "ability", abilityId: me.abilities[n - 1] });
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    if (!inBattle) return <BattleLauncher />;

    const order = state ? state.turnOrder.map((id) => state.combatants[id]).filter(Boolean) : [];
    const activeId = phase && "actorId" in phase ? phase.actorId : null;

    return (
        <div className="pointer-events-auto absolute inset-0 z-40 select-none overflow-hidden bg-black text-white">
            <div ref={hostRef} className="absolute inset-0" />

            {/* Línea de iniciativa */}
            <div className="absolute left-1/2 top-3 flex max-w-[92%] -translate-x-1/2 items-center gap-2">
                <div className={`${glass} flex items-center gap-1.5 overflow-x-auto px-2 py-1.5`}>
                    <span className="px-1 text-[10px] uppercase tracking-widest text-white/50">Ronda {state?.round ?? 0}</span>
                    {order.map((c) => {
                        const active = c.id === activeId;
                        const hpPct = (c.res.hp / Math.max(1, c.res.maxHp)) * 100;
                        return (
                            <div
                                key={c.id}
                                className={`min-w-[74px] rounded-lg border px-2 py-1 text-[11px] transition-all ${
                                    active ? "scale-105 border-amber-300/80 bg-amber-300/15" : "border-white/10 bg-white/5"
                                } ${c.alive ? "" : "opacity-35 grayscale"}`}
                            >
                                <div className={`truncate font-semibold ${c.team === "heroes" ? "text-sky-200" : "text-rose-200"}`}>
                                    {c.id === you ? "★ " : ""}
                                    {c.name}
                                </div>
                                <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-black/50">
                                    <div
                                        className={`h-full ${c.team === "heroes" ? "bg-emerald-400" : "bg-rose-400"}`}
                                        style={{ width: `${hpPct}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
                {phase?.kind === "awaitingAction" && (
                    <div className={`${glass} px-3 py-2 text-sm`}>
                        <Countdown deadline={phase.deadline} />
                    </div>
                )}
            </div>

            {/* Registro */}
            <div ref={logRef} className={`${glass} absolute right-3 top-20 hidden max-h-[45%] w-64 overflow-y-auto p-2 text-xs md:block`}>
                {log.map((entry) => (
                    <div
                        key={entry.id}
                        className={
                            entry.tone === "good"
                                ? "text-emerald-200"
                                : entry.tone === "bad"
                                  ? "text-rose-200"
                                  : entry.tone === "warn"
                                    ? "text-amber-200"
                                    : "text-white/75"
                        }
                    >
                        {entry.text}
                    </div>
                ))}
            </div>

            {inspected && stage === "active" && <UnitInspector unit={inspected} />}

            {hitPreview && (
                <div className={`${glass} absolute left-1/2 top-20 -translate-x-1/2 px-3 py-1 text-sm`}>
                    {hitPreview.name}: <span className="font-bold text-amber-200">{hitPreview.chance}%</span> de impacto
                </div>
            )}

            {notice && (
                <div className="absolute left-1/2 top-1/3 -translate-x-1/2 rounded-xl bg-rose-950/80 px-4 py-2 text-sm text-rose-100 shadow-lg">
                    {notice}
                </div>
            )}

            {/* Ficha y acciones */}
            {me && stage !== "results" && (
                <div className="absolute bottom-3 left-1/2 flex w-[min(960px,96%)] -translate-x-1/2 gap-3">
                    <div className={`${glass} flex w-56 shrink-0 flex-col gap-1.5 p-3`}>
                        <div className="flex items-baseline justify-between">
                            <span className="font-semibold text-sky-100">{me.name}</span>
                            <span className="text-[10px] text-white/50">Nv {me.stats.level}</span>
                        </div>
                        <Bar value={me.res.hp} max={me.res.maxHp} color="bg-gradient-to-r from-emerald-500 to-lime-300" label="Vida" />
                        <Bar value={me.res.mana} max={me.res.maxMana} color="bg-gradient-to-r from-blue-600 to-sky-300" label="Maná" />
                        <Bar value={me.res.stamina} max={me.res.maxStamina} color="bg-gradient-to-r from-amber-600 to-yellow-300" label="Energía" />
                        <div className="mt-1 flex items-center justify-between text-[10px] uppercase text-white/60">
                            <span>PA</span>
                            <Pips value={me.res.ap} max={me.res.maxAp} color="bg-amber-300" />
                        </div>
                        <div className="flex items-center justify-between text-[10px] uppercase text-white/60">
                            <span>PM</span>
                            <Pips value={me.res.mp} max={me.res.maxMp} color="bg-sky-300" />
                        </div>
                        <StatusChips unit={me} />
                    </div>

                    <div className={`${glass} flex min-w-0 flex-1 flex-col gap-2 p-3`}>
                        <div className="flex items-center justify-between text-xs text-white/60">
                            <span>
                                {myTurn
                                    ? mode.kind === "move"
                                        ? "Tu turno: tocá una casilla azul para moverte o elegí una habilidad."
                                        : `Elegí el objetivo de ${ABILITIES[mode.abilityId]?.name}. Esc o clic derecho cancela.`
                                    : !me.alive
                                      ? "Caíste. Un clérigo puede resucitarte."
                                      : "Esperando turno…"}
                            </span>
                            <button
                                type="button"
                                className="rounded-md px-2 py-0.5 text-rose-300/80 hover:bg-rose-500/15"
                                onClick={() => {
                                    if (window.confirm("¿Rendirte y abandonar el combate?")) battleStore.send({ kind: "forfeit" });
                                }}
                            >
                                Rendirse
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {me.abilities.map((id, index) => {
                                const ability = ABILITIES[id];
                                if (!ability) return null;
                                const error = abilityCosts(me, ability);
                                const cooldown = me.cooldowns[id] ?? 0;
                                const selected = mode.kind === "ability" && mode.abilityId === id;
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        disabled={!myTurn || Boolean(error)}
                                        title={`${ability.description}${error ? `\n${describeError(error)}` : ""}`}
                                        onClick={() => battleStore.setMode(selected ? { kind: "move" } : { kind: "ability", abilityId: id })}
                                        className={`relative rounded-xl border px-2.5 py-1.5 text-left text-xs transition ${
                                            selected
                                                ? "border-amber-300 bg-amber-300/20 shadow-[0_0_16px_rgba(252,211,77,0.35)]"
                                                : "border-white/10 bg-white/5 hover:bg-white/10"
                                        } disabled:cursor-not-allowed disabled:opacity-40`}
                                    >
                                        <div className="font-semibold">
                                            <span className="mr-1 text-white/40">{index + 1}</span>
                                            {ability.name}
                                        </div>
                                        <div className="text-[10px] text-white/55">
                                            {ability.apCost} PA
                                            {ability.mana > 0 ? ` · ${ability.mana} maná` : ""}
                                            {ability.stamina > 0 ? ` · ${ability.stamina} en.` : ""}
                                            {` · ${ability.minRange === ability.maxRange ? ability.maxRange : `${ability.minRange}-${ability.maxRange}`}c`}
                                        </div>
                                        {cooldown > 0 && (
                                            <span className="absolute -right-1 -top-1 rounded-full bg-slate-900 px-1.5 text-[10px] text-amber-200">
                                                {cooldown}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex flex-wrap gap-1.5 text-xs">
                            <button
                                type="button"
                                disabled={!myTurn || (me.consumables.pocionVida ?? 0) <= 0 || me.res.ap < ITEM_AP}
                                onClick={() => drinkPotion("pocionVida")}
                                className="rounded-lg border border-rose-300/30 bg-rose-500/10 px-2.5 py-1 hover:bg-rose-500/20 disabled:opacity-40"
                            >
                                Poción roja ×{me.consumables.pocionVida ?? 0}
                            </button>
                            {me.res.maxMana > 0 && (
                                <>
                                    <button
                                        type="button"
                                        disabled={!myTurn || (me.consumables.pocionMana ?? 0) <= 0 || me.res.ap < ITEM_AP}
                                        onClick={() => drinkPotion("pocionMana")}
                                        className="rounded-lg border border-sky-300/30 bg-sky-500/10 px-2.5 py-1 hover:bg-sky-500/20 disabled:opacity-40"
                                    >
                                        Poción azul ×{me.consumables.pocionMana ?? 0}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!myTurn || me.movedThisTurn || me.res.ap < MEDITATE_AP}
                                        onClick={() => act("meditate")}
                                        className="rounded-lg border border-indigo-300/30 bg-indigo-500/10 px-2.5 py-1 hover:bg-indigo-500/20 disabled:opacity-40"
                                    >
                                        Meditar
                                    </button>
                                </>
                            )}
                            <button
                                type="button"
                                disabled={!myTurn}
                                onClick={() => act("defend")}
                                className="rounded-lg border border-slate-300/30 bg-slate-500/10 px-2.5 py-1 hover:bg-slate-500/20 disabled:opacity-40"
                            >
                                Defender
                            </button>
                            <button
                                type="button"
                                disabled={!myTurn}
                                onClick={() => act("endTurn")}
                                className="ml-auto rounded-lg border border-amber-300/50 bg-amber-400/20 px-3 py-1 font-semibold text-amber-100 hover:bg-amber-400/30 disabled:opacity-40"
                            >
                                Fin de turno (E)
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Transición de entrada */}
            <div
                className={`pointer-events-none absolute inset-0 flex items-center justify-center bg-black transition-opacity duration-700 ${
                    stage === "intro" ? "opacity-100" : "opacity-0"
                }`}
            >
                <div className="text-center">
                    <div className="text-xs uppercase tracking-[0.5em] text-amber-200/70">Encuentro</div>
                    <div className="mt-2 font-serif text-4xl font-bold text-amber-100 drop-shadow-[0_0_24px_rgba(252,211,77,0.5)]">
                        {encounter}
                    </div>
                </div>
            </div>

            {/* Resultados */}
            {stage === "results" && result && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                    <div className={`${glass} w-80 p-6 text-center`}>
                        <div
                            className={`font-serif text-3xl font-bold ${
                                result.winner === "heroes" ? "text-amber-200" : "text-rose-300"
                            }`}
                        >
                            {result.winner === "heroes" ? "¡Victoria!" : result.winner === "draw" ? "Empate" : "Derrota"}
                        </div>
                        {result.winner === "heroes" ? (
                            <div className="mt-4 space-y-1 text-sm text-white/85">
                                <div>+{result.exp} de experiencia</div>
                                <div>+{result.gold} de oro</div>
                            </div>
                        ) : (
                            <div className="mt-4 text-sm text-white/70">Volvés al mundo con lo justo para seguir.</div>
                        )}
                        <button
                            type="button"
                            onClick={() => battleStore.close()}
                            className="mt-6 rounded-xl border border-amber-300/50 bg-amber-400/20 px-5 py-2 font-semibold text-amber-100 hover:bg-amber-400/30"
                        >
                            Continuar
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
