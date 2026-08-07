import { SCROLLS } from "./content/scrolls";
import type {
  CombatSide,
  GameAction,
  GameEvent,
  GamePhase,
  GameState,
  GameStateView,
  LogEntry,
  PlayerId,
  PlayerView,
  ScrollChoice,
  ScrollView,
} from "./types";

/**
 * 联机所需的两个原语：谁能做什么，以及每个人能看到什么。
 *
 * 都是纯函数、与传输层无关，因此可以完全脱离网络单元测试。
 * 服务器在应用 action 前调 canAct，广播前对每个接收方调 viewFor。
 */

export function isHiddenScroll(scroll: ScrollView): scroll is { instanceId: string; hidden: true } {
  return "hidden" in scroll;
}

/**
 * 该玩家此刻是否有权执行这个动作。
 *
 * 注意几个不能想当然的地方：
 * - choosePvpPenalty 是**败方**做的，不是当前行动方
 * - submitScrollChoice 只能提交自己那一侧，且只能提交一次
 * - restart 任何人都可以发起（重开是双方共识，不设归属）
 */
export function canAct(state: GameState, action: GameAction, actor: PlayerId): boolean {
  switch (action.type) {
    case "restart":
      return true;

    case "rollMovement":
      return state.phase.kind === "awaitingRoll" && state.activePlayerId === actor;

    case "useMapScroll":
      return (
        (state.phase.kind === "awaitingRoll" || state.phase.kind === "turnComplete") &&
        state.activePlayerId === actor
      );

    case "endTurn":
      return state.phase.kind === "turnComplete" && state.activePlayerId === actor;

    case "chooseEncounterOpponent":
      return (
        state.phase.kind === "encounterChoice" &&
        state.phase.choice.challengerId === actor
      );

    case "chooseBossChallenge":
      return (
        state.phase.kind === "bossGateChoice" &&
        state.phase.choice.playerId === actor
      );

    case "chooseBlessing":
      return (
        state.phase.kind === "blessingChoice" &&
        state.phase.choice.winnerId === actor
      );

    case "acknowledgePveReward":
      return (
        state.phase.kind === "pveReward" &&
        state.phase.notice.playerId === actor
      );

    case "choosePvpPenalty":
      return (
        state.phase.kind === "pvpPenalty" &&
        !state.phase.penalty.waived &&
        state.phase.penalty.loserId === actor
      );

    case "chooseEquipment":
      return state.phase.kind === "equipmentChoice" && state.phase.choice.playerId === actor;

    case "submitScrollChoice": {
      if (state.phase.kind !== "battle") return false;
      const battle = state.phase.battle;
      const sideOwner = action.side === "a" ? battle.aPlayerId : battle.bPlayerId;
      if (sideOwner !== actor) return false;
      const choice = action.side === "a" ? battle.choiceA : battle.choiceB;
      return choice.status === "pending";
    }
  }
}

function redactScrolls(player: PlayerView["scrolls"], hide: boolean): ScrollView[] {
  if (!hide) return player;
  return player.map((scroll) => ({ instanceId: scroll.instanceId, hidden: true as const }));
}

function redactLogEntry(entry: LogEntry, viewer: PlayerId): LogEntry {
  if (!entry.secret || entry.secret.owner === viewer) return { text: entry.text };
  return { text: entry.secret.publicText };
}

function redactEvent(event: GameEvent, viewer: PlayerId): GameEvent {
  switch (event.type) {
    case "narration":
      if (!event.secret || event.secret.owner === viewer) {
        return { id: event.id, type: "narration", text: event.text };
      }
      return { id: event.id, type: "narration", text: event.secret.publicText };

    // 抽到的牌只有持有者知道；已经打出的牌（scrollConsumed）是公开信息，
    // 因为加值会直接体现在攻防合计里，藏也藏不住
    case "scrollGranted":
      if (event.playerId === viewer) return event;
      return { id: event.id, type: "scrollGranted", playerId: event.playerId, instanceId: event.instanceId };

    default:
      return event;
  }
}

/**
 * 折叠对手一侧的卷轴选择。
 *
 * pending 保留原样——知道对方还没决定是必要的，界面要据此显示等待状态。
 * 但 chosen 和 declined 都必须折叠成 submitted：8.3 要求双方在互相不知情
 * 的前提下决定，「对方选了某张牌」和「对方决定不用牌」同样是情报。
 *
 * 敌人一侧（无归属玩家）不需要折叠，它的放弃是规则决定的公开事实（8.6）。
 */
function redactChoice(
  choice: ScrollChoice,
  sideOwner: PlayerId | undefined,
  viewer: PlayerId,
): ScrollChoice {
  if (!sideOwner || sideOwner === viewer) return choice;
  if (choice.status === "pending") return choice;
  return { status: "submitted" };
}

function redactPhase(phase: GamePhase, viewer: PlayerId): GamePhase {
  const redactRewardNotice = (
    notice: Extract<GamePhase, { kind: "pveReward" }>["notice"],
  ) => notice.playerId === viewer
    ? notice
    : {
        ...notice,
        rewards: notice.rewards.map((reward) => ({
          ...reward,
          name: reward.publicName,
        })),
      };

  switch (phase.kind) {
    case "battle": {
      const battle = phase.battle;
      return {
        kind: "battle",
        battle: {
          ...battle,
          choiceA: redactChoice(battle.choiceA, battle.aPlayerId, viewer),
          choiceB: redactChoice(battle.choiceB, battle.bPlayerId, viewer),
        },
      };
    }
    case "pveReward":
      return { kind: "pveReward", notice: redactRewardNotice(phase.notice) };
    case "equipmentChoice":
      return phase.choice.resume.kind === "showPveReward"
        ? {
            kind: "equipmentChoice",
            choice: {
              ...phase.choice,
              resume: {
                kind: "showPveReward",
                notice: redactRewardNotice(phase.choice.resume.notice),
              },
            },
          }
        : phase;
    default:
      return phase;
  }
}

/**
 * 裁剪出发给某位玩家的状态视图。
 *
 * 四处泄露面都要处理：手牌数组、事件流、文案、以及本回合待结算的卷轴选择。
 * 少裁任何一处，暗牌都等于白做——比如漏掉文案的话，
 * 「打开宝箱，获得力量卷轴」这一句会直接把牌名送出去。
 */
export function viewFor(state: GameState, viewer: PlayerId): GameStateView {
  const players: Record<string, PlayerView> = {};
  for (const id of state.turnOrder) {
    const player = state.players[id];
    players[id] = {
      ...player,
      scrolls: redactScrolls(player.scrolls, id !== viewer),
    };
  }

  return {
    ...state,
    players,
    phase: redactPhase(state.phase, viewer),
    message: redactLogEntry(state.message, viewer),
    history: state.history.map((entry) => redactLogEntry(entry, viewer)),
    lastEvents: state.lastEvents.map((event) => redactEvent(event, viewer)),
  };
}

/**
 * 此刻该由谁操作。
 *
 * 联机时观看者由座位决定，用不上这个；本地热座才需要——
 * 暗牌之下屏幕只能显示"当前该操作的人"的手牌，传设备时才不会看到对方的牌。
 * 注意战斗中该操作的人未必是 activePlayerId（防守方也要选牌），
 * 相遇战代价更是由败方来付。
 */
export function currentActor(state: GameState): PlayerId {
  switch (state.phase.kind) {
    case "encounterChoice":
      return state.phase.choice.challengerId;
    case "bossGateChoice":
      return state.phase.choice.playerId;
    case "blessingChoice":
      return state.phase.choice.winnerId;
    case "pvpPenalty":
      return state.phase.penalty.loserId;
    case "equipmentChoice":
      return state.phase.choice.playerId;
    case "pveReward":
      return state.phase.notice.playerId;
    case "battle": {
      const battle = state.phase.battle;
      const attacker = battle.attacker;
      const defender: CombatSide = attacker === "a" ? "b" : "a";
      for (const side of [attacker, defender]) {
        const choice = side === "a" ? battle.choiceA : battle.choiceB;
        const owner = side === "a" ? battle.aPlayerId : battle.bPlayerId;
        if (owner && choice.status === "pending") return owner;
      }
      return battle.aPlayerId;
    }
    default:
      return state.activePlayerId;
  }
}

/**
 * 视图里能读到的卷轴张数——对手的手牌虽然看不见牌面，张数是公开的。
 * 规格 25.2 要求侧栏显示的正是这个数字。
 */
export function visibleScrollCount(player: PlayerView) {
  return player.scrolls.length;
}

/** 视图里这张牌的名称，看不见时返回 undefined */
export function scrollName(scroll: ScrollView) {
  return isHiddenScroll(scroll) ? undefined : SCROLLS[scroll.kind].name;
}
