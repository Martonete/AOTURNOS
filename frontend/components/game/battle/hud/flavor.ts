import {
    Axe,
    Bone,
    BowArrow,
    Bug,
    Cross,
    Crosshair,
    Feather,
    Flame,
    Footprints,
    Ghost,
    Hammer,
    HeartPulse,
    Moon,
    Mountain,
    PawPrint,
    Shield,
    ShieldPlus,
    Skull,
    Snowflake,
    Sparkles,
    Sword,
    Swords,
    Target,
    Tornado,
    Wand,
    WandSparkles,
    Wind,
    Zap,
    type LucideIcon,
} from "lucide-react";
import type { AbilityDef, Combatant } from "@aoturnos/game-core";

/** Color y brillo de cada escuela: tiñe cartas, anillos y números flotantes. */
export type Hue = { ink: string; glow: string; soft: string };

export const HUES = {
    physical: { ink: "#e7dcc6", glow: "rgba(231,220,198,0.55)", soft: "rgba(231,220,198,0.12)" },
    magic: { ink: "#8fb8ff", glow: "rgba(96,150,255,0.7)", soft: "rgba(96,150,255,0.14)" },
    fire: { ink: "#ffad5c", glow: "rgba(255,120,40,0.75)", soft: "rgba(255,120,40,0.15)" },
    lightning: { ink: "#d6b3ff", glow: "rgba(176,120,255,0.75)", soft: "rgba(176,120,255,0.15)" },
    holy: { ink: "#ffe08a", glow: "rgba(255,214,102,0.75)", soft: "rgba(255,214,102,0.15)" },
    poison: { ink: "#a6f08a", glow: "rgba(120,220,90,0.7)", soft: "rgba(120,220,90,0.14)" },
    heal: { ink: "#8af0c0", glow: "rgba(70,230,160,0.7)", soft: "rgba(70,230,160,0.14)" },
    hex: { ink: "#f0a3e6", glow: "rgba(220,90,200,0.7)", soft: "rgba(220,90,200,0.14)" },
} satisfies Record<string, Hue>;

const ABILITY_ICONS: Record<string, LucideIcon> = {
    golpe: Sword,
    dardo_magico: Wand,
    proyectil_magico: WandSparkles,
    inmovilizar: Snowflake,
    tormenta_fuego: Flame,
    descarga_electrica: Zap,
    paralizar: Moon,
    apocalipsis: Sparkles,
    curar_leves: HeartPulse,
    curar_graves: HeartPulse,
    remover_paralisis: Feather,
    fuerza: Axe,
    debilidad: Skull,
    celeridad: Wind,
    resucitar: Cross,
    embestida: Swords,
    provocar: Shield,
    golpe_brutal: Hammer,
    disparo: BowArrow,
    flecha_elfica: Crosshair,
    disparo_inmovilizante: Target,
    flecha_electrica: Zap,
    lluvia_flechas: Tornado,
};

/** Ícono y color de una habilidad, deducidos de sus efectos cuando no tiene uno propio. */
export function abilityFlavor(ability: AbilityDef): { Icon: LucideIcon; hue: Hue } {
    const damage = ability.effects.find((e) => e.kind === "damage");
    const heals = ability.effects.some((e) => e.kind === "heal" || e.kind === "revive");
    const weapon = ability.effects.some((e) => e.kind === "weapon");
    const status = ability.effects.find((e) => e.kind === "status");
    let hue: Hue = HUES.physical;
    if (heals) hue = HUES.heal;
    else if (damage && damage.kind === "damage") hue = HUES[damage.school];
    else if (!weapon && status) hue = ability.target === "enemy" ? HUES.hex : HUES.holy;
    const Icon = ABILITY_ICONS[ability.id] ?? (heals ? HeartPulse : weapon ? Sword : damage ? Sparkles : ShieldPlus);
    return { Icon, hue };
}

const CLASS_ICONS: Record<number, LucideIcon> = { 1: WandSparkles, 2: Cross, 8: Shield, 9: BowArrow };

const FAMILY_ICONS: Record<string, LucideIcon> = {
    Dragón: Flame,
    Tirador: BowArrow,
    Hechicero: Wand,
    Espectro: Ghost,
    "No muerto": Bone,
    Alimaña: Bug,
    Bestia: PawPrint,
    Coloso: Mountain,
    Guerrero: Swords,
};

/** Emblema de un combatiente: su clase si es héroe, su familia si es monstruo. */
export function unitEmblem(unit: Combatant): LucideIcon {
    if (unit.team === "heroes" && unit.classId) return CLASS_ICONS[unit.classId] ?? Swords;
    return (unit.family && FAMILY_ICONS[unit.family]) || Skull;
}

export { Footprints };

const ROMAN: Array<[number, string]> = [
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
];

/** Números romanos para la ronda: queda más a pergamino que "Ronda 3". */
export function roman(n: number): string {
    let rest = Math.max(1, Math.floor(n));
    let out = "";
    for (const [value, glyph] of ROMAN) {
        while (rest >= value) {
            out += glyph;
            rest -= value;
        }
    }
    return out;
}
