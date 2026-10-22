"use client";

import type { Combatant } from "@aoturnos/game-core";
import { Hourglass, Skull } from "lucide-react";
import { UnitEmblem } from "./Emblem";
import { roman } from "./flavor";
import { useNow } from "./useNow";

const TURN_MS = 45_000;

/** Anillo de arena que se consume alrededor de quien tiene el turno. */
function SandRing({ deadline, size }: { deadline: number; size: number }) {
    const now = useNow();
    const left = Math.max(0, deadline - now);
    const frac = Math.min(1, left / TURN_MS);
    const r = size / 2 - 3;
    const circumference = 2 * Math.PI * r;
    const urgent = left < 10_000;
    return (
        <svg width={size} height={size} className="pointer-events-none absolute inset-0 -rotate-90">
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth={4} />
            <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={urgent ? "#ff5a4a" : "#f5c56a"}
                strokeWidth={4}
                strokeLinecap="round"
                strokeDasharray={`${circumference * frac} ${circumference}`}
                style={{ transition: "stroke-dasharray 200ms linear", filter: `drop-shadow(0 0 5px ${urgent ? "#ff5a4a" : "#f5c56a"})` }}
            />
        </svg>
    );
}

/** Hilo del destino: la iniciativa como una cadena de medallones con la ronda en números romanos. */
export function FateThread({
    order,
    activeId,
    you,
    round,
    deadline,
}: {
    order: Combatant[];
    activeId: string | null;
    you: string | null;
    round: number;
    deadline: number | null;
}) {
    return (
        <div className="pointer-events-auto flex flex-col items-center">
            <div className="mb-1 flex items-center gap-3 font-rune text-[11px] font-bold tracking-[0.45em] text-amber-200/80">
                <span className="h-px w-16 bg-gradient-to-r from-transparent to-amber-400/70" />
                RONDA {roman(round)}
                <span className="h-px w-16 bg-gradient-to-l from-transparent to-amber-400/70" />
            </div>
            <div className="relative flex items-center gap-2 px-3">
                <span className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-amber-500/60 to-transparent" />
                {order.map((unit) => {
                    const active = unit.id === activeId;
                    const hero = unit.team === "heroes";
                    const size = active ? 60 : 42;
                    const hp = unit.res.hp / Math.max(1, unit.res.maxHp);
                    return (
                        <div key={unit.id} className="relative flex flex-col items-center" title={`${unit.name} · ${unit.res.hp}/${unit.res.maxHp}`}>
                            <div
                                className="relative flex items-center justify-center rounded-full transition-all duration-300"
                                style={{
                                    width: size,
                                    height: size,
                                    background: hero
                                        ? "radial-gradient(circle at 50% 35%, #2b4a7a, #0d1626 75%)"
                                        : "radial-gradient(circle at 50% 35%, #6b1d1d, #1f0707 75%)",
                                    border: `2px solid ${active ? "#f5c56a" : hero ? "rgba(140,180,255,0.6)" : "rgba(255,120,120,0.55)"}`,
                                    boxShadow: active ? "0 0 22px rgba(245,197,106,0.65)" : "0 4px 10px rgba(0,0,0,0.6)",
                                    filter: unit.alive ? undefined : "grayscale(1) brightness(0.45)",
                                }}
                            >
                                {unit.alive ? (
                                    <UnitEmblem unit={unit} size={active ? 26 : 18} strokeWidth={1.7} className={hero ? "text-sky-100" : "text-rose-100"} />
                                ) : (
                                    <Skull size={18} className="text-white/60" />
                                )}
                                {active && deadline && unit.alive && <SandRing deadline={deadline} size={size} />}
                                {unit.id === you && (
                                    <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 text-[10px] text-amber-200">★</span>
                                )}
                            </div>
                            {/* Hilo de vida bajo el medallón */}
                            <span className="mt-1 h-1 overflow-hidden rounded-full bg-black/60" style={{ width: size - 8 }}>
                                <span
                                    className={`block h-full ${hero ? "bg-emerald-400" : "bg-rose-500"}`}
                                    style={{ width: `${hp * 100}%`, transition: "width 400ms ease" }}
                                />
                            </span>
                            {active && (
                                <span className="mt-0.5 max-w-24 truncate font-rune text-[10px] font-bold uppercase tracking-wider text-amber-100">
                                    {unit.name}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/** Heraldo: anuncia a quién le toca con un tajo de luz cruzando la pantalla. */
export function TurnHerald({ text, mine, nonce }: { text: string; mine: boolean; nonce: number }) {
    return (
        <div key={nonce} className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
            <span
                className="grim-slash absolute left-0 right-0 top-1/2 h-[3px] -translate-y-[38px]"
                style={{ background: `linear-gradient(90deg, transparent, ${mine ? "#f5c56a" : "#ff5a4a"}, transparent)` }}
            />
            <span
                className="grim-slash absolute left-0 right-0 top-1/2 h-[3px] translate-y-[38px]"
                style={{ background: `linear-gradient(90deg, transparent, ${mine ? "#f5c56a" : "#ff5a4a"}, transparent)` }}
            />
            <div
                className={`grim-herald absolute left-1/2 top-1/2 whitespace-nowrap font-rune font-black uppercase ${
                    mine ? "text-5xl text-amber-100" : "text-3xl text-rose-200"
                }`}
                style={{ textShadow: mine ? "0 0 28px rgba(245,197,106,0.85), 0 4px 0 #3b2208" : "0 0 22px rgba(255,90,74,0.8), 0 3px 0 #2a0505" }}
            >
                {text}
            </div>
        </div>
    );
}

/** Botón para sellar el turno: un reloj de arena con el tiempo que queda. */
export function SealTurn({
    enabled,
    exhausted,
    deadline,
    onSeal,
}: {
    enabled: boolean;
    exhausted: boolean;
    deadline: number | null;
    onSeal: () => void;
}) {
    const now = useNow(250);
    const seconds = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
    return (
        <button
            type="button"
            disabled={!enabled}
            onClick={onSeal}
            title="Terminar el turno (E o barra espaciadora)"
            className={`pointer-events-auto relative flex h-[104px] w-[104px] flex-col items-center justify-center rounded-full border-2 transition disabled:cursor-not-allowed disabled:opacity-45 ${
                exhausted && enabled ? "grim-ember" : ""
            }`}
            style={{
                borderColor: "#d4a24c",
                background: "radial-gradient(circle at 50% 35%, #5a3a17, #1c1007 70%)",
                boxShadow: "0 10px 26px rgba(0,0,0,0.7), inset 0 0 0 4px rgba(0,0,0,0.45)",
            }}
        >
            {deadline && enabled && <SandRing deadline={deadline} size={104} />}
            <Hourglass size={26} strokeWidth={1.6} className="text-amber-200" />
            <span className="mt-1 font-rune text-[11px] font-black uppercase tracking-[0.18em] text-amber-100">Sellar</span>
            <span className="font-rune text-[9px] tracking-[0.25em] text-amber-200/70">TURNO · E</span>
            {seconds !== null && enabled && (
                <span className={`absolute -top-2 rounded-full bg-black/80 px-2 text-[11px] tabular-nums ${seconds <= 10 ? "text-rose-300" : "text-amber-100"}`}>
                    {seconds}s
                </span>
            )}
        </button>
    );
}
