"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    ABILITIES,
    ENCOUNTERS,
    ITEM_AP,
    MEDITATE_AP,
    type Combatant,
    type Forecast,
} from "@aoturnos/game-core";
import { BattleScene } from "./BattleScene";
import { battleStore, useBattleStore } from "./battleStore";
import { FateThread, SealTurn, TurnHerald } from "./hud/Fate";
import { Grimoire } from "./hud/Grimoire";
import { HeroSigil, type SpendPreview } from "./hud/HeroSigil";
import { Augury, Bestiary, Chronicle, Talismans } from "./hud/Panels";

const glass =
    "rounded-2xl border border-white/15 bg-slate-950/55 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-md";

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

/** Dónde montar la batalla: dentro del elemento en pantalla completa si lo hay, así se ve encima de todo. */
function useFullscreenTarget(): { target: HTMLElement | null; fullscreen: boolean } {
    const [target, setTarget] = useState<HTMLElement | null>(null);
    const [fullscreen, setFullscreen] = useState(false);
    useEffect(() => {
        const update = () => {
            const element = document.fullscreenElement;
            setFullscreen(Boolean(element));
            // Si toda la página está en pantalla completa, el body ya está dentro.
            setTarget(element instanceof HTMLElement && element !== document.documentElement ? element : document.body);
        };
        update();
        document.addEventListener("fullscreenchange", update);
        return () => document.removeEventListener("fullscreenchange", update);
    }, []);
    return { target, fullscreen };
}

function toggleFullscreen(): void {
    if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
    } else {
        void document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
    }
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
    const [augury, setAugury] = useState<{ target: Combatant; forecast: Forecast; abilityName: string } | null>(null);
    const [inspected, setInspected] = useState<Combatant | null>(null);
    const [hoverAbility, setHoverAbility] = useState<string | null>(null);
    const [herald, setHerald] = useState<{ text: string; mine: boolean; nonce: number } | null>(null);
    const [bottomHeight, setBottomHeight] = useState(0);
    const { target: portalTarget, fullscreen } = useFullscreenTarget();
    const inBattle = stage !== "idle";

    useEffect(() => {
        if (!inBattle || !portalTarget || !hostRef.current) return;
        const scene = new BattleScene(hostRef.current);
        sceneRef.current = scene;
        scene.init().catch((error) => console.error("[battle] no se pudo iniciar la escena", error));
        const id = setInterval(() => {
            setAugury((prev) => {
                const next = scene.previewForecast();
                if (prev && next && prev.target.id === next.target.id && prev.abilityName === next.abilityName && prev.forecast.min === next.forecast.min && prev.forecast.hitChance === next.forecast.hitChance)
                    return prev;
                return next;
            });
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
        // Al entrar o salir de pantalla completa la escena se vuelve a montar en el nuevo contenedor.
    }, [inBattle, portalTarget]);

    // El tablero se centra en el espacio que dejan libre el hilo del destino arriba y el grimorio abajo.
    const observerRef = useRef<ResizeObserver | null>(null);
    const bottomRef = (panel: HTMLDivElement | null) => {
        observerRef.current?.disconnect();
        observerRef.current = null;
        if (!panel) return;
        observerRef.current = new ResizeObserver(() => setBottomHeight(panel.offsetHeight));
        observerRef.current.observe(panel);
    };

    useEffect(() => {
        sceneRef.current?.setInsets(120, bottomHeight > 0 ? bottomHeight + 12 : 24);
    });

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

    const phase = state?.phase;
    const me = state && you ? state.combatants[you] : undefined;
    const activeId = phase && "actorId" in phase ? phase.actorId : null;
    const myTurn = phase?.kind === "awaitingAction" && phase.actorId === you && !busy && !pending;
    const deadline = phase?.kind === "awaitingAction" ? phase.deadline : null;

    // El heraldo anuncia cada cambio de turno una vez que la escena terminó de animar lo anterior.
    const announcedRef = useRef<string | null>(null);
    useEffect(() => {
        if (stage !== "active" || busy || !state || !activeId || phase?.kind !== "awaitingAction") return;
        const key = `${state.round}:${activeId}`;
        if (announcedRef.current === key) return;
        announcedRef.current = key;
        const actor = state.combatants[activeId];
        if (!actor) return;
        const mine = activeId === you;
        setHerald({ text: mine ? "Tu turno" : `Turno de ${actor.name}`, mine, nonce: Date.now() });
    }, [stage, busy, state, activeId, phase?.kind, you]);

    useEffect(() => {
        if (!herald) return;
        const id = setTimeout(() => setHerald(null), 1500);
        return () => clearTimeout(id);
    }, [herald]);

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
            if (e.key === "e" || e.key === "E" || e.key === " ") {
                e.preventDefault();
                act("endTurn");
            }
            const n = Number(e.key);
            if (n >= 1 && n <= 9 && me.abilities[n - 1]) battleStore.setMode({ kind: "ability", abilityId: me.abilities[n - 1] });
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    if (!inBattle) return <BattleLauncher />;
    if (!portalTarget) return null;

    const order = state ? state.turnOrder.map((id) => state.combatants[id]).filter(Boolean) : [];
    const selectedId = mode.kind === "ability" ? mode.abilityId : null;
    const previewId = hoverAbility ?? selectedId;
    const previewAbility = previewId ? ABILITIES[previewId] : undefined;
    const spend: SpendPreview | null =
        myTurn && previewAbility ? { ap: previewAbility.apCost, mana: previewAbility.mana, stamina: previewAbility.stamina } : null;
    const exhausted = Boolean(me && myTurn && me.res.ap < 2 && me.res.mp === 0);

    const hint = !me
        ? ""
        : myTurn
          ? mode.kind === "move"
              ? "Caminá por las casillas azules o jugá una carta del grimorio."
              : `Elegí el objetivo de ${ABILITIES[mode.abilityId]?.name}. Esc o clic derecho para cancelar.`
          : !me.alive
            ? "Caíste. Un clérigo todavía puede alzarte."
            : "Los demás mueven sus piezas…";

    return createPortal(
        <div className="pointer-events-auto fixed inset-0 z-[1000] select-none overflow-hidden bg-black text-white">
            <div ref={hostRef} className="absolute inset-0" />
            {/* Viñeta: oscurece los bordes para que el HUD se lea sobre el mapa */}
            <div
                className="pointer-events-none absolute inset-0"
                style={{ background: "radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(0,0,0,0.55) 100%)" }}
            />

            {/* Hilo del destino */}
            <div className="pointer-events-none absolute left-1/2 top-3 max-w-[92%] -translate-x-1/2">
                <FateThread order={order} activeId={activeId} you={you} round={state?.round ?? 1} deadline={deadline} />
            </div>

            {/* Augurio */}
            {augury && (
                <div className="pointer-events-none absolute left-1/2 top-[124px] -translate-x-1/2">
                    <Augury target={augury.target} forecast={augury.forecast} abilityName={augury.abilityName} />
                </div>
            )}

            <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
                <button
                    type="button"
                    onClick={toggleFullscreen}
                    title={fullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
                    className="grim-parchment rounded-full px-3 py-1 font-rune text-[10px] uppercase tracking-[0.2em] text-amber-100/70 hover:text-amber-50"
                >
                    {fullscreen ? "Ventana" : "Pantalla completa"}
                </button>
                <div className="hidden md:block">
                    <Chronicle log={log} />
                </div>
            </div>

            {inspected && stage === "active" && (
                <div className="pointer-events-none absolute left-3 top-24">
                    <Bestiary unit={inspected} me={me} />
                </div>
            )}

            {notice && (
                <div className="grim-rise absolute left-1/2 top-1/3 -translate-x-1/2 rounded-lg border border-rose-500/50 bg-[#2a0707]/90 px-4 py-2 font-rune text-sm tracking-wide text-rose-100 shadow-lg">
                    {notice}
                </div>
            )}

            {herald && stage === "active" && <TurnHerald key={herald.nonce} text={herald.text} mine={herald.mine} nonce={herald.nonce} />}

            {/* Sello del héroe, grimorio y talismanes */}
            {me && stage !== "results" && (
                <div ref={bottomRef} className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 px-4 pb-3">
                    <HeroSigil unit={me} preview={spend} myTurn={myTurn} />

                    <div className="flex min-w-0 flex-1 flex-col items-center">
                        <div className="mb-1 rounded-full bg-black/55 px-3 py-0.5 font-chronicle text-sm italic text-amber-100/85">{hint}</div>
                        <Grimoire
                            unit={me}
                            myTurn={myTurn}
                            selectedId={selectedId}
                            onSelect={(id) => battleStore.setMode(selectedId === id ? { kind: "move" } : { kind: "ability", abilityId: id })}
                            onHover={setHoverAbility}
                        />
                    </div>

                    <div className="pointer-events-auto flex items-end gap-3 pb-2">
                        <Talismans unit={me} myTurn={myTurn} itemAp={ITEM_AP} meditateAp={MEDITATE_AP} onPotion={drinkPotion} onAct={act} />
                        <div className="flex flex-col items-center gap-2">
                            <SealTurn enabled={myTurn} exhausted={exhausted} deadline={myTurn ? deadline : null} onSeal={() => act("endTurn")} />
                            <button
                                type="button"
                                className="font-rune text-[10px] uppercase tracking-[0.2em] text-rose-300/60 hover:text-rose-200"
                                onClick={() => {
                                    if (window.confirm("¿Rendirte y abandonar el combate?")) battleStore.send({ kind: "forfeit" });
                                }}
                            >
                                Rendirse
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
                    <div className="font-rune text-xs uppercase tracking-[0.6em] text-amber-200/70">Se desenvainan las armas</div>
                    <div className="mt-3 font-rune text-5xl font-black uppercase tracking-[0.12em] text-amber-100 drop-shadow-[0_0_28px_rgba(252,211,77,0.55)]">
                        {encounter}
                    </div>
                    <div className="mx-auto mt-4 h-px w-64 bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
                </div>
            </div>

            {/* Resultados */}
            {stage === "results" && result && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/65">
                    <div className="grim-parchment grim-rise w-96 rounded-2xl p-7 text-center">
                        <div className="font-rune text-[11px] uppercase tracking-[0.5em] text-amber-200/60">Fin de la batalla</div>
                        <div
                            className={`mt-2 font-rune text-4xl font-black uppercase tracking-[0.1em] ${
                                result.winner === "heroes" ? "text-amber-100" : "text-rose-300"
                            }`}
                            style={{ textShadow: result.winner === "heroes" ? "0 0 24px rgba(245,197,106,0.7)" : "0 0 18px rgba(255,90,74,0.6)" }}
                        >
                            {result.winner === "heroes" ? "Victoria" : result.winner === "draw" ? "Tablas" : "Derrota"}
                        </div>
                        <div className="mx-auto mt-3 h-px w-48 bg-gradient-to-r from-transparent via-amber-400/70 to-transparent" />
                        {result.winner === "heroes" ? (
                            <div className="mt-4 flex justify-center gap-6 font-rune">
                                <div>
                                    <div className="text-2xl font-black text-emerald-200">+{result.exp}</div>
                                    <div className="text-[10px] uppercase tracking-[0.3em] text-amber-100/50">Experiencia</div>
                                </div>
                                <div>
                                    <div className="text-2xl font-black text-amber-200">+{result.gold}</div>
                                    <div className="text-[10px] uppercase tracking-[0.3em] text-amber-100/50">Oro</div>
                                </div>
                            </div>
                        ) : (
                            <div className="mt-4 font-chronicle text-base italic text-amber-50/75">
                                Volvés al mundo malherido, con lo justo para seguir.
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={() => battleStore.close()}
                            className="mt-6 rounded-full border-2 border-amber-400/70 bg-gradient-to-b from-[#5a3a17] to-[#1c1007] px-7 py-2 font-rune text-sm font-bold uppercase tracking-[0.25em] text-amber-100 hover:brightness-125"
                        >
                            Continuar
                        </button>
                    </div>
                </div>
            )}
        </div>,
        portalTarget,
    );
}
