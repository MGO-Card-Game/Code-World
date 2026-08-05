import type { EquipmentKind } from "./content/equipment";
import type { ScrollKind } from "./content/scrolls";

export type { EquipmentKind, ScrollKind };

export type PlayerId = "player1" | "player2";

/**
 * 卷轴的使用时机（GameRule 8.9）。
 *
 * 决定一张牌归攻击方还是防守方打的是 timing，不是 kind——
 * 8.8 中力量/精准/狂暴属于 beforeAttackRoll，护盾/坚守/闪避属于
 * beforeDefenseRoll；D20 与巨龙打击同时支持两个时机。
 * 第一阶段只开放这两个时机。
 */
export type ScrollTiming = "beforeAttackRoll" | "beforeDefenseRoll";
export type TileType = "start" | "battle" | "treasure" | "spring" | "event" | "boss";
export type MapRegionId = "foothill" | "mountainside" | "summit";

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
  region: MapRegionId;
  type: TileType;
  label: string;
  enemyId?: string;
  safeZone?: boolean;
}

export interface MapRegion {
  id: MapRegionId;
  name: string;
  startIndex: number;
  endIndex: number;
}

/** 一局实际使用的地图。地图随状态广播，客户端不会各自重新随机。 */
export interface GameMap {
  seed: number;
  columns: number;
  regions: MapRegion[];
  tiles: MapTile[];
}

export type CombatSide = "a" | "b";

/**
 * 一侧在本次攻击回合的卷轴选择（GameRule 8.3）。
 *
 * 暗牌之下攻防双方在各自设备上独立决定，所以必须能区分
 * “还没提交”和“提交了但不使用”——前者要继续等，后者可以直接结算。
 *
 * submitted 是**只在视图里出现**的状态，引擎永远不会产生它：
 * viewFor 会把对手的 chosen / declined 一律折叠成 submitted。
 * 「选了哪张」和「到底选没选」都是情报，8.3 要求双方在互相不知情的
 * 前提下决定，所以对手那一侧只能透出“已提交”这一个事实。
 */
export type ScrollChoice =
  | { status: "pending" }
  | { status: "declined" }
  | { status: "chosen"; instanceId: string }
  | { status: "submitted" };

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
  /** 本回合双方的卷轴选择，两侧都非 pending 时才结算 */
  choiceA: ScrollChoice;
  choiceB: ScrollChoice;
}

export interface PvpPenaltyState {
  winnerId: PlayerId;
  loserId: PlayerId;
  tileIndex: number;
}

export interface EquipmentChoiceState {
  playerId: PlayerId;
  offered: OwnedEquipment;
  source: "reward" | "transfer";
  resume:
    | { kind: "turnComplete" }
    | { kind: "resolveTile"; tileIndex: number };
}

export type GamePhase =
  | { kind: "awaitingRoll" }
  | { kind: "turnComplete" }
  | { kind: "battle"; battle: BattleState }
  | { kind: "pvpPenalty"; penalty: PvpPenaltyState }
  | { kind: "equipmentChoice"; choice: EquipmentChoiceState }
  | { kind: "gameOver"; winnerId: PlayerId };

export type HpChangeReason =
  | "spring"
  | "event"
  | "equipment"
  | "defeatRecovery"
  | "pvpTransfer";

/**
 * 一条可按接收方裁剪的文案。
 *
 * 暗牌之下「打开宝箱，获得力量卷轴」这种句子会直接泄露手牌，
 * 所以带上 secret 的条目由 viewFor 按观看者替换成 publicText。
 * 只裁剪卷轴数组和事件是不够的——文案是最容易漏掉的泄露面。
 */
export interface LogEntry {
  text: string;
  secret?: { owner: PlayerId; publicText: string };
}

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
  | { type: "narration"; text: string; secret?: { owner: PlayerId; publicText: string } }
  | { type: "gameStarted"; starterId: PlayerId; rollP1: number; rollP2: number }
  | { type: "turnStarted"; playerId: PlayerId; turn: number }
  | { type: "movementRolled"; playerId: PlayerId; value: number; sides: number }
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
  /** kind 会被 viewFor 对非持有者裁掉，否则对手抽到什么会从动画事件泄露 */
  | {
      type: "scrollGranted";
      playerId: PlayerId;
      instanceId: string;
      kind?: ScrollKind;
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
      dice: number[];
      sides: number;
      base: number;
      scrollBonus: number;
      total: number;
    }
  | {
      type: "defenseRolled";
      side: CombatSide;
      die: number;
      dice: number[];
      sides: number;
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
  map: GameMap;
  activePlayerId: PlayerId;
  startingPlayerId: PlayerId;
  turn: number;
  phase: GamePhase;
  rngSeed: number;
  nextInstanceId: number;
  lastMovementRoll?: number;
  message: LogEntry;
  history: LogEntry[];
  /** 仅包含最近一次 action 产生的事件，每次 action 开始时清空 */
  lastEvents: GameEvent[];
  nextEventId: number;
}

export type GameAction =
  | { type: "restart"; seed?: number }
  | { type: "rollMovement" }
  | { type: "endTurn" }
  /**
   * 提交本侧的卷轴选择。省略 instanceId 表示不使用。
   * 两侧都提交后引擎自动结算本回合，取代原来的 resolveBattleRound。
   */
  | { type: "submitScrollChoice"; side: CombatSide; instanceId?: string }
  | {
      type: "choosePvpPenalty";
      choice: "resource" | "hp";
      resourceType?: "scroll" | "equipment";
      instanceId?: string;
    }
  /** 装备槽已满时，省略 replaceInstanceId 表示放弃新装备。 */
  | { type: "chooseEquipment"; replaceInstanceId?: string };

/**
 * 裁剪后的卷轴：对手只看得到牌背。
 *
 * 保留 instanceId 是有意的——界面用它做动画 key，牌背才能各自进出，
 * 而 instanceId 本身只暴露发牌顺序，不暴露牌面。
 */
export interface HiddenScroll {
  instanceId: string;
  hidden: true;
}

export type ScrollView = OwnedScroll | HiddenScroll;

/**
 * 玩家身上与手牌无关的部分。
 *
 * 属性计算和动画显示都用不到 scrolls，让它们接受这个类型，
 * Player 和 PlayerView 就能共用同一套函数，不必为暗牌视图另写一份。
 */
export type PlayerStats = Omit<Player, "scrolls">;

/** 玩家的可见视图，scrolls 可能是裁剪过的 */
export type PlayerView = PlayerStats & { scrolls: ScrollView[] };

/** 发给某一名玩家的状态视图 */
export type GameStateView = Omit<GameState, "players"> & {
  players: Record<PlayerId, PlayerView>;
};
