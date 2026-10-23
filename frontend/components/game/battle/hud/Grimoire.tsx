"use client";

import { useState } from "react";
import { ABILITIES, abilityCosts, type AbilityDef, type Combatant } from "@aoturnos/game-core";
import { Droplet, Zap } from "lucide-react";
import { describeError } from "../battleStore";
import { abilityFlavor } from "./flavor";

/** Sello corto que se estampa sobre la carta cuando no se puede jugar. */
const STAMP: Record<string, string> = {
    not_enough_ap: "Sin PA",
    not_enough_mana: "Sin maná",
    not_enough_stamina: "Sin energía",
    no_uses_left: "Agotada",
    taunted: "Provocado",
};

function rangeLabel(a: AbilityDef): string {
    if (a.target === "self") return "Sobre vos";
    return a.minRange === a.maxRange ? `Alcance ${a.maxRange}` : `Alcance ${a.minRange}–${a.maxRange}`;
}

function areaLabel(a: AbilityDef): string | null {
    switch (a.area.kind) {
        case "cross":
            return `Cruz ${a.area.radius}`;
        case "circle":
            return `Círculo ${a.area.radius}`;
        case "line":
            return `Línea ${a.area.length}`;
        default:
            return null;
    }
}

function Card({
    ability,
    index,
    total,
    stamp,
    selected,
    hovered,
    disabled,
    onSelect,
    onHover,
}: {
    ability: AbilityDef;
    index: number;
    total: number;
    stamp: string | null;
    selected: boolean;
    hovered: boolean;
    disabled: boolean;
    onSelect: () => void;
    onHover: (hover: boolean) => void;
}) {
    const { Icon, hue } = abilityFlavor(ability);
    const offset = index - (total - 1) / 2;
    const raised = hovered || selected;
    const transform = raised
        ? `translateY(-30px) rotate(0deg) scale(1.1)`
        : `translateY(${offset * offset * 3}px) rotate(${offset * 5}deg)`;
    const area = areaLabel(ability);

    return (
        <button
            type="button"
            onClick={onSelect}
            onMouseEnter={() => onHover(true)}
            onMouseLeave={() => onHover(false)}
            className={`relative -mx-2 h-[148px] w-[100px] shrink-0 rounded-xl text-left transition-[transform,filter] duration-200 ease-out ${
                selected ? "grim-ember" : ""
            } ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
            style={{ transform, zIndex: raised ? 50 : 10 + index, transformOrigin: "50% 120%" }}
        >
            <div
                className="absolute inset-0 overflow-hidden rounded-xl border-2"
                style={{
                    borderColor: selected ? "#f5c56a" : "rgba(212,162,76,0.55)",
                    background: `radial-gradient(90% 60% at 50% 38%, ${hue.soft}, transparent 70%), linear-gradient(170deg, #2c2016 0%, #120c08 70%, #0a0705 100%)`,
                    boxShadow: "0 10px 24px rgba(0,0,0,0.65), inset 0 0 0 1px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,160,0.15)",
                    filter: disabled ? "grayscale(0.85) brightness(0.55)" : undefined,
                }}
            >
                {/* Costo en PA */}
                <span className="absolute left-1.5 top-1.5 flex h-6 w-6 rotate-45 items-center justify-center rounded-[4px] border border-amber-100/70 bg-gradient-to-br from-amber-300 to-orange-700 shadow-[0_0_8px_rgba(251,191,36,0.6)]">
                    <span className="-rotate-45 font-rune text-[12px] font-black text-[#2a1405]">{ability.apCost}</span>
                </span>
                {ability.mana > 0 && (
                    <span className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-sky-200">
                        <Droplet size={10} />
                        {ability.mana}
                    </span>
                )}
                {ability.stamina > 0 && (
                    <span className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                        <Zap size={10} />
                        {ability.stamina}
                    </span>
                )}

                <div className="mt-7 flex justify-center">
                    <span
                        className="flex h-11 w-11 items-center justify-center rounded-full border"
                        style={{ borderColor: hue.glow, background: "rgba(0,0,0,0.45)", boxShadow: `0 0 18px ${hue.glow}` }}
                    >
                        <Icon size={23} strokeWidth={1.7} style={{ color: hue.ink, filter: `drop-shadow(0 0 6px ${hue.glow})` }} />
                    </span>
                </div>
                <div className="mt-1.5 px-1.5 text-center font-rune text-[10px] font-bold uppercase leading-[1.15] tracking-wide text-amber-50">
                    {ability.name}
                </div>
                <div className="absolute inset-x-0 bottom-1.5 text-center text-[9.5px] leading-tight text-amber-100/55">
                    {rangeLabel(ability)}
                    {area ? ` · ${area}` : ""}
                </div>
            </div>

            {stamp && (
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-12 whitespace-nowrap rounded border-2 border-rose-500/80 bg-black/40 px-1.5 py-0.5 font-rune text-[11px] font-black uppercase tracking-widest text-rose-300">
                    {stamp}
                </span>
            )}
            <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 font-rune text-[10px] text-amber-200/60">{index + 1}</span>
        </button>
    );
}

/** El grimorio: las habilidades como cartas en abanico. Pasar el mouse muestra qué gasta. */
export function Grimoire({
    unit,
    myTurn,
    selectedId,
    onSelect,
    onHover,
}: {
    unit: Combatant;
    myTurn: boolean;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onHover: (id: string | null) => void;
}) {
    const [hovered, setHovered] = useState<string | null>(null);
    const cards = unit.abilities.map((id) => ABILITIES[id]).filter((a): a is AbilityDef => Boolean(a));
    const focus = cards.find((a) => a.id === hovered) ?? null;

    return (
        <div className="pointer-events-auto relative flex items-end justify-center pb-5 pt-12">
            {focus && (
                <div className="grim-parchment grim-rise absolute bottom-[216px] left-1/2 z-[60] w-72 -translate-x-1/2 rounded-xl p-3 text-xs">
                    <div className="font-rune text-sm font-bold uppercase tracking-wider text-amber-100">{focus.name}</div>
                    <div className="mt-1 font-chronicle text-[13px] italic leading-snug text-amber-50/85">{focus.description}</div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-amber-100/60">
                        <span>{focus.apCost} PA</span>
                        {focus.mana > 0 && <span>{focus.mana} maná</span>}
                        {focus.stamina > 0 && <span>{focus.stamina} energía</span>}
                        <span>{rangeLabel(focus)}</span>
                        {focus.los && <span>Necesita línea de visión</span>}
                        {focus.cooldown ? <span>Recarga {focus.cooldown} turnos</span> : null}
                    </div>
                    {(() => {
                        const error = abilityCosts(unit, focus);
                        const cooldown = unit.cooldowns[focus.id] ?? 0;
                        if (cooldown > 0) return <div className="mt-1.5 text-rose-300">Se recarga en {cooldown} turnos.</div>;
                        if (error) return <div className="mt-1.5 text-rose-300">{describeError(error)}</div>;
                        return null;
                    })()}
                </div>
            )}
            {cards.map((ability, index) => {
                const error = abilityCosts(unit, ability);
                const cooldown = unit.cooldowns[ability.id] ?? 0;
                const stamp = cooldown > 0 ? `Recarga ${cooldown}` : error ? (STAMP[error] ?? "Bloqueada") : null;
                return (
                    <Card
                        key={ability.id}
                        ability={ability}
                        index={index}
                        total={cards.length}
                        stamp={myTurn ? stamp : null}
                        selected={selectedId === ability.id}
                        hovered={hovered === ability.id}
                        disabled={!myTurn || Boolean(stamp)}
                        onSelect={() => {
                            if (myTurn && !stamp) onSelect(ability.id);
                        }}
                        onHover={(on) => {
                            setHovered(on ? ability.id : null);
                            onHover(on && myTurn && !stamp ? ability.id : null);
                        }}
                    />
                );
            })}
        </div>
    );
}
