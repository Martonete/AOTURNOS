"use client";

import { STATUSES, type Combatant } from "@aoturnos/game-core";
import { Footprints } from "lucide-react";
import { UnitEmblem } from "./Emblem";

/** Lo que costaría la carta bajo el cursor: el sello lo muestra parpadeando antes de gastarlo. */
export type SpendPreview = { ap: number; mana: number; stamina: number };

const SIZE = 176;
const C = SIZE / 2;
/** Los anillos ocupan 3/4 de vuelta y dejan abierta la base, donde cuelga el nombre. */
const SWEEP = 0.75;

function Ring({
    r,
    width,
    value,
    max,
    color,
    track,
    cost = 0,
}: {
    r: number;
    width: number;
    value: number;
    max: number;
    color: string;
    track: string;
    cost?: number;
}) {
    if (max <= 0) return null;
    const circumference = 2 * Math.PI * r;
    const full = circumference * SWEEP;
    const frac = Math.max(0, Math.min(1, value / max));
    const spend = Math.max(0, Math.min(value, cost)) / max;
    const keep = Math.max(0, frac - spend);
    const common = { cx: C, cy: C, r, fill: "none", strokeWidth: width, strokeLinecap: "round" as const };
    return (
        <g transform={`rotate(135 ${C} ${C})`}>
            <circle {...common} stroke={track} strokeDasharray={`${full} ${circumference}`} />
            <circle
                {...common}
                stroke={color}
                strokeDasharray={`${full * keep} ${circumference}`}
                style={{ transition: "stroke-dasharray 400ms ease", filter: `drop-shadow(0 0 4px ${color})` }}
            />
            {spend > 0 && (
                <circle
                    {...common}
                    className="grim-spend"
                    stroke="#fff4d6"
                    strokeDasharray={`${full * spend} ${circumference}`}
                    strokeDashoffset={-full * keep}
                />
            )}
        </g>
    );
}

/** Sello del héroe: vida, maná y energía como anillos; PA como gemas y PM como huellas. */
export function HeroSigil({
    unit,
    preview,
    myTurn,
    guard = 0,
}: {
    unit: Combatant;
    preview: SpendPreview | null;
    myTurn: boolean;
    /** Acorralado: parte del daño que te quitás de encima por estar rodeado. */
    guard?: number;
}) {
    const { res } = unit;
    const hpPct = res.hp / Math.max(1, res.maxHp);
    const apSpend = preview ? Math.min(res.ap, preview.ap) : 0;

    return (
        <div className="pointer-events-auto relative flex items-end gap-3">
            <div className="relative" style={{ width: SIZE, height: SIZE + 18 }}>
                {/* Gemas de PA en arco sobre el sello */}
                <div className="absolute left-1/2 top-[-18px] flex -translate-x-1/2 gap-1.5" title="Puntos de acción">
                    {Array.from({ length: res.maxAp }, (_, i) => {
                        const filled = i < res.ap;
                        const spending = filled && i >= res.ap - apSpend;
                        const lift = Math.abs(i - (res.maxAp - 1) / 2);
                        return (
                            <span
                                key={i}
                                className={`block h-3.5 w-3.5 rotate-45 rounded-[3px] border ${spending ? "grim-spend" : ""} ${
                                    filled
                                        ? "border-amber-100/80 bg-gradient-to-br from-amber-200 via-amber-400 to-orange-600 shadow-[0_0_10px_rgba(251,191,36,0.8)]"
                                        : "border-amber-900/60 bg-black/60"
                                }`}
                                style={{ marginTop: lift * lift * 2.5 }}
                            />
                        );
                    })}
                </div>

                <svg width={SIZE} height={SIZE} className="absolute left-0 top-0 drop-shadow-[0_8px_18px_rgba(0,0,0,0.7)]">
                    <defs>
                        <radialGradient id="sigil-core" cx="50%" cy="40%" r="60%">
                            <stop offset="0%" stopColor="#3a2a1a" />
                            <stop offset="70%" stopColor="#140e0a" />
                            <stop offset="100%" stopColor="#070505" />
                        </radialGradient>
                        <linearGradient id="sigil-brass" x1="0" x2="1" y1="0" y2="1">
                            <stop offset="0%" stopColor="#f6d58b" />
                            <stop offset="50%" stopColor="#a8742c" />
                            <stop offset="100%" stopColor="#f0c46a" />
                        </linearGradient>
                    </defs>
                    <circle cx={C} cy={C} r={84} fill="#0b0806" stroke="url(#sigil-brass)" strokeWidth={2} />
                    <Ring r={74} width={9} value={res.hp} max={res.maxHp} color={hpPct > 0.3 ? "#e23a3a" : "#ff6a3d"} track="rgba(120,20,20,0.35)" />
                    <Ring
                        r={62}
                        width={6}
                        value={res.mana}
                        max={res.maxMana}
                        color="#4f8dff"
                        track="rgba(30,60,140,0.35)"
                        cost={preview?.mana ?? 0}
                    />
                    <Ring
                        r={53}
                        width={4}
                        value={res.stamina}
                        max={res.maxStamina}
                        color="#f5b544"
                        track="rgba(140,90,20,0.35)"
                        cost={preview?.stamina ?? 0}
                    />
                    <circle cx={C} cy={C} r={46} fill="url(#sigil-core)" stroke="url(#sigil-brass)" strokeWidth={1.5} />
                </svg>

                <div className="absolute left-1/2 top-[52px] flex -translate-x-1/2 flex-col items-center">
                    <UnitEmblem
                        unit={unit}
                        size={38}
                        strokeWidth={1.6}
                        className={`text-amber-200 drop-shadow-[0_0_10px_rgba(251,191,36,0.6)] ${myTurn ? "" : "opacity-70"}`}
                    />
                    <span className="mt-1 font-rune text-[11px] font-bold tracking-[0.2em] text-amber-100/80">NV {unit.stats.level}</span>
                </div>

                {/* Cinta con el nombre */}
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-sm border border-amber-500/50 bg-gradient-to-b from-[#3b2513] to-[#1a0f07] px-4 py-0.5 font-rune text-xs font-bold uppercase tracking-[0.18em] text-amber-100 shadow-[0_4px_12px_rgba(0,0,0,0.6)]">
                    {unit.name}
                </div>
            </div>

            <div className="mb-6 flex flex-col gap-1.5 font-rune text-[11px] tracking-wider">
                <span className="text-rose-200">
                    <span className="text-white/45">VIDA </span>
                    <span className="tabular-nums">
                        {res.hp}/{res.maxHp}
                    </span>
                </span>
                {res.maxMana > 0 && (
                    <span className="text-sky-200">
                        <span className="text-white/45">MANÁ </span>
                        <span className="tabular-nums">
                            {res.mana}/{res.maxMana}
                        </span>
                    </span>
                )}
                {res.maxStamina > 0 && (
                    <span className="text-amber-200">
                        <span className="text-white/45">ENERGÍA </span>
                        <span className="tabular-nums">
                            {res.stamina}/{res.maxStamina}
                        </span>
                    </span>
                )}
                <span className="flex items-center gap-1 text-emerald-200" title="Puntos de movimiento">
                    {Array.from({ length: res.maxMp }, (_, i) => (
                        <Footprints key={i} size={14} className={i < res.mp ? "text-emerald-300" : "text-white/15"} />
                    ))}
                </span>
                {guard > 0 && (
                    <span
                        className="w-fit rounded-full border border-amber-300/50 bg-amber-500/15 px-1.5 py-px text-[10px] normal-case tracking-normal text-amber-100"
                        title="Rodeado: cada rival pegado además del primero te quita 10 % del daño que recibís (hasta 30 %)."
                    >
                        Acorralado · −{Math.round(guard * 100)}% daño
                    </span>
                )}
                {unit.statuses.length > 0 && (
                    <div className="mt-0.5 flex max-w-52 flex-wrap gap-1">
                        {unit.statuses.map((s) => {
                            const def = STATUSES[s.id];
                            const buff = def?.kind === "buff";
                            return (
                                <span
                                    key={s.id}
                                    className={`rounded-full border px-1.5 py-px text-[10px] normal-case tracking-normal ${
                                        buff ? "border-sky-300/40 bg-sky-500/15 text-sky-100" : "border-fuchsia-300/40 bg-fuchsia-500/15 text-fuchsia-100"
                                    }`}
                                >
                                    {def?.name ?? s.id} · {s.turnsLeft}
                                </span>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
