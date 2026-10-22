"use client";

import { useEffect, useRef, useState } from "react";
import { ABILITIES, STATUSES, behaviorOf, usesPerTurn, type Behavior, type Combatant, type Forecast, type ThreatAgainst, type ThreatZone } from "@aoturnos/game-core";
import { Brain, Crosshair, Crown, FlaskConical, Footprints, ScrollText, Shield, ShieldCheck, Skull, Swords } from "lucide-react";
import type { BattleStoreState } from "../battleStore";
import { UnitEmblem } from "./Emblem";

/* ------------------------------ Augurio ------------------------------ */

const FLANK_LABEL = { front: "de frente", side: "de costado", back: "por la espalda" } as const;

/** Augurio: lo que va a pasar si confirmás la habilidad sobre el objetivo bajo el cursor. */
export function Augury({ target, forecast, abilityName }: { target: Combatant; forecast: Forecast; abilityName: string }) {
    const heal = forecast.kind === "heal";
    return (
        <div className="grim-parchment grim-rise pointer-events-none flex items-center gap-3 rounded-full px-4 py-1.5">
            {forecast.lethal || forecast.canKill ? (
                <Skull size={20} className={`text-rose-400 ${forecast.lethal ? "grim-doom" : ""}`} />
            ) : null}
            <span className="font-rune text-[11px] uppercase tracking-wider text-amber-100/70">
                {abilityName} → <span className="text-amber-50">{target.name}</span>
            </span>
            <span className={`font-rune text-lg font-black tabular-nums ${heal ? "text-emerald-300" : "text-rose-300"}`}>
                {heal ? "+" : "−"}
                {forecast.min === forecast.max ? forecast.min : `${forecast.min}–${forecast.max}`}
            </span>
            {!heal && (
                <span className="text-xs text-amber-100/80">
                    <span className="font-bold text-amber-200">{forecast.hitChance}%</span> acierto
                    {forecast.critChance > 0 && <> · {forecast.critChance}% crítico</>}
                    {forecast.flank !== "front" && <> · {FLANK_LABEL[forecast.flank]}</>}
                </span>
            )}
            {forecast.lethal ? (
                <span className="font-rune text-xs font-black uppercase tracking-widest text-rose-400">Letal</span>
            ) : forecast.canKill ? (
                <span className="font-rune text-[10px] font-bold uppercase tracking-widest text-rose-300/80">Puede rematar</span>
            ) : null}
        </div>
    );
}

/* ------------------------------ Bestiario ------------------------------ */

const BEHAVIOR_LABEL: Record<Behavior, string> = {
    charger: "Embiste de frente contra el más cercano.",
    flanker: "Caza en manada: te rodea y busca tu espalda.",
    skirmisher: "Muerde y se aleja antes de que respondas.",
    kiter: "Guarda distancia y huye si lo acorralan.",
    brute: "Avanza sin detenerse, pase lo que pase.",
    guardian: "Protege a los suyos más débiles.",
    coward: "Herido de muerte: intentará escapar.",
};

/** Ficha del rival (o aliado) bajo el cursor, como una página de bestiario. */
export function Bestiary({
    unit,
    me,
    threat,
}: {
    unit: Combatant;
    me: Combatant | undefined;
    threat: { zone: ThreatZone; against: ThreatAgainst | null } | null;
}) {
    const enemy = unit.team === "enemies";
    const diff = me ? unit.stats.level - me.stats.level : 0;
    const menace = unit.tags.includes("boss") ? 4 : diff >= 3 ? 3 : diff <= -3 ? 1 : 2;
    const hp = unit.res.hp / Math.max(1, unit.res.maxHp);
    return (
        <div className="grim-parchment grim-rise pointer-events-none w-72 rounded-xl p-3 text-xs">
            <div className="flex items-center gap-2.5">
                <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2"
                    style={{
                        borderColor: enemy ? "#b3262e" : "#4f8dff",
                        background: enemy ? "radial-gradient(circle, #5a1414, #1a0505)" : "radial-gradient(circle, #1d3766, #070d1a)",
                    }}
                >
                    <UnitEmblem unit={unit} size={22} className={enemy ? "text-rose-100" : "text-sky-100"} />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="truncate font-rune text-sm font-bold uppercase tracking-wider text-amber-50">{unit.name}</div>
                    <div className="text-[10px] uppercase tracking-widest text-amber-100/50">
                        {unit.family ?? "Héroe"} · nivel {unit.stats.level}
                    </div>
                </div>
                {enemy && (
                    <div className="flex flex-col items-end gap-0.5" title="Amenaza según tu nivel">
                        <div className="flex">
                            {menace === 4 ? (
                                <Crown size={16} className="text-amber-300" />
                            ) : (
                                Array.from({ length: 3 }, (_, i) => (
                                    <Skull key={i} size={13} className={i < menace ? "text-rose-400" : "text-white/15"} />
                                ))
                            )}
                        </div>
                        <span className="text-[9px] uppercase tracking-widest text-amber-100/40">Amenaza</span>
                    </div>
                )}
            </div>
            {enemy && <div className="mt-2 font-chronicle text-[13px] italic text-amber-100/85">“{BEHAVIOR_LABEL[behaviorOf(unit)]}”</div>}
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/60">
                <div className={`h-full ${enemy ? "bg-rose-500" : "bg-emerald-400"}`} style={{ width: `${hp * 100}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-amber-100/70">
                <span className="tabular-nums">
                    {unit.res.hp}/{unit.res.maxHp} vida
                </span>
                <span>
                    {unit.res.maxAp} PA · {unit.res.maxMp} PM
                </span>
            </div>
            {enemy && threat && <Omen unit={unit} zone={threat.zone} against={threat.against} me={me} />}
            <div className="mt-1.5 flex flex-wrap gap-1">
                {unit.tags.includes("zoneOfControl") && (
                    <span className="flex items-center gap-1 rounded-full bg-white/5 px-1.5 py-px text-[10px] text-amber-100/80">
                        <Shield size={10} /> Placaje: salir de su lado cuesta 1 PM
                    </span>
                )}
                {unit.tags.includes("undead") && (
                    <span className="rounded-full bg-fuchsia-500/15 px-1.5 py-px text-[10px] text-fuchsia-200">No muerto: las curas lo queman</span>
                )}
                {unit.statuses.map((s) => (
                    <span key={s.id} className="rounded-full bg-white/5 px-1.5 py-px text-[10px] text-amber-100/80">
                        {STATUSES[s.id]?.name ?? s.id} · {s.turnsLeft}
                    </span>
                ))}
            </div>
            <div className="mt-2 space-y-1">
                {unit.abilities.map((id) => {
                    const a = ABILITIES[id];
                    if (!a) return null;
                    const range = a.target === "self" ? "propio" : a.minRange === a.maxRange ? `${a.maxRange}` : `${a.minRange}–${a.maxRange}`;
                    const uses = a.hostile ? usesPerTurn(unit, a, unit.res.maxAp) : 0;
                    return (
                        <div key={id} className="flex justify-between gap-2 border-t border-amber-500/10 pt-1">
                            <span className="font-semibold text-amber-50/90">
                                {a.name}
                                {uses > 1 && <span className="ml-1 text-rose-300/80">×{uses}</span>}
                            </span>
                            <span className="shrink-0 text-amber-100/45">
                                {a.apCost} PA · {range}
                                {a.cooldown ? ` · ${a.cooldown}t` : ""}
                            </span>
                        </div>
                    );
                })}
            </div>
            {enemy && (
                <div className="mt-2 text-[10px] leading-snug text-amber-100/40">
                    Rojo: hasta dónde camina. Naranja: hasta dónde llega a pegar. ×N: cuántas veces le entra en un turno. Q: mapa de peligro.
                </div>
            )}
        </div>
    );
}

/** Presagio: lo que este rival puede hacer en su próximo turno, y contra vos en particular. */
function Omen({ unit, zone, against, me }: { unit: Combatant; zone: ThreatZone; against: ThreatAgainst | null; me: Combatant | undefined }) {
    const reach = zone.abilities.length > 0 ? Math.max(...zone.abilities.map((a) => (a.target === "self" ? 1 : a.maxRange))) : 0;
    const hpAfter = me ? Math.max(0, me.res.hp - (against?.expected ?? 0)) : 0;
    const deadly = Boolean(me && against && against.worst >= me.res.hp);
    return (
        <div className="mt-2 rounded-lg border border-rose-500/25 bg-black/35 p-2">
            <div className="font-rune text-[10px] font-bold uppercase tracking-[0.2em] text-rose-200/80">Su próximo turno</div>
            <div className="mt-1 grid grid-cols-3 gap-1 text-center text-[10px] text-amber-100/70">
                <span className="flex flex-col items-center gap-0.5" title="Casillas que puede caminar">
                    <Footprints size={13} className="text-rose-300" />
                    {zone.mp} PM
                </span>
                <span className="flex flex-col items-center gap-0.5" title="Distancia máxima de ataque después de moverse">
                    <Crosshair size={13} className="text-orange-300" />
                    {zone.mp + reach} casillas
                </span>
                <span className="flex flex-col items-center gap-0.5" title="PA con los que arranca su turno">
                    <Swords size={13} className="text-amber-300" />
                    {zone.ap} PA
                </span>
            </div>
            {me && unit.alive && (
                <div className="mt-1.5 border-t border-amber-500/10 pt-1.5 text-[11px] leading-snug">
                    {against ? (
                        <>
                            <div className={deadly ? "text-rose-300" : "text-amber-50/85"}>
                                {deadly ? <Skull size={11} className="mr-1 inline grim-doom" /> : null}
                                Te alcanza con <b>{against.ability.name}</b>
                                {against.uses > 1 ? ` ×${against.uses}` : ""}: ~{against.expected} de daño
                                <span className="text-amber-100/45"> (peor caso {against.worst})</span>
                            </div>
                            <div className="text-amber-100/50">
                                {against.forecast.hitChance}% de acierto · te quedarías en ~{hpAfter}/{me.res.maxHp}
                                {against.forecast.guard > 0 ? ` · Acorralado −${Math.round(against.forecast.guard * 100)}%` : ""}
                            </div>
                        </>
                    ) : (
                        <div className="flex items-center gap-1 text-emerald-200/90">
                            <ShieldCheck size={12} /> No te alcanza en su próximo turno.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/* ------------------------------ Crónica ------------------------------ */

const INK: Record<BattleStoreState["log"][number]["tone"], string> = {
    info: "text-amber-50/75",
    good: "text-emerald-200",
    bad: "text-rose-300",
    warn: "text-amber-300",
};

/** Crónica de la batalla, escrita a mano en un pergamino plegable. */
export function Chronicle({ log }: { log: BattleStoreState["log"] }) {
    const [open, setOpen] = useState(true);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
    }, [log, open]);
    return (
        <div className="pointer-events-auto flex flex-col items-end">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="grim-parchment flex items-center gap-1.5 rounded-full px-3 py-1 font-rune text-[10px] font-bold uppercase tracking-[0.25em] text-amber-100/80 hover:text-amber-50"
            >
                <ScrollText size={13} /> Crónica {open ? "▾" : "▸"}
            </button>
            {open && (
                <div
                    ref={ref}
                    className="grim-parchment mt-1.5 max-h-56 w-72 overflow-y-auto rounded-xl px-3 py-2 font-chronicle text-[13px] leading-snug"
                    style={{ maskImage: "linear-gradient(180deg, transparent 0, #000 22px)" }}
                >
                    {log.map((entry, i) => (
                        <div key={entry.id} className={`${INK[entry.tone]} ${i < log.length - 6 ? "opacity-55" : ""}`}>
                            {entry.text}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ------------------------------ Talismanes ------------------------------ */

function Talisman({
    label,
    hint,
    count,
    disabled,
    tone,
    children,
    onClick,
}: {
    label: string;
    hint: string;
    count?: number;
    disabled: boolean;
    tone: string;
    children: React.ReactNode;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            title={hint}
            className="pointer-events-auto group relative flex h-14 w-14 flex-col items-center justify-center rounded-full border-2 transition hover:-translate-y-1 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0"
            style={{
                borderColor: tone,
                background: "radial-gradient(circle at 50% 35%, #3a2414, #140b05 75%)",
                boxShadow: "0 6px 16px rgba(0,0,0,0.65)",
            }}
        >
            {children}
            <span className="mt-0.5 font-rune text-[8px] font-bold uppercase tracking-wider text-amber-100/75">{label}</span>
            {count !== undefined && (
                <span className="absolute -right-1 -top-1 rounded-full border border-amber-400/60 bg-black px-1.5 text-[10px] font-bold text-amber-100">
                    {count}
                </span>
            )}
        </button>
    );
}

/** Pociones, meditar y defender: talismanes al costado del grimorio. */
export function Talismans({
    unit,
    myTurn,
    itemAp,
    meditateAp,
    onPotion,
    onAct,
}: {
    unit: Combatant;
    myTurn: boolean;
    itemAp: number;
    meditateAp: number;
    onPotion: (item: "pocionVida" | "pocionMana") => void;
    onAct: (action: "defend" | "meditate") => void;
}) {
    const red = unit.consumables.pocionVida ?? 0;
    const blue = unit.consumables.pocionMana ?? 0;
    return (
        <div className="grid grid-cols-2 gap-2">
            <Talisman
                label="Roja"
                hint={`Poción roja: recupera vida (${itemAp} PA)`}
                count={red}
                tone="#b3262e"
                disabled={!myTurn || red <= 0 || unit.res.ap < itemAp}
                onClick={() => onPotion("pocionVida")}
            >
                <FlaskConical size={18} className="text-rose-300" />
            </Talisman>
            {unit.res.maxMana > 0 ? (
                <Talisman
                    label="Azul"
                    hint={`Poción azul: recupera maná (${itemAp} PA)`}
                    count={blue}
                    tone="#2f62c9"
                    disabled={!myTurn || blue <= 0 || unit.res.ap < itemAp}
                    onClick={() => onPotion("pocionMana")}
                >
                    <FlaskConical size={18} className="text-sky-300" />
                </Talisman>
            ) : (
                <span />
            )}
            <Talisman
                label="Defensa"
                hint="Defender: −30 % de daño, +20 de evasión y devolvés medio golpe a cada ataque cuerpo a cuerpo hasta tu próximo turno. Termina el turno."
                tone="#8a8a8a"
                disabled={!myTurn}
                onClick={() => onAct("defend")}
            >
                <Shield size={18} className="text-stone-200" />
            </Talisman>
            {unit.res.maxMana > 0 && (
                <Talisman
                    label="Meditar"
                    hint={`Meditar: recuperás maná si no te moviste (${meditateAp} PA)`}
                    tone="#6d5bd0"
                    disabled={!myTurn || unit.movedThisTurn || unit.res.ap < meditateAp}
                    onClick={() => onAct("meditate")}
                >
                    <Brain size={18} className="text-indigo-200" />
                </Talisman>
            )}
        </div>
    );
}
