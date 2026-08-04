export type PlayerId = "player1" | "player2";
export type ScrollKind = "might" | "guard";
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
