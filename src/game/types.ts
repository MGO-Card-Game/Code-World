import type { EliteAffixKind, EnemyKind } from "./content/enemies";
import type { EquipmentKind } from "./content/equipment";
import type { ScrollKind } from "./content/scrolls";
import type { BlessingKind } from "./content/blessings";

export type { BlessingKind, EliteAffixKind, EnemyKind, EquipmentKind, ScrollKind };

export type PlayerId = "player1" | "player2" | "player3" | "player4";

/**
 * 卷轴的使用时机（GameRule 8.9）。
 *
 * 决定一张牌归攻击方还是防守方打的是 timing，不是 kind——
 * 8.8 中力量/精准/狂暴属于 beforeAttackRoll，护盾/坚守/闪避属于
 * beforeDefenseRoll；D20 与巨龙打击同时支持两个时机。
 * 疗牌额外开放地图阶段；在战斗中仍复用攻、防两种选牌时机。
 */
export type ScrollTiming = "map" | "beforeAttackRoll" | "beforeDefenseRoll";
export type TileType =
  | "start"
  | "battle"
  | "elite"
  | "treasure"
  | "blessing"
  | "spring"
  | "event"
  | "gate"
  | "boss";

/** 会打起来的格子。三处判定（结算、地图约束、界面）共用，免得各写一份对不上。 */
export const COMBAT_TILE_TYPES = ["battle", "elite"] as const satisfies readonly TileType[];

export function isCombatTile(type: TileType) {
  return (COMBAT_TILE_TYPES as readonly TileType[]).includes(type);
}
export type MapRegionId = "foothill" | "mountainside" | "summit";

export type StageRequirement = {
  type: "uniqueEliteVictories";
  target: number;
  label: string;
};

export interface StageProgress {
  laps: number;
  defeatedEliteTileIds: number[];
  openedTreasureTileIds: number[];
  bossDefeated: boolean;
}

export interface OwnedScroll {
  instanceId: string;
  kind: ScrollKind;
  /**
   * 战斗开始时由装备临时发放的牌，战斗结束时统一回收。
   *
   * 回收必须发生在相遇战代价阶段**之前**，否则败方可以把这张本不属于他的
   * 临时牌交给赢家，凭空变成一张常驻卡。
   */
  temporary?: true;
}

export interface OwnedEquipment {
  instanceId: string;
  kind: EquipmentKind;
  /**
   * 这一件装备的战斗内暗格，供「和上一回合比较」这类跨回合效果使用。
   *
   * 只能存数字：它要跟着 GameState 一起 structuredClone、JSON 广播，
   * 还要在同种子重放里逐位复现。存的内容也不能是暗牌情报——它随装备一起公开，
   * 目前两把剑记的都是已经由 attackRolled 公开过的骰点。
   *
   * 生命周期由引擎保证：finishBattle 开头统一清空，卡牌不必自己收尾。
   * 交给每张卡在 onBattleStart 自己清的话，漏清不会报错，只会让效果在下一场
   * 的第一轮偷偷多触发一次。
   */
  battleMemo?: number;
}

/** 赐福在持有期间永久生效；每名玩家的数组长度由引擎限制为至多一个。 */
export interface OwnedBlessing {
  instanceId: string;
  kind: BlessingKind;
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
  /** PvE 与阶段 Boss 战败时返回的本阶段检查点。 */
  checkpointTileId: number;
  /** 三个阶段各自独立的环数、目标和一次性格子状态。 */
  stageProgress: Record<MapRegionId, StageProgress>;
  /** 战斗中使用战地药剂后，下一次自己的地图行动会失去移动机会。 */
  skipNextMovement?: true;
  scrolls: OwnedScroll[];
  equipment: OwnedEquipment[];
  blessings: OwnedBlessing[];
}

export interface MapTile {
  id: number;
  region: MapRegionId;
  type: TileType;
  label: string;
  enemyId?: EnemyKind;
  /**
   * 精英格上贴的词缀。地图生成时就定死并随 GameState 广播——
   * 交给战斗开始时再抽的话，同种子重放和联机双端就对不上了。
   */
  eliteAffix?: EliteAffixKind;
  safeZone?: boolean;
}

export interface MapRegion {
  id: MapRegionId;
  name: string;
  startIndex: number;
  endIndex: number;
  gateIndex: number;
  entryIndex: number;
  bossEnemyId: EnemyKind;
  requirements: StageRequirement[];
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
  | { status: "chosen"; instanceIds: string[] }
  | { status: "submitted" };

export interface BattleState {
  kind: "pve" | "boss" | "pvp";
  aPlayerId: PlayerId;
  bPlayerId?: PlayerId;
  enemyId?: EnemyKind;
  enemyAffix?: EliteAffixKind;
  stageId?: MapRegionId;
  tileIndex?: number;
  /** PvE 战败时返回的休整点；开战时按本次移动前的位置锁定。 */
  retreatTo?: number;
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
  /** 不屈意志已支付真实生命，或当前无可支付项；正常惩罚应由引擎直接跳过。 */
  waived?: true;
  waiveReason?: "unyieldingWill" | "noPayable";
}

/** 移动结束时同格有多名对手，由本回合行动者选择本次只挑战其中一人。 */
export interface EncounterChoiceState {
  challengerId: PlayerId;
  opponentIds: PlayerId[];
  tileIndex: number;
}

export interface BossGateChoiceState {
  playerId: PlayerId;
  stageId: MapRegionId;
  gateTileIndex: number;
  bossEnemyId: EnemyKind;
}

/** 赢家已有赐福时，决定是否用败方的赐福覆盖自己当前持有的一个。 */
export interface BlessingChoiceState {
  winnerId: PlayerId;
  loserId: PlayerId;
  offered: OwnedBlessing;
  tileIndex: number;
  penaltyWaived?: true;
  penaltyWaiveReason?: "unyieldingWill" | "noPayable";
}

export type PveRewardSource = "battle" | "elite" | "blessing";

/** PvE 胜利弹层中的一项奖励；卷轴同时保存私密名称和旁观者可见名称。 */
export interface PveRewardItem {
  source: PveRewardSource;
  resourceType: "scroll" | "equipment";
  name: string;
  publicName: string;
}

/** 战斗奖励必须由获奖玩家确认，保证日志之外还有不会一闪而过的醒目反馈。 */
export interface PveRewardNoticeState {
  playerId: PlayerId;
  enemyName: string;
  elite: boolean;
  rewards: PveRewardItem[];
}

export interface EquipmentChoiceState {
  playerId: PlayerId;
  offered: OwnedEquipment;
  source: "reward" | "transfer";
  resume:
    | { kind: "turnComplete" }
    | { kind: "resolveTile"; tileIndex: number }
    | { kind: "grantTreasureEquipment"; remaining: number }
    | { kind: "showPveReward"; notice: PveRewardNoticeState };
}

export type GamePhase =
  | { kind: "awaitingRoll" }
  | { kind: "turnComplete" }
  | { kind: "encounterChoice"; choice: EncounterChoiceState }
  | { kind: "bossGateChoice"; choice: BossGateChoiceState }
  | { kind: "battle"; battle: BattleState }
  | { kind: "blessingChoice"; choice: BlessingChoiceState }
  | { kind: "pvpPenalty"; penalty: PvpPenaltyState }
  | { kind: "equipmentChoice"; choice: EquipmentChoiceState }
  | { kind: "pveReward"; notice: PveRewardNoticeState }
  | { kind: "gameOver"; winnerId: PlayerId };

export type HpChangeReason =
  | "spring"
  | "event"
  | "equipment"
  | "blessing"
  | "scroll"
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
  | {
      type: "gameStarted";
      starterId: PlayerId;
      rolls: Partial<Record<PlayerId, number>>;
      turnOrder: PlayerId[];
    }
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
  | {
      type: "baseStatChanged";
      playerId: PlayerId;
      stat: "attack" | "defense";
      from: number;
      to: number;
    }
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
      type: "blessingGranted";
      playerId: PlayerId;
      instanceId: string;
      kind: BlessingKind;
    }
  | {
      type: "blessingTransferred";
      fromId: PlayerId;
      toId: PlayerId;
      instanceId: string;
      kind: BlessingKind;
    }
  | {
      type: "battleStarted";
      battleKind: BattleState["kind"];
      aPlayerId: PlayerId;
      bPlayerId?: PlayerId;
      enemyId?: EnemyKind;
      enemyAffix?: EliteAffixKind;
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
      flatBonus: number;
      total: number;
    }
  | {
      type: "defenseRolled";
      side: CombatSide;
      die: number;
      dice: number[];
      sides: number;
      base: number;
      flatBonus: number;
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
  /** 战斗内治疗；和 battleDamage 一样，PvP 时只改变临时战斗生命。 */
  | {
      type: "battleHealed";
      targetSide: CombatSide;
      amount: number;
      hpBefore: number;
      hpAfter: number;
      hpMax: number;
    }
  /** fromRound / fromAttacker 供界面在动画播到之前按住上一轮的攻防归属 */
  | {
      type: "battleRoundAdvanced";
      round: number;
      attacker: CombatSide;
      fromRound: number;
      fromAttacker: CombatSide;
    }
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
  /** 只包含本局实际入座的玩家；顺序由 turnOrder 定义。 */
  players: Record<string, Player>;
  turnOrder: PlayerId[];
  /** 联机掉线席位；本地模式恒为空。不会成为新的相遇战目标或后续回合行动者。 */
  unavailablePlayerIds: PlayerId[];
  map: GameMap;
  activePlayerId: PlayerId;
  startingPlayerId: PlayerId;
  turn: number;
  phase: GamePhase;
  rngSeed: number;
  nextInstanceId: number;
  lastMovementRoll?: number;
  /** 当前回合掷骰移动前的位置，用来锁定随后 PvE 战败的检查点回退。 */
  movementOrigin?: number;
  message: LogEntry;
  history: LogEntry[];
  /** 仅包含最近一次 action 产生的事件，每次 action 开始时清空 */
  lastEvents: GameEvent[];
  nextEventId: number;
}

export type GameAction =
  | { type: "restart"; seed?: number }
  | { type: "rollMovement" }
  | { type: "useMapScroll"; instanceId: string }
  | { type: "endTurn" }
  | { type: "chooseEncounterOpponent"; opponentId: PlayerId }
  | { type: "chooseBossChallenge"; challenge: boolean }
  | { type: "chooseBlessing"; replace: boolean }
  | { type: "acknowledgePveReward" }
  /**
   * 提交本侧本回合要打的全部卷轴（GameRule 8.5，张数不限）。
   * 省略或传空数组表示不使用。两侧都提交后引擎自动结算本回合。
   *
   * 数组顺序即结算顺序。绝大多数效果的合并规则与顺序无关（见 RollModifiers），
   * 只有 directDamage 和 custom 这类带副作用的效果会受顺序影响。
   */
  | { type: "submitScrollChoice"; side: CombatSide; instanceIds?: readonly string[] }
  /**
   * 支付相遇战代价：resource 交一张卷轴或装备，hp 转移真实生命。
   * 两项都无法支付时直接免除代价；经济系统加入后会改为金币转移。
   */
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
  players: Record<string, PlayerView>;
};
