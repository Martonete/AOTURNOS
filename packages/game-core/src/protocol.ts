import type { BattleAction, BattleEvent, BattleState, Team } from "./battle/types";

/** Mensajes del server al cliente, en clientPacketID.battle (82) como JSON. */
export type BattleServerMessage =
    | { kind: "start"; battleId: string; you: string; encounter: string; state: BattleState }
    /** `state` es el estado tras aplicar los eventos: el cliente anima los eventos y después lo adopta. */
    | { kind: "events"; battleId: string; version: number; events: BattleEvent[]; state: BattleState }
    | { kind: "snapshot"; battleId: string; state: BattleState }
    | { kind: "rejected"; battleId: string; error: string; version: number }
    | { kind: "end"; battleId: string; winner: Team | "draw"; rewards: { exp: number; gold: number } }
    | { kind: "notice"; message: string };

/** Mensajes del cliente al server, en serverPacketID.battleAction (249) como JSON. */
export type BattleClientMessage =
    | { kind: "start"; encounter?: string }
    | { kind: "action"; action: BattleAction }
    | { kind: "snapshot" }
    | { kind: "forfeit" };

export const BATTLE_CLIENT_PACKET_ID = 82;
export const BATTLE_SERVER_PACKET_ID = 249;
