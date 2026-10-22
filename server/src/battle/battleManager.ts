import {
    aiTakeTurn,
    BattleEngine,
    createBattle,
    createEnemy,
    createGrid,
    createHero,
    encounterEnemies,
    ENCOUNTERS,
    type BattleClientMessage,
    type BattleServerMessage,
    type BattleEvent,
    type BattleState,
    type ClassId,
    type Team,
    type Tile,
} from "@aoturnos/game-core";
import type { EntityId, Position, RuntimeCharacter, RuntimeClient } from "../types/runtime";
import type { PackageApi } from "../package";
import type { SocketApi } from "../socket";
import { getCharacterById, getClientById, isCharacterOnlineById } from "../runtimeRegistry";

export {};

const vars = require("../vars");
const pkg = require("../package") as PackageApi;
const socket = require("../socket") as SocketApi;

const GRID_WIDTH = 15;
const GRID_HEIGHT = 11;
const PARTY_GATHER_RADIUS = 12;
/** Pausa antes de que juegue la IA, para que el cliente alcance a animar lo anterior. */
const AI_TURN_DELAY_MS = 900;
const TURN_TIME_MS = 45_000;

/** Clases sin versión táctica todavía: se juegan con la más parecida de las cuatro iniciales. */
const CLASS_FALLBACK: Record<number, ClassId> = { 1: 1, 2: 2, 3: 3, 4: 3, 6: 2, 7: 2, 8: 3, 9: 9 };

type BattleCharacter = RuntimeCharacter & { battleId?: string | null };

type LiveBattle = {
    engine: BattleEngine;
    encounterId: string;
    /** characterId -> combatantId */
    heroes: Map<string, string>;
    timer: ReturnType<typeof setTimeout> | null;
};

const battles = new Map<string, LiveBattle>();
let battleCounter = 0;

function send(characterId: EntityId, message: BattleServerMessage): void {
    const client = getClientById(characterId);
    if (!client) return;
    pkg.setPackageID(pkg.clientPacketID.battle);
    pkg.writeString(JSON.stringify(message));
    socket.send(client);
}

function broadcast(battle: LiveBattle, message: BattleServerMessage): void {
    for (const characterId of battle.heroes.keys()) send(characterId, message);
}

/** true si el personaje está en una batalla activa; el protocolo lo usa para bloquear la exploración. */
export function isInBattle(characterId: EntityId | null | undefined): boolean {
    const user = getCharacterById<BattleCharacter>(characterId);
    return Boolean(user?.battleId && battles.has(user.battleId));
}

/** Recorta del mapa del mundo la grilla de la batalla, centrada en el personaje. */
function cutGrid(map: number, center: Position) {
    const tiles = vars.mapa[map] ?? {};
    const x0 = Math.max(1, Math.min(100 - GRID_WIDTH + 1, center.x - Math.floor(GRID_WIDTH / 2)));
    const y0 = Math.max(1, Math.min(100 - GRID_HEIGHT + 1, center.y - Math.floor(GRID_HEIGHT / 2)));
    const blocked: Tile[] = [];
    const sightBlockers: Tile[] = [];

    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            const tile = tiles[y0 + y]?.[x0 + x];
            const graphics = tile?.graphics ?? {};
            const isWater = Boolean(require("../game").hayAgua(map, { x: x0 + x, y: y0 + y }));
            if (!tile || tile.blocked || isWater) {
                if (tile?.blocked && (graphics[2] || graphics[3])) sightBlockers.push({ x, y });
                else blocked.push({ x, y });
            }
        }
    }

    const grid = createGrid(GRID_WIDTH, GRID_HEIGHT, { blocked, sightBlockers, origin: { map, x: x0, y: y0 } });

    // Si el recorte deja muy pocas casillas iniciales, se usa una grilla limpia para no trabar la batalla.
    if (grid.spawns.heroes.length < 4 || grid.spawns.enemies.length < 4) {
        return createGrid(GRID_WIDTH, GRID_HEIGHT, { origin: { map, x: x0, y: y0 } });
    }
    return grid;
}

function gatherParty(leader: BattleCharacter): BattleCharacter[] {
    const members: BattleCharacter[] = [leader];
    const partyId = leader.partyId;
    const party = partyId ? vars.parties?.[partyId] : undefined;
    if (!party) return members;

    for (const memberId of party.memberIds ?? []) {
        if (String(memberId) === String(leader.id) || members.length >= 4) continue;
        const member = getCharacterById<BattleCharacter>(memberId);
        if (!member || !isCharacterOnlineById(memberId) || member.dead || member.battleId) continue;
        if (member.map !== leader.map) continue;
        if (Math.abs(member.pos.x - leader.pos.x) + Math.abs(member.pos.y - leader.pos.y) > PARTY_GATHER_RADIUS) continue;
        members.push(member);
    }
    return members;
}

export function startBattle(leaderId: EntityId, encounterId = "lobos"): string | null {
    const leader = getCharacterById<BattleCharacter>(leaderId);
    if (!leader) return null;

    const notice = (message: string) => send(leaderId, { kind: "notice", message });
    if (leader.battleId && battles.has(leader.battleId)) {
        notice("Ya estás en una batalla.");
        return null;
    }
    if (leader.dead) {
        notice("No podés iniciar una batalla estando muerto.");
        return null;
    }
    if (leader.challengeMatchId || leader.arenaRoomId) {
        notice("Terminá el reto o la arena antes de iniciar una batalla.");
        return null;
    }
    const encounter = ENCOUNTERS[encounterId];
    if (!encounter) {
        notice(`Encuentro desconocido. Disponibles: ${Object.keys(ENCOUNTERS).join(", ")}.`);
        return null;
    }

    const members = gatherParty(leader);
    const heroes = members.map((member) =>
        createHero({
            characterId: String(member.id),
            name: member.nameCharacter,
            classId: CLASS_FALLBACK[Number(member.idClase)] ?? 3,
            level: Number(member.level ?? 1),
            appearance: {
                body: Number(member.idBody ?? 0),
                head: Number(member.idHead ?? 0),
                weapon: Number(member.idWeapon ?? 0),
                shield: Number(member.idShield ?? 0),
                helmet: Number(member.idHelmet ?? 0),
            },
        }),
    );
    const enemies = encounterEnemies(encounter, heroes.length).map((id, i) => createEnemy(id, i));

    battleCounter += 1;
    const battleId = `b${Date.now().toString(36)}${battleCounter}`;
    const state = createBattle({ id: battleId, grid: cutGrid(leader.map, leader.pos), heroes, enemies });
    const engine = new BattleEngine(state, { turnTimeMs: TURN_TIME_MS });
    const battle: LiveBattle = { engine, encounterId, heroes: new Map(), timer: null };

    for (const hero of heroes) {
        const characterId = hero.source.kind === "character" ? hero.source.characterId : "";
        battle.heroes.set(characterId, hero.id);
        const member = getCharacterById<BattleCharacter>(characterId);
        if (member) member.battleId = battleId;
    }
    battles.set(battleId, battle);

    const startEvents = engine.begin();
    for (const [characterId, combatantId] of battle.heroes) {
        send(characterId, { kind: "start", battleId, you: combatantId, encounter: encounter.name, state: engine.state });
    }
    publish(battle, startEvents, 1200);
    return battleId;
}

/** Envía eventos y programa lo que sigue: turno de IA o reloj del jugador. */
function publish(battle: LiveBattle, events: BattleEvent[], aiDelayMs = AI_TURN_DELAY_MS): void {
    const state = battle.engine.state;
    if (events.length > 0) broadcast(battle, { kind: "events", battleId: state.id, version: state.version, events, state });

    if (battle.timer) clearTimeout(battle.timer);
    battle.timer = null;

    const phase = state.phase;
    if (phase.kind === "finished") {
        finish(battle, phase.winner);
        return;
    }
    if (phase.kind !== "awaitingAction") return;

    const actor = state.combatants[phase.actorId];
    const ownerId = actor.source.kind === "character" ? actor.source.characterId : null;
    const aiControlled = actor.controller === "ai" || !ownerId || !isCharacterOnlineById(ownerId);

    if (aiControlled) {
        // Un poco más de pausa si hubo animaciones largas (movimientos, hechizos).
        const busy = events.filter((e) => e.t === "moved" || e.t === "abilityCast").length;
        battle.timer = setTimeout(() => publish(battle, aiTakeTurn(battle.engine)), aiDelayMs + busy * 350);
    } else {
        battle.timer = setTimeout(
            () => publish(battle, battle.engine.expireTurn(Date.now())),
            Math.max(0, phase.deadline - Date.now()) + 50,
        );
    }
}

function finish(battle: LiveBattle, winner: Team | "draw"): void {
    const state = battle.engine.state;
    if (battle.timer) clearTimeout(battle.timer);
    battle.timer = null;
    battles.delete(state.id);

    const encounter = ENCOUNTERS[battle.encounterId];
    const won = winner === "heroes";
    const share = won ? Math.floor(encounter.exp / Math.max(1, battle.heroes.size)) : 0;
    const gold = won ? Math.floor(encounter.gold / Math.max(1, battle.heroes.size)) : 0;
    const handleProtocol = require("../handleProtocol");
    const game = require("../game");

    for (const [characterId, combatantId] of battle.heroes) {
        const user = getCharacterById<BattleCharacter>(characterId);
        const hero = state.combatants[combatantId];
        if (!user) continue;
        user.battleId = null;

        // Por ahora caer en batalla no mata en el mundo: se vuelve con lo justo para seguir.
        user.hp = Math.max(1, Math.min(Number(user.maxHp ?? hero.res.maxHp), hero.alive ? hero.res.hp : 1));
        if (Number(user.maxMana ?? 0) > 0) user.mana = Math.min(Number(user.maxMana), hero.res.mana);
        user.exp = Number(user.exp ?? 0) + share;
        user.gold = Number(user.gold ?? 0) + gold;

        const client = getClientById<RuntimeClient>(characterId);
        if (client) {
            handleProtocol.updateHP(user.hp, client);
            if (Number(user.maxMana ?? 0) > 0) handleProtocol.updateMana(user.mana, client);
            handleProtocol.actExp(user.exp, client);
            handleProtocol.actGold(user.gold, client);
        }
        if (share > 0) game.checkUserLevel(characterId);
        send(characterId, { kind: "end", battleId: state.id, winner, rewards: { exp: share, gold } });
    }
}

export function handleClientMessage(characterId: EntityId, message: BattleClientMessage): void {
    const user = getCharacterById<BattleCharacter>(characterId);
    if (!user) return;

    if (message.kind === "start") {
        startBattle(characterId, message.encounter);
        return;
    }

    const battle = user.battleId ? battles.get(user.battleId) : undefined;
    if (!battle) return;
    const combatantId = battle.heroes.get(String(characterId));
    if (!combatantId) return;

    switch (message.kind) {
        case "snapshot":
            send(characterId, { kind: "snapshot", battleId: battle.engine.state.id, state: battle.engine.state });
            return;
        case "forfeit":
            publish(battle, battle.engine.forfeit(combatantId));
            return;
        case "action": {
            const action = message.action;
            // Un jugador solo puede mover a su propio héroe.
            if (!action || action.actorId !== combatantId) return;
            const result = battle.engine.submit(action);
            if (!result.ok) {
                send(characterId, {
                    kind: "rejected",
                    battleId: battle.engine.state.id,
                    error: result.error,
                    version: battle.engine.state.version,
                });
                return;
            }
            publish(battle, result.value);
            return;
        }
    }
}

/** Al desconectarse en medio de una batalla, la IA juega por el personaje (lo resuelve publish). */
export function activeBattleCount(): number {
    return battles.size;
}
