export type Team = "heroes" | "enemies";

/** Ids de vars.clases en server/src/vars.ts. Jugables: Mago 1, Clérigo 2, Paladín 8, Cazador 9 (arquero). */
export type ClassId = 1 | 2 | 8 | 9;

/** vars.direcciones: 1 arriba, 2 abajo, 3 derecha, 4 izquierda. */
export type Heading = 1 | 2 | 3 | 4;

export type Tile = { x: number; y: number };

export type DamageSchool = "physical" | "magic" | "fire" | "lightning" | "holy" | "poison";

export type StatusId =
    | "paralizado"
    | "inmunidadParalisis"
    | "inmovilizado"
    | "aturdido"
    | "envenenado"
    | "quemadura"
    | "celeridad"
    | "torpeza"
    | "fuerza"
    | "debilidad"
    | "invisible"
    | "provocado"
    | "defendiendo"
    | "ralentizado"
    | "caparazon";

/** Cómo se mueve y elige posición la IA, al estilo de las familias de monstruos de Dofus. */
export type Behavior =
    /** Va de frente al más cercano. */
    | "charger"
    /** Rodea y busca la espalda; la manada se reparte alrededor del objetivo. */
    | "flanker"
    /** Pega y se aleja con los PM que le quedan. */
    | "skirmisher"
    /** Mantiene su distancia preferida y huye si lo encierran. */
    | "kiter"
    /** Lento y pesado: avanza sin importarle nada. */
    | "brute"
    /** Se queda cerca de sus aliados más débiles. */
    | "guardian"
    /** Escapa cuando está malherido. */
    | "coward";

export type AbilityId = string;

export type ItemKind = "pocionVida" | "pocionMana";

export type Resources = {
    hp: number;
    maxHp: number;
    mana: number;
    maxMana: number;
    stamina: number;
    maxStamina: number;
    ap: number;
    maxAp: number;
    mp: number;
    maxMp: number;
};

export type CombatStats = {
    level: number;
    fuerza: number;
    agilidad: number;
    inteligencia: number;
    constitucion: number;
    /** Golpe del arma equipada (minHit/maxHit en el server). */
    hitMin: number;
    hitMax: number;
    /** Equivalente a poderAtaqueArma / poderEvasion de game.ts. */
    attackPower: number;
    evasion: number;
    /** Reducción plana de daño físico (armadura + escudo + casco). */
    defense: number;
    /** Porcentaje de reducción de daño mágico (modResistenciaMagica + equipo). */
    magicResist: number;
    /** Multiplicador de daño mágico por clase (modDmgMagia). */
    magicDamageMod: number;
    /** Multiplicador de daño físico por clase (modDmgArmas o modDmgProyectiles). */
    physicalDamageMod: number;
};

export type StatusInstance = {
    id: StatusId;
    turnsLeft: number;
    stacks: number;
    sourceId: string;
    /** Valor variable del estado (p. ej. cuánta fuerza suma un buff). */
    magnitude: number;
};

export type CombatantSource =
    | { kind: "character"; characterId: string }
    | { kind: "npc"; templateId: string };

export type Combatant = {
    id: string;
    name: string;
    team: Team;
    source: CombatantSource;
    classId?: ClassId;
    /** Índices gráficos para que el cliente pueda dibujarlo. */
    appearance: { body: number; head: number; weapon: number; shield: number; helmet: number };
    pos: Tile;
    heading: Heading;
    res: Resources;
    stats: CombatStats;
    abilities: AbilityId[];
    statuses: StatusInstance[];
    cooldowns: Record<AbilityId, number>;
    consumables: Partial<Record<ItemKind, number>>;
    tags: Array<"undead" | "boss" | "zoneOfControl" | "staff" | "longShot">;
    immunities: StatusId[];
    controller: "player" | "ai";
    /** Personalidad de movimiento de la IA; si falta se deduce del arquetipo. */
    behavior?: Behavior;
    /** Distancia a la que le gusta pelear (para kiter y skirmisher). */
    preferredRange?: [number, number];
    /** Familia de monstruo, para mostrarla en la ficha. */
    family?: string;
    /** Arquetipo que guía a la IA. */
    archetype: "melee" | "ranged" | "caster" | "support";
    alive: boolean;
    /** Usos por batalla ya gastados (Resucitar, por ejemplo). */
    usesThisBattle: Record<AbilityId, number>;
    movedThisTurn: boolean;
};

export type BattleGrid = {
    width: number;
    height: number;
    /** 1 = no se puede pisar (pared, agua, objeto bloqueante). Índice y * width + x. */
    blocked: number[];
    /** 1 = corta la línea de visión (paredes, árboles). */
    blocksSight: number[];
    /** Casillas iniciales de cada bando. */
    spawns: Record<Team, Tile[]>;
    /** Origen en el mapa del mundo, para volver tras la batalla. */
    origin?: { map: number; x: number; y: number };
};

export type BattlePhase =
    | { kind: "placement" }
    | { kind: "roundStart" }
    | { kind: "turnStart"; actorId: string }
    | { kind: "awaitingAction"; actorId: string; deadline: number }
    | { kind: "turnEnd"; actorId: string }
    | { kind: "finished"; winner: Team | "draw" };

export type BattleState = {
    id: string;
    /** Estado del PRNG sembrado. Con la misma semilla y las mismas acciones el resultado es idéntico. */
    rng: number;
    grid: BattleGrid;
    combatants: Record<string, Combatant>;
    round: number;
    turnOrder: string[];
    turnIndex: number;
    phase: BattlePhase;
    /** Se incrementa con cada acción aceptada; el cliente lo usa para detectar desincronización. */
    version: number;
};

export type BattleAction =
    | { type: "move"; actorId: string; path: Tile[] }
    | { type: "ability"; actorId: string; abilityId: AbilityId; target: Tile }
    | { type: "item"; actorId: string; item: ItemKind; target: Tile }
    | { type: "meditate"; actorId: string }
    | { type: "defend"; actorId: string }
    | { type: "endTurn"; actorId: string };

export type Flank = "front" | "side" | "back";

export type BattleEvent =
    | { t: "battleStarted"; order: string[] }
    | { t: "placed"; actorId: string; pos: Tile }
    | { t: "roundStarted"; round: number; order: string[] }
    | { t: "turnStarted"; actorId: string; ap: number; mp: number; deadline: number }
    | { t: "moved"; actorId: string; path: Tile[]; heading: Heading; mpLeft: number }
    | { t: "faced"; actorId: string; heading: Heading }
    | { t: "abilityCast"; actorId: string; abilityId: AbilityId; target: Tile; tiles: Tile[]; affected: string[] }
    | { t: "itemUsed"; actorId: string; item: ItemKind; targetId: string }
    | { t: "damaged"; targetId: string; sourceId: string; amount: number; school: DamageSchool; crit: boolean; flank: Flank; hpLeft: number }
    | { t: "healed"; targetId: string; sourceId: string; amount: number; hpLeft: number }
    | { t: "missed"; targetId: string; sourceId: string }
    | { t: "resources"; targetId: string; res: Partial<Resources> }
    | { t: "statusApplied"; targetId: string; status: StatusId; turns: number; stacks: number }
    | { t: "statusResisted"; targetId: string; status: StatusId }
    | { t: "statusExpired"; targetId: string; status: StatusId }
    | { t: "meditated"; actorId: string; manaGained: number }
    | { t: "defended"; actorId: string }
    /** Quien defendía devuelve el golpe; le siguen "damaged" o "missed" sobre el atacante. */
    | { t: "riposted"; actorId: string; targetId: string }
    | { t: "died"; targetId: string }
    /** Desplazamiento forzado; `collided` si chocó contra algo y recibió daño. */
    | { t: "pushed"; targetId: string; path: Tile[]; collided: boolean }
    | { t: "teleported"; actorId: string; from: Tile; to: Tile }
    | { t: "revived"; targetId: string; hp: number }
    | { t: "turnEnded"; actorId: string }
    | { t: "battleEnded"; winner: Team | "draw" };

export type BattleError =
    | "not_your_turn"
    | "not_in_placement"
    | "invalid_spawn"
    | "unknown_actor"
    | "unknown_ability"
    | "not_enough_ap"
    | "not_enough_mp"
    | "not_enough_mana"
    | "not_enough_stamina"
    | "on_cooldown"
    | "no_uses_left"
    | "rooted"
    | "invalid_path"
    | "out_of_range"
    | "no_line_of_sight"
    | "invalid_target"
    | "taunted"
    | "already_moved"
    | "no_item";

export type Result<T> = { ok: true; value: T } | { ok: false; error: BattleError };
