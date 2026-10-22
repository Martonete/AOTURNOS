import { useSyncExternalStore } from "react";
import type {
    BattleClientMessage,
    BattleEvent,
    BattleServerMessage,
    BattleState,
    Team,
} from "@aoturnos/game-core";
import { createBattleActionPacket } from "../../../lib/aowProtocol";

/** Lote de eventos que la escena tiene que animar antes de adoptar `state`. */
export type BattleBatch = { events: BattleEvent[]; state: BattleState };

export type BattleUiMode =
    | { kind: "move" }
    | { kind: "ability"; abilityId: string };

export type BattleStoreState = {
    /** idle: sin batalla. intro: transición de entrada. active: combatiendo. results: pantalla final. */
    stage: "idle" | "intro" | "active" | "results";
    battleId: string | null;
    you: string | null;
    encounter: string;
    /** Estado ya animado: lo que muestra la interfaz. */
    state: BattleState | null;
    /** Lotes pendientes de animar, en orden. */
    queue: BattleBatch[];
    animating: boolean;
    /** Acción enviada esperando respuesta del server. */
    pending: boolean;
    mode: BattleUiMode;
    log: Array<{ id: number; text: string; tone: "info" | "good" | "bad" | "warn" }>;
    result: { winner: Team | "draw"; exp: number; gold: number } | null;
    notice: string | null;
};

const initial: BattleStoreState = {
    stage: "idle",
    battleId: null,
    you: null,
    encounter: "",
    state: null,
    queue: [],
    animating: false,
    pending: false,
    mode: { kind: "move" },
    log: [],
    result: null,
    notice: null,
};

let current: BattleStoreState = initial;
const listeners = new Set<() => void>();
let socket: WebSocket | null = null;
/** Transporte alternativo sin servidor (modo práctica): recibe los mensajes en vez del WebSocket. */
let localTransport: ((message: BattleClientMessage) => void) | null = null;
let logCounter = 0;

function set(patch: Partial<BattleStoreState>): void {
    current = { ...current, ...patch };
    for (const listener of listeners) listener();
}

export const battleStore = {
    get(): BattleStoreState {
        return current;
    },

    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },

    /** useGameSession registra el WebSocket activo para poder enviar acciones. */
    attachSocket(next: WebSocket | null): void {
        socket = next;
        if (!next) set({ ...initial });
    },

    attachLocalTransport(handler: ((message: BattleClientMessage) => void) | null): void {
        localTransport = handler;
        if (!handler) set({ ...initial });
    },

    send(message: BattleClientMessage): boolean {
        if (localTransport) {
            if (message.kind === "action") set({ pending: true });
            localTransport(message);
            return true;
        }
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        socket.send(createBattleActionPacket(message));
        if (message.kind === "action") set({ pending: true });
        return true;
    },

    /** Entrada de los paquetes clientPacketID.battle. */
    receive(message: BattleServerMessage): void {
        switch (message.kind) {
            case "start":
                set({
                    stage: "intro",
                    battleId: message.battleId,
                    you: message.you,
                    encounter: message.encounter,
                    state: message.state,
                    queue: [],
                    animating: false,
                    pending: false,
                    mode: { kind: "move" },
                    log: [],
                    result: null,
                    notice: null,
                });
                this.pushLog(`Comienza el combate: ${message.encounter}.`, "warn");
                return;
            case "events":
                if (message.battleId !== current.battleId) return;
                set({ queue: [...current.queue, { events: message.events, state: message.state }], pending: false });
                return;
            case "snapshot":
                if (message.battleId !== current.battleId) return;
                set({ state: message.state, queue: [], pending: false });
                return;
            case "rejected":
                set({ pending: false, notice: describeError(message.error) });
                if (message.battleId === current.battleId) this.send({ kind: "snapshot" });
                return;
            case "end":
                if (message.battleId !== current.battleId) return;
                // La pantalla de resultados espera a que termine de animarse la cola.
                set({ result: { winner: message.winner, exp: message.rewards.exp, gold: message.rewards.gold } });
                return;
            case "notice":
                set({ notice: message.message });
                return;
        }
    },

    /** La escena toma el siguiente lote para animarlo. */
    takeBatch(): BattleBatch | null {
        const [next, ...rest] = current.queue;
        if (!next) return null;
        set({ queue: rest, animating: true });
        return next;
    },

    finishBatch(state: BattleState): void {
        set({ state, animating: false });
    },

    setStage(stage: BattleStoreState["stage"]): void {
        set({ stage });
    },

    setMode(mode: BattleUiMode): void {
        set({ mode });
    },

    clearNotice(): void {
        set({ notice: null });
    },

    pushLog(text: string, tone: BattleStoreState["log"][number]["tone"] = "info"): void {
        logCounter += 1;
        set({ log: [...current.log.slice(-60), { id: logCounter, text, tone }] });
    },

    close(): void {
        set({ ...initial });
    },
};

export function useBattleStore<T>(selector: (state: BattleStoreState) => T): T {
    return useSyncExternalStore(
        battleStore.subscribe,
        () => selector(current),
        () => selector(initial),
    );
}

const ERRORS: Record<string, string> = {
    not_your_turn: "No es tu turno.",
    not_enough_ap: "No te alcanzan los PA.",
    not_enough_mp: "No te alcanzan los PM.",
    not_enough_mana: "No tenés suficiente maná.",
    not_enough_stamina: "No tenés suficiente stamina.",
    on_cooldown: "Esa habilidad se está recargando.",
    no_uses_left: "Ya la usaste en esta batalla.",
    rooted: "Estás inmovilizado.",
    invalid_path: "No podés llegar ahí.",
    out_of_range: "Fuera de alcance.",
    no_line_of_sight: "No hay línea de visión.",
    invalid_target: "Objetivo inválido.",
    taunted: "Estás provocado: tenés que atacar a quien te provocó.",
    already_moved: "Para meditar no tenés que haberte movido.",
    no_item: "No te quedan de esas.",
};

export function describeError(code: string): string {
    return ERRORS[code] ?? "Acción inválida.";
}
