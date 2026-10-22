import type { DamageSchool, StatusId } from "../battle/types";

export type StatusFlag = "skipTurn" | "rooted" | "hiddenAtRange" | "taunted";

export type StatusDef = {
    id: StatusId;
    name: string;
    kind: "buff" | "debuff";
    maxStacks: number;
    dispellable: boolean;
    flags?: StatusFlag[];
    /** Modificadores de atributo; se multiplican por la magnitud de la instancia si scalesWithMagnitude. */
    attrs?: Partial<Record<"fuerza" | "agilidad", number>>;
    flat?: Partial<Record<"ap" | "mp" | "initiative" | "evasion" | "damageTakenPct", number>>;
    scalesWithMagnitude?: boolean;
    /** Daño periódico al iniciar el turno del afectado. */
    dotAtTurnStart?: { pctMaxHp?: number; flat?: number; school: DamageSchool };
    /** Daño periódico al terminar el turno del afectado. */
    dotAtTurnEnd?: { pctMaxHp?: number; flat?: number; school: DamageSchool };
    /** Expira al comenzar el siguiente turno del afectado en vez de al terminar. */
    expiresAtTurnStart?: boolean;
    /** Al expirar aplica otro estado (inmunidad tras parálisis). */
    onExpireApply?: { status: StatusId; turns: number };
    /** Se rompe cuando el afectado ataca. */
    breaksOnAttack?: boolean;
};

export const STATUSES: Record<StatusId, StatusDef> = {
    paralizado: {
        id: "paralizado",
        name: "Paralizado",
        kind: "debuff",
        maxStacks: 1,
        dispellable: true,
        flags: ["skipTurn"],
        onExpireApply: { status: "inmunidadParalisis", turns: 2 },
    },
    inmunidadParalisis: { id: "inmunidadParalisis", name: "Inmune a parálisis", kind: "buff", maxStacks: 1, dispellable: false },
    inmovilizado: { id: "inmovilizado", name: "Inmovilizado", kind: "debuff", maxStacks: 1, dispellable: true, flags: ["rooted"] },
    aturdido: { id: "aturdido", name: "Aturdido", kind: "debuff", maxStacks: 1, dispellable: true, flat: { ap: -2 } },
    envenenado: {
        id: "envenenado",
        name: "Envenenado",
        kind: "debuff",
        maxStacks: 3,
        dispellable: true,
        dotAtTurnStart: { pctMaxHp: 5, school: "poison" },
    },
    quemadura: {
        id: "quemadura",
        name: "Quemadura",
        kind: "debuff",
        maxStacks: 1,
        dispellable: true,
        dotAtTurnEnd: { flat: 8, school: "fire" },
    },
    celeridad: {
        id: "celeridad",
        name: "Celeridad",
        kind: "buff",
        maxStacks: 1,
        dispellable: true,
        attrs: { agilidad: 1 },
        flat: { mp: 1 },
        scalesWithMagnitude: true,
    },
    torpeza: {
        id: "torpeza",
        name: "Torpeza",
        kind: "debuff",
        maxStacks: 1,
        dispellable: true,
        attrs: { agilidad: -1 },
        flat: { mp: -1 },
        scalesWithMagnitude: true,
    },
    fuerza: { id: "fuerza", name: "Fuerza", kind: "buff", maxStacks: 1, dispellable: true, attrs: { fuerza: 1 }, scalesWithMagnitude: true },
    debilidad: {
        id: "debilidad",
        name: "Debilidad",
        kind: "debuff",
        maxStacks: 1,
        dispellable: true,
        attrs: { fuerza: -1 },
        scalesWithMagnitude: true,
    },
    invisible: {
        id: "invisible",
        name: "Invisible",
        kind: "buff",
        maxStacks: 1,
        dispellable: true,
        flags: ["hiddenAtRange"],
        breaksOnAttack: true,
    },
    ralentizado: { id: "ralentizado", name: "Ralentizado", kind: "debuff", maxStacks: 2, dispellable: true, flat: { mp: -2 } },
    caparazon: {
        id: "caparazon",
        name: "Caparazón",
        kind: "buff",
        maxStacks: 1,
        dispellable: true,
        flat: { damageTakenPct: -25 },
    },
    provocado: { id: "provocado", name: "Provocado", kind: "debuff", maxStacks: 1, dispellable: true, flags: ["taunted"] },
    defendiendo: {
        id: "defendiendo",
        name: "Defendiendo",
        kind: "buff",
        maxStacks: 1,
        dispellable: false,
        flat: { damageTakenPct: -30, evasion: 20 },
        expiresAtTurnStart: true,
    },
};
