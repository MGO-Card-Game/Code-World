export type PlayerId = "player1" | "player2";
export type ScrollKind = "might" | "guard";

/**
 * 卷轴的使用时机（GameRule 8.9）。
 *
 * 决定一张牌归攻击方还是防守方打的是 timing，不是 kind——
 * 8.8 规划的六种卷轴里，力量/精准/狂暴都是 beforeAttackRoll，
 * 护盾/坚守/闪避都是 beforeDefenseRoll，但它们的 effectType 各不相同。
 * 第一阶段只开放这两个时机。
 */
export type ScrollTiming = "beforeAttackRoll" | "beforeDefenseRoll";
export type EquipmentKind = "sword" | "shield" | "charm";
export type TileType = "start" | "battle" | "treasure" | "spring" | "event" | "boss";

export interface OwnedScroll {
  instanceId: string;
  kind: ScrollKind;
}

export interface OwnedEquipment {
  instanceId: string;
  kind: EquipmentKind;
}

export interface Player {
  id: PlayerId;
  name: string;
  color: string;
  hp: number;
  maxHp: number;
  baseAttack: number;
  baseDefense: number;
  position: number;
  scrolls: OwnedScroll[];
  equipment: OwnedEquipment[];
}

export interface EnemyDefinition {
  id: string;
  name: string;
  maxHp: number;
  attack: number;
  defense: number;
  reward: "scroll" | "equipment" | "boss";
}

export interface MapTile {
  id: number;
  type: TileType;
  label: string;
  enemyId?: string;
  safeZone?: boolean;
}

export type CombatSide = "a" | "b";

export interface BattleState {
  kind: "pve" | "boss" | "pvp";
  aPlayerId: PlayerId;
  bPlayerId?: PlayerId;
  enemyId?: string;
  hpA: number;
  hpB: number;
  attacker: CombatSide;
  round: number;
  initiativeA: number;
  initiativeB: number;
  log: string[];
}

export interface PvpPenaltyState {
  winnerId: PlayerId;
  loserId: PlayerId;
  tileIndex: number;
}

export type GamePhase =
  | { kind: "awaitingRoll" }
  | { kind: "turnComplete" }
  | { kind: "battle"; battle: BattleState }
  | { kind: "pvpPenalty"; penalty: PvpPenaltyState }
  | { kind: "gameOver"; winnerId: PlayerId };

export type HpChangeReason =
  | "spring"
  | "event"
  | "charm"
  | "defeatRecovery"
  | "pvpTransfer";

/**
 * 引擎在一次 action 中产生的结构化事件。
 *
 * 与 `history` 的区别：`history` 是给玩家看的持久文字记录，
 * 事件流是给界面做动画编排的时间线——每条事件对应一个可播放的动画片段。
 * 规则引擎依然是原子结算的，事件只描述“发生了什么、顺序如何”，
 * 界面负责把它们拉长到时间轴上播放。
 */
export type GameEventBody =
  /** 与 addHistory 同步产生，用于把旁白文字对齐到动画节点上 */
  | { type: "narration"; text: string }
  | { type: "gameStarted"; starterId: PlayerId; rollP1: number; rollP2: number }
  | { type: "turnStarted"; playerId: PlayerId; turn: number }
  | { type: "movementRolled"; playerId: PlayerId; value: number }
  | { type: "playerMoved"; playerId: PlayerId; from: number; to: number }
  | { type: "playerRetreated"; playerId: PlayerId; from: number; to: number }
  /** 玩家真实生命值变化。战斗中的临时生命值请看 battleDamage */
  | {
      type: "playerHpChanged";
      playerId: PlayerId;
      from: number;
      to: number;
      maxHp: number;
      reason: HpChangeReason;
    }
  | { type: "maxHpChanged"; playerId: PlayerId; from: number; to: number }
  | {
      type: "scrollGranted";
      playerId: PlayerId;
      instanceId: string;
      kind: ScrollKind;
    }
  | {
      type: "scrollConsumed";
      playerId: PlayerId;
      instanceId: string;
      kind: ScrollKind;
    }
  | {
      type: "scrollTransferred";
      fromId: PlayerId;
      toId: PlayerId;
      instanceId: string;
      kind: ScrollKind;
    }
  | {
      type: "equipmentGranted";
      playerId: PlayerId;
      instanceId: string;
      kind: EquipmentKind;
    }
  | {
      type: "equipmentTransferred";
      fromId: PlayerId;
      toId: PlayerId;
      instanceId: string;
      kind: EquipmentKind;
    }
  | {
      type: "battleStarted";
      battleKind: BattleState["kind"];
      aPlayerId: PlayerId;
      bPlayerId?: PlayerId;
      enemyId?: string;
    }
  | {
      type: "initiativeRolled";
      rollA: number;
      rollB: number;
      firstAttacker: CombatSide;
    }
  | {
      type: "attackRolled";
      side: CombatSide;
      die: number;
      base: number;
      scrollBonus: number;
      total: number;
    }
  | {
      type: "defenseRolled";
      side: CombatSide;
      die: number;
      base: number;
      scrollBonus: number;
      total: number;
    }
  /** 战斗内临时生命值变化，PvP 时不代表真实生命值 */
  | {
      type: "battleDamage";
      targetSide: CombatSide;
      amount: number;
      hpBefore: number;
      hpAfter: number;
      hpMax: number;
    }
  | { type: "battleRoundAdvanced"; round: number; attacker: CombatSide }
  | {
      type: "battleEnded";
      battleKind: BattleState["kind"];
      outcome: "playerWon" | "playerLost" | "pvpDecided";
      winnerSide: CombatSide;
    }
  | { type: "gameOver"; winnerId: PlayerId };

type WithEventId<T> = T extends unknown ? T & { id: number } : never;

/**
 * 事件带上自增 id，既方便界面做 React key，也便于播放队列去重。
 *
 * 这里用分配式条件类型而不是直接写交叉，保证 GameEvent 展开后依然是联合类型，
 * 消费方才能用 `Extract<GameEvent, { type: "playerMoved" }>` 按事件种类收窄。
 */
export type GameEvent = WithEventId<GameEventBody>;

export interface GameState {
  players: Record<PlayerId, Player>;
  activePlayerId: PlayerId;
  startingPlayerId: PlayerId;
  turn: number;
  phase: GamePhase;
  rngSeed: number;
  nextInstanceId: number;
  lastMovementRoll?: number;
  message: string;
  history: string[];
  /** 仅包含最近一次 action 产生的事件，每次 action 开始时清空 */
  lastEvents: GameEvent[];
  nextEventId: number;
}

export type GameAction =
  | { type: "restart"; seed?: number }
  | { type: "rollMovement" }
  | { type: "endTurn" }
  | {
      type: "resolveBattleRound";
      attackScrollId?: string;
      defenseScrollId?: string;
    }
  | {
      type: "choosePvpPenalty";
      choice: "resource" | "hp";
      resourceType?: "scroll" | "equipment";
      instanceId?: string;
    };
