import {
    aiTakeTurn,
    BattleEngine,
    createBattle,
    createEnemy,
    createEnemyFromNpc,
    createGrid,
    isBlocked,
    combatantAt,
    createHero,
    encounterEnemies,
    ENCOUNTERS,
    type BattleClientMessage,
    type BattleServerMessage,
    type BattleEvent,
    type BattleState,
    type ClassId,
    type Combatant,
    type Team,
    type Tile,
} from "@aoturnos/game-core";
import type { EntityId, Position, RuntimeCharacter, RuntimeClient, RuntimeNpc } from "../types/runtime";
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
type BattleNpc = RuntimeNpc & { battleId?: string | null };

/** Radio en el que los NPCs hostiles cercanos se suman a la pelea. */
const NPC_GROUP_RADIUS = 5;
const MAX_WORLD_ENEMIES = 6;

type LiveBattle = {
    engine: BattleEngine;
    /** Encuentro de prueba (/batalla) o null si salió de atacar NPCs del mapa. */
    encounterId: string | null;
    /** characterId -> combatantId */
    heroes: Map<string, string>;
    /** NPCs del mundo que pelean en esta batalla (worldId -> combatantId). */
    worldNpcs: Map<string, string>;
    leaderId: string;
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

/** Valida que un personaje pueda entrar en combate; si no, le avisa por qué. */
function canStartBattle(leader: BattleCharacter): boolean {
    const notice = (message: string) => send(leader.id, { kind: "notice", message });
    if (leader.battleId && battles.has(leader.battleId)) {
        notice("Ya estás en una batalla.");
        return false;
    }
    if (leader.dead) {
        notice("No podés iniciar una batalla estando muerto.");
        return false;
    }
    if (leader.challengeMatchId || leader.arenaRoomId) {
        notice("Terminá el reto o la arena antes de iniciar una batalla.");
        return false;
    }
    return true;
}

/** La vida y el maná del mundo pasan a la batalla en la misma proporción. */
function heroFromCharacter(member: BattleCharacter): Combatant {
    const hero = createHero({
        characterId: String(member.id),
        name: member.nameCharacter,
        classId: CLASS_FALLBACK[Number(member.idClase)] ?? 3,
        level: Number(member.level ?? 1),
        // Solo para pruebas: AO_BATTLE_AUTOPLAY=1 deja que la IA juegue también por los héroes.
        controller: process.env.AO_BATTLE_AUTOPLAY === "1" ? "ai" : "player",
        appearance: {
            body: Number(member.idBody ?? 0),
            head: Number(member.idHead ?? 0),
            weapon: Number(member.idWeapon ?? 0),
            shield: Number(member.idShield ?? 0),
            helmet: Number(member.idHelmet ?? 0),
        },
    });
    const hpRatio = Number(member.maxHp ?? 0) > 0 ? Number(member.hp ?? 0) / Number(member.maxHp) : 1;
    hero.res.hp = Math.max(1, Math.min(hero.res.maxHp, Math.round(hero.res.maxHp * hpRatio)));
    const manaRatio = Number(member.maxMana ?? 0) > 0 ? Number(member.mana ?? 0) / Number(member.maxMana) : 1;
    hero.res.mana = Math.max(0, Math.min(hero.res.maxMana, Math.round(hero.res.maxMana * manaRatio)));
    return hero;
}

/** Pone a cada combatiente en la casilla donde está en el mundo, si cae dentro de la grilla y está libre. */
function keepWorldPositions(state: BattleState, worldPos: Map<string, Position>): void {
    const origin = state.grid.origin;
    if (!origin) return;
    for (const [combatantId, pos] of worldPos) {
        const c = state.combatants[combatantId];
        const tile = { x: pos.x - origin.x, y: pos.y - origin.y };
        if (!c || tile.x < 0 || tile.y < 0 || tile.x >= state.grid.width || tile.y >= state.grid.height) continue;
        if (isBlocked(state.grid, tile)) continue;
        const occupant = combatantAt(state, tile);
        if (occupant && occupant.id !== c.id) continue;
        c.pos = tile;
    }
}

function launch(
    leader: BattleCharacter,
    members: BattleCharacter[],
    enemies: Combatant[],
    opts: { encounterId: string | null; title: string; center: Position; worldNpcs?: Map<string, string>; worldPos?: Map<string, Position> },
): string {
    const heroes = members.map(heroFromCharacter);
    battleCounter += 1;
    const battleId = `b${Date.now().toString(36)}${battleCounter}`;
    const state = createBattle({ id: battleId, grid: cutGrid(leader.map, opts.center), heroes, enemies });

    if (opts.worldPos) {
        const positions = new Map(opts.worldPos);
        for (const member of members) positions.set(`hero:${member.id}`, member.pos);
        keepWorldPositions(state, positions);
    }

    const engine = new BattleEngine(state, { turnTimeMs: TURN_TIME_MS });
    const battle: LiveBattle = {
        engine,
        encounterId: opts.encounterId,
        heroes: new Map(),
        worldNpcs: opts.worldNpcs ?? new Map(),
        leaderId: String(leader.id),
        timer: null,
    };

    for (const hero of heroes) {
        const characterId = hero.source.kind === "character" ? hero.source.characterId : "";
        battle.heroes.set(characterId, hero.id);
        const member = getCharacterById<BattleCharacter>(characterId);
        if (member) member.battleId = battleId;
    }
    for (const worldId of battle.worldNpcs.keys()) {
        const npc = vars.npcs[worldId] as BattleNpc | undefined;
        if (npc) npc.battleId = battleId;
    }
    battles.set(battleId, battle);

    const startEvents = engine.begin();
    for (const [characterId, combatantId] of battle.heroes) {
        send(characterId, { kind: "start", battleId, you: combatantId, encounter: opts.title, state: engine.state });
    }
    publish(battle, startEvents, 1200);
    return battleId;
}

export function startBattle(leaderId: EntityId, encounterId = "lobos"): string | null {
    const leader = getCharacterById<BattleCharacter>(leaderId);
    if (!leader || !canStartBattle(leader)) return null;
    const encounter = ENCOUNTERS[encounterId];
    if (!encounter) {
        send(leaderId, { kind: "notice", message: `Encuentro desconocido. Disponibles: ${Object.keys(ENCOUNTERS).join(", ")}.` });
        return null;
    }
    const members = gatherParty(leader);
    const enemies = encounterEnemies(encounter, members.length).map((id, i) => createEnemy(id, i));
    return launch(leader, members, enemies, { encounterId, title: encounter.name, center: leader.pos });
}

/** true si el NPC del mundo está peleando en una batalla por turnos: no piensa, no se mueve, no se le puede pegar. */
export function isNpcInBattle(npcId: EntityId | null | undefined): boolean {
    if (npcId === null || npcId === undefined) return false;
    const npc = vars.npcs[npcId] as BattleNpc | undefined;
    return Boolean(npc?.battleId && battles.has(npc.battleId));
}

function canJoinWorldBattle(npc: BattleNpc | undefined): npc is BattleNpc {
    return Boolean(
        npc &&
            npc.isNpc &&
            !npc.summonedByUserId &&
            Number(npc.maxHp ?? 0) > 0 &&
            Number(npc.hp ?? 0) > 0 &&
            !(npc.battleId && battles.has(npc.battleId)),
    );
}

function npcToEnemy(npc: BattleNpc, index: number): Combatant {
    return createEnemyFromNpc(
        {
            worldId: String(npc.id),
            npcIndex: Number(npc.templateNpcIndex ?? 0) || undefined,
            name: String(npc.nameCharacter ?? "Criatura"),
            hp: Number(npc.hp ?? 1),
            maxHp: Number(npc.maxHp ?? 1),
            minHit: Number(npc.minHit ?? 1),
            maxHit: Number(npc.maxHit ?? 2),
            def: Number(npc.def ?? 0),
            attackPower: Number(npc.poderAtaque ?? 50),
            evasion: Number(npc.poderEvasion ?? 30),
            caster: Array.isArray(npc.spells) && npc.spells.length > 0,
            appearance: {
                body: Number(npc.idBody ?? 0),
                head: Number(npc.idHead ?? 0),
                weapon: Number(npc.idWeapon ?? 0),
                shield: Number(npc.idShield ?? 0),
                helmet: Number(npc.idHelmet ?? 0),
            },
        },
        index,
    );
}

/**
 * Atacar a un NPC del mapa abre una batalla por turnos en ese mismo lugar: pelean ese NPC,
 * los hostiles que estén cerca y la party del atacante. Devuelve true si la batalla empezó.
 */
export function startWorldBattle(leaderId: EntityId, npcId: EntityId, opts: { aggressor?: boolean } = {}): boolean {
    const leader = getCharacterById<BattleCharacter>(leaderId);
    const target = vars.npcs[npcId] as BattleNpc | undefined;
    if (!leader || !canJoinWorldBattle(target)) return false;
    // Si la criatura es la que ataca y el jugador no puede pelear (muerto, en reto o arena), sigue el combate normal.
    if (opts.aggressor) {
        if (leader.dead || leader.challengeMatchId || leader.arenaRoomId || (leader.battleId && battles.has(leader.battleId))) {
            return false;
        }
    } else if (!canStartBattle(leader)) {
        return true;
    }

    const members = gatherParty(leader);
    const limit = Math.min(MAX_WORLD_ENEMIES, 1 + members.length + 1);
    const group: BattleNpc[] = [target];
    const nearby: BattleNpc[] = [];
    for (const id in vars.npcs) {
        const npc = vars.npcs[id] as BattleNpc | undefined;
        if (!canJoinWorldBattle(npc) || String(npc.id) === String(target.id)) continue;
        if (npc.map !== target.map || npc.movement !== 3) continue;
        if (Math.abs(npc.pos.x - target.pos.x) + Math.abs(npc.pos.y - target.pos.y) > NPC_GROUP_RADIUS) continue;
        nearby.push(npc);
    }
    nearby.sort(
        (a, b) =>
            Math.abs(a.pos.x - target.pos.x) + Math.abs(a.pos.y - target.pos.y) -
            (Math.abs(b.pos.x - target.pos.x) + Math.abs(b.pos.y - target.pos.y)),
    );
    group.push(...nearby.slice(0, limit - 1));

    const enemies = group.map(npcToEnemy);
    const worldNpcs = new Map(group.map((npc, i) => [String(npc.id), enemies[i].id]));
    const worldPos = new Map(group.map((npc, i) => [enemies[i].id, npc.pos]));
    const center = {
        x: Math.round((leader.pos.x + target.pos.x) / 2),
        y: Math.round((leader.pos.y + target.pos.y) / 2),
    };
    const name = group.length > 1 ? `${target.nameCharacter} y ${group.length - 1} más` : String(target.nameCharacter);
    const title = opts.aggressor ? `¡Emboscada! ${name}` : name;
    launch(leader, members, enemies, { encounterId: null, title, center, worldNpcs, worldPos });
    return true;
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

/** Al ganar, los NPCs del mundo mueren como en el combate normal: dan experiencia, oro y botín, y reaparecen. */
function resolveWorldNpcs(battle: LiveBattle, won: boolean): void {
    const respawn = require("../respawn");
    // muere() necesita el cliente de quien mató: el líder o, si se desconectó, cualquier héroe conectado.
    const killerId = [battle.leaderId, ...battle.heroes.keys()].find((id) => getClientById(id));
    const leaderClient = killerId ? getClientById<RuntimeClient>(killerId) : undefined;
    for (const worldId of battle.worldNpcs.keys()) {
        const npc = vars.npcs[worldId] as BattleNpc | undefined;
        if (!npc || npc.battleId !== battle.engine.state.id) continue;
        npc.battleId = null;
        if (won && leaderClient) {
            npc.hp = 0;
            respawn.muere(leaderClient, npc.id);
        } else {
            npc.hp = npc.maxHp;
            npc.currentTargetId = 0;
            npc.nextThinkAt = Date.now() + 1500;
        }
    }
}

function finish(battle: LiveBattle, winner: Team | "draw"): void {
    const state = battle.engine.state;
    if (battle.timer) clearTimeout(battle.timer);
    battle.timer = null;
    battles.delete(state.id);

    const won = winner === "heroes";
    const handleProtocol = require("../handleProtocol");
    const game = require("../game");
    const encounter = battle.encounterId ? ENCOUNTERS[battle.encounterId] : null;
    const share = won && encounter ? Math.floor(encounter.exp / Math.max(1, battle.heroes.size)) : 0;
    const goldShare = won && encounter ? Math.floor(encounter.gold / Math.max(1, battle.heroes.size)) : 0;

    // Primero se devuelve a cada héroe al mundo con su vida y maná proporcionales.
    const before = new Map<string, { exp: number; gold: number }>();
    for (const [characterId, combatantId] of battle.heroes) {
        const user = getCharacterById<BattleCharacter>(characterId);
        const hero = state.combatants[combatantId];
        if (!user) continue;
        user.battleId = null;
        // Por ahora caer en batalla no mata en el mundo: se vuelve con lo justo para seguir.
        const maxHp = Number(user.maxHp ?? hero.res.maxHp);
        const hpRatio = hero.alive ? hero.res.hp / Math.max(1, hero.res.maxHp) : 0;
        user.hp = Math.max(1, Math.min(maxHp, Math.round(maxHp * hpRatio)));
        if (Number(user.maxMana ?? 0) > 0 && hero.res.maxMana > 0) {
            user.mana = Math.min(Number(user.maxMana), Math.round(Number(user.maxMana) * (hero.res.mana / hero.res.maxMana)));
        }
        user.exp = Number(user.exp ?? 0) + share;
        user.gold = Number(user.gold ?? 0) + goldShare;
        before.set(characterId, { exp: Number(user.exp), gold: Number(user.gold) });
    }

    // Las muertes de los NPCs reales reparten experiencia, oro y botín por las reglas de siempre.
    if (battle.worldNpcs.size > 0) resolveWorldNpcs(battle, won);

    for (const characterId of battle.heroes.keys()) {
        const user = getCharacterById<BattleCharacter>(characterId);
        if (!user) continue;
        const prev = before.get(characterId) ?? { exp: Number(user.exp ?? 0), gold: Number(user.gold ?? 0) };
        const client = getClientById<RuntimeClient>(characterId);
        if (client) {
            handleProtocol.updateHP(user.hp, client);
            if (Number(user.maxMana ?? 0) > 0) handleProtocol.updateMana(user.mana, client);
            handleProtocol.actExp(user.exp, client);
            handleProtocol.actGold(user.gold, client);
        }
        if (share > 0) game.checkUserLevel(characterId);
        send(characterId, {
            kind: "end",
            battleId: state.id,
            winner,
            rewards: {
                exp: share + Math.max(0, Number(user.exp ?? 0) - prev.exp),
                gold: goldShare + Math.max(0, Number(user.gold ?? 0) - prev.gold),
            },
        });
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
