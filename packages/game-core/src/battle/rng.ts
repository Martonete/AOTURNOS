import type { BattleState } from "./types";

/**
 * PRNG mulberry32 cuyo estado vive dentro de BattleState.rng, así una batalla
 * se puede reproducir con su semilla y su lista de acciones.
 */
export class Rng {
    constructor(private readonly state: Pick<BattleState, "rng">) {}

    /** Número en [0, 1). */
    next(): number {
        let t = (this.state.rng = (this.state.rng + 0x6d2b79f5) | 0);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** Entero en [min, max], ambos incluidos. */
    int(min: number, max: number): number {
        return min + Math.floor(this.next() * (max - min + 1));
    }

    /** true con probabilidad pct / 100. */
    chance(pct: number): boolean {
        return this.next() * 100 < pct;
    }
}

export function seedFromString(text: string): number {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h | 0;
}
