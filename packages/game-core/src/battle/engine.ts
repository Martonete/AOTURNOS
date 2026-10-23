import { onTurnEnd, onTurnStart } from "./effects";
import { combatantAt, sameTile } from "./grid";
import { resolveAction } from "./resolution";
import { Rng } from "./rng";
import { initiativeOf } from "./rules";
import { flatModifier, hasFlag } from "./statuses";
import { validateAction } from "./targeting";
import type { BattleAction, BattleEvent, BattleState, Combatant, Result, Team, Tile } from "./types";

export type EngineOptions = {
    now: () => number;
    turnTimeMs: number;
};

export const DEFAULT_TURN_TIME_MS = 45_000;
const MANA_REGEN_PCT = 0.05;
const STAMINA_REGEN = 25;
/** Corte de seguridad: una batalla que no se resuelve en 40 rondas termina en empate. */
export const MAX_ROUNDS = 40;

export const TurnManager = {
    /** Orden de la ronda: iniciativa descendente, desempate con el RNG y bandos intercalados de forma pareja. */
    computeOrder(state: BattleState, rng: Rng): string[] {
        const rolled = Object.values(state.combatants)
            .filter((c) => c.alive)
            .map((c) => ({ c, score: initiativeOf(c), tie: rng.next() }))
            .sort((a, b) => b.score - a.score || b.tie - a.tie);

        const heroes = rolled.filter((r) => r.c.team === "heroes").map((r) => r.c.id);
        const enemies = rolled.filter((r) => r.c.team === "enemies").map((r) => r.c.id);
        const first = rolled[0]?.c.team === "enemies" ? enemies : heroes;
        const second = first === heroes ? enemies : heroes;

        // Intercalado parejo: el bando más chico queda repartido a lo largo de la ronda en vez de
        // amontonar al final los turnos sobrantes del más grande (2 contra 4 = H E E H E E, no H E H E E E).
        const slots = [
            ...first.map((id, i) => ({ id, key: i / first.length, tie: 1 })),
            ...second.map((id, i) => ({ id, key: (i + 0.5) / second.length, tie: 0 })),
        ];
        return slots.sort((a, b) => a.key - b.key || a.tie - b.tie).map((s) => s.id);
    },

    refill(c: Combatant): void {
        c.res.ap = Math.max(0, c.res.maxAp + flatModifier(c, "ap"));
        c.res.mp = hasFlag(c, "rooted") ? 0 : Math.max(0, c.res.maxMp + flatModifier(c, "mp"));
        c.res.mana = Math.min(c.res.maxMana, c.res.mana + Math.floor(c.res.maxMana * MANA_REGEN_PCT));
        c.res.stamina = Math.min(c.res.maxStamina, c.res.stamina + (c.res.maxStamina > 0 ? STAMINA_REGEN : 0));
        c.movedThisTurn = false;
    },

    tickCooldowns(c: Combatant): void {
        for (const id of Object.keys(c.cooldowns)) {
            c.cooldowns[id] = Math.max(0, c.cooldowns[id] - 1);
        }
    },

    /** Siguiente combatiente vivo de la ronda, o null si la ronda terminó. */
    nextAlive(state: BattleState): string | null {
        for (let i = state.turnIndex + 1; i < state.turnOrder.length; i++) {
            if (state.combatants[state.turnOrder[i]]?.alive) {
                state.turnIndex = i;
                return state.turnOrder[i];
            }
        }
        return null;
    },
};

/**
 * Máquina de estados de la batalla. Es pura: no hace I/O, el reloj se inyecta y el
 * azar sale de state.rng. Solo se detiene en "placement", "awaitingAction" y "finished".
 */
export class BattleEngine {
    private readonly rng: Rng;
    private readonly opts: EngineOptions;

    constructor(
        private readonly s: BattleState,
        opts: Partial<EngineOptions> = {},
    ) {
        this.rng = new Rng(s);
        this.opts = { now: opts.now ?? Date.now, turnTimeMs: opts.turnTimeMs ?? DEFAULT_TURN_TIME_MS };
    }

    get state(): Readonly<BattleState> {
        return this.s;
    }

    /** Durante la colocación, mueve a un héroe a otra casilla inicial libre de su bando. */
    place(actorId: string, tile: Tile): Result<BattleEvent[]> {
        if (this.s.phase.kind !== "placement") return { ok: false, error: "not_in_placement" };
        const actor = this.s.combatants[actorId];
        if (!actor) return { ok: false, error: "unknown_actor" };
        const allowed = this.s.grid.spawns[actor.team].some((t) => sameTile(t, tile));
        const occupant = combatantAt(this.s, tile);
        if (!allowed || (occupant && occupant.id !== actorId)) return { ok: false, error: "invalid_spawn" };
        actor.pos = { ...tile };
        this.s.version += 1;
        return { ok: true, value: [{ t: "placed", actorId, pos: { ...tile } }] };
    }

    /** Cierra la colocación y arranca la primera ronda. */
    begin(): BattleEvent[] {
        if (this.s.phase.kind !== "placement") return [];
        this.s.phase = { kind: "roundStart" };
        const events = this.advance();
        const started = events.find((e) => e.t === "roundStarted");
        return [{ t: "battleStarted", order: started && started.t === "roundStarted" ? started.order : [] }, ...events];
    }

    /** Ejecuta fases automáticas hasta que haga falta una entrada o la batalla termine. */
    advance(): BattleEvent[] {
        const out: BattleEvent[] = [];

        for (;;) {
            const phase = this.s.phase;
            switch (phase.kind) {
                case "placement":
                case "awaitingAction":
                case "finished":
                    return out;

                case "roundStart": {
                    if (this.s.round >= MAX_ROUNDS) {
                        this.s.phase = { kind: "finished", winner: "draw" };
                        out.push({ t: "battleEnded", winner: "draw" });
                        return out;
                    }
                    this.s.round += 1;
                    this.s.turnOrder = TurnManager.computeOrder(this.s, this.rng);
                    this.s.turnIndex = 0;
                    out.push({ t: "roundStarted", round: this.s.round, order: [...this.s.turnOrder] });
                    this.s.phase = { kind: "turnStart", actorId: this.s.turnOrder[0] };
                    break;
                }

                case "turnStart": {
                    const actor = this.s.combatants[phase.actorId];
                    if (actor.alive) {
                        out.push(...onTurnStart(actor));
                        TurnManager.refill(actor);
                    }
                    if (this.checkVictory(out)) return out;

                    if (!actor.alive || hasFlag(actor, "skipTurn")) {
                        this.s.phase = { kind: "turnEnd", actorId: actor.id };
                        break;
                    }

                    const deadline = this.opts.now() + this.opts.turnTimeMs;
                    out.push({ t: "turnStarted", actorId: actor.id, ap: actor.res.ap, mp: actor.res.mp, deadline });
                    out.push({
                        t: "resources",
                        targetId: actor.id,
                        res: { ap: actor.res.ap, mp: actor.res.mp, mana: actor.res.mana, stamina: actor.res.stamina },
                    });
                    this.s.phase = { kind: "awaitingAction", actorId: actor.id, deadline };
                    return out;
                }

                case "turnEnd": {
                    const actor = this.s.combatants[phase.actorId];
                    if (actor.alive) {
                        out.push(...onTurnEnd(actor));
                        TurnManager.tickCooldowns(actor);
                    }
                    out.push({ t: "turnEnded", actorId: actor.id });
                    if (this.checkVictory(out)) return out;

                    const nextId = TurnManager.nextAlive(this.s);
                    this.s.phase = nextId ? { kind: "turnStart", actorId: nextId } : { kind: "roundStart" };
                    break;
                }
            }
        }
    }

    /** Única entrada de acciones, humanas o de la IA. */
    submit(action: BattleAction): Result<BattleEvent[]> {
        const phase = this.s.phase;
        if (phase.kind !== "awaitingAction" || phase.actorId !== action.actorId) {
            return { ok: false, error: "not_your_turn" };
        }

        const error = validateAction(this.s, action);
        if (error) return { ok: false, error };

        const events = resolveAction(this.s, action, this.rng);
        this.s.version += 1;
        if (this.checkVictory(events)) return { ok: true, value: events };

        const actor = this.s.combatants[action.actorId];
        const turnOver =
            action.type === "endTurn" ||
            action.type === "defend" ||
            action.type === "meditate" ||
            !actor.alive ||
            (actor.res.ap === 0 && actor.res.mp === 0);

        if (turnOver) {
            this.s.phase = { kind: "turnEnd", actorId: actor.id };
            events.push(...this.advance());
        }
        return { ok: true, value: events };
    }

    /** El servidor la llama cuando vence el reloj: el personaje queda defendiendo. */
    expireTurn(now: number): BattleEvent[] {
        const phase = this.s.phase;
        if (phase.kind !== "awaitingAction" || now < phase.deadline) return [];
        const result = this.submit({ type: "defend", actorId: phase.actorId });
        return result.ok ? result.value : [];
    }

    /** Un jugador abandona: su héroe cae y la batalla sigue. */
    forfeit(actorId: string): BattleEvent[] {
        const actor = this.s.combatants[actorId];
        if (!actor?.alive || this.s.phase.kind === "finished") return [];
        actor.alive = false;
        actor.res.hp = 0;
        const out: BattleEvent[] = [{ t: "died", targetId: actorId }];
        this.s.version += 1;
        if (this.checkVictory(out)) return out;
        const phase = this.s.phase;
        if (phase.kind === "awaitingAction" && phase.actorId === actorId) {
            this.s.phase = { kind: "turnEnd", actorId };
            out.push(...this.advance());
        }
        return out;
    }

    private checkVictory(out: BattleEvent[]): boolean {
        if (this.s.phase.kind === "finished") return true;
        const alive = (team: Team) => Object.values(this.s.combatants).some((c) => c.team === team && c.alive);
        const heroes = alive("heroes");
        const enemies = alive("enemies");
        if (heroes && enemies) return false;

        const winner: Team | "draw" = heroes ? "heroes" : enemies ? "enemies" : "draw";
        this.s.phase = { kind: "finished", winner };
        out.push({ t: "battleEnded", winner });
        return true;
    }
}
