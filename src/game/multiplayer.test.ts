import { describe, expect, it } from "vitest";
import { createInitialGame, gameReducer } from "./engine";
import { canAct, isHiddenScroll, viewFor } from "./multiplayer";
import { pvpHpTransferAmount } from "./selectors";
import {
  makeBattle,
  PLAYTHROUGH_CAP,
  PLAYTHROUGH_SEED,
  resolveRound,
} from "./testSupport";
import type { GameState, PlayerId } from "./types";

function withBattle(seed = 20260805): GameState {
  const state = createInitialGame(seed);
  state.activePlayerId = "player1";
  state.phase = {
    kind: "battle",
    battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
  };
  return state;
}

/** 把一个视图里所有字符串收集起来，用于检查有没有泄露 */
function allText(value: unknown): string {
  return JSON.stringify(value);
}

describe("动作授权 canAct", () => {
  it("只有当前行动方能投骰和结束回合", () => {
    const state = createInitialGame(20260805);
    const active = state.activePlayerId;
    const idle: PlayerId = active === "player1" ? "player2" : "player1";

    expect(canAct(state, { type: "rollMovement" }, active)).toBe(true);
    expect(canAct(state, { type: "rollMovement" }, idle)).toBe(false);

    const moved = gameReducer(state, { type: "rollMovement" });
    if (moved.phase.kind === "turnComplete") {
      expect(canAct(moved, { type: "endTurn" }, active)).toBe(true);
      expect(canAct(moved, { type: "endTurn" }, idle)).toBe(false);
    }
  });

  it("阶段不对时一律拒绝", () => {
    const state = createInitialGame(20260805);
    // 开局是 awaitingRoll，endTurn 不该被允许
    expect(canAct(state, { type: "endTurn" }, state.activePlayerId)).toBe(false);
  });

  it("相遇战代价由败方选择，不是当前行动方", () => {
    const state = createInitialGame(20260805);
    state.activePlayerId = "player1";
    state.phase = {
      kind: "pvpPenalty",
      penalty: { winnerId: "player1", loserId: "player2", tileIndex: 5 },
    };

    const penalty = { type: "choosePvpPenalty", choice: "hp" } as const;
    expect(canAct(state, penalty, "player2")).toBe(true);
    // 当前行动方是 player1，但代价该由败方 player2 付
    expect(canAct(state, penalty, "player1")).toBe(false);
  });

  it("装备替换只能由获得装备的玩家决定", () => {
    const state = createInitialGame(20260805);
    state.phase = {
      kind: "equipmentChoice",
      choice: {
        playerId: "player2",
        offered: { instanceId: "new-armor", kind: "borderLeather" },
        source: "reward",
        resume: { kind: "turnComplete" },
      },
    };

    expect(canAct(state, { type: "chooseEquipment" }, "player2")).toBe(true);
    expect(canAct(state, { type: "chooseEquipment" }, "player1")).toBe(false);
  });

  it("只能提交自己那一侧的卷轴选择", () => {
    const state = withBattle();

    expect(canAct(state, { type: "submitScrollChoice", side: "a" }, "player1")).toBe(true);
    expect(canAct(state, { type: "submitScrollChoice", side: "a" }, "player2")).toBe(false);
    expect(canAct(state, { type: "submitScrollChoice", side: "b" }, "player2")).toBe(true);
    expect(canAct(state, { type: "submitScrollChoice", side: "b" }, "player1")).toBe(false);
  });

  it("同一侧不能重复提交", () => {
    let state = withBattle();
    state = gameReducer(state, { type: "submitScrollChoice", side: "a" });

    expect(canAct(state, { type: "submitScrollChoice", side: "a" }, "player1")).toBe(false);
    expect(canAct(state, { type: "submitScrollChoice", side: "b" }, "player2")).toBe(true);
  });

  it("重开局不限归属", () => {
    const state = createInitialGame(20260805);
    expect(canAct(state, { type: "restart" }, "player1")).toBe(true);
    expect(canAct(state, { type: "restart" }, "player2")).toBe(true);
  });
});

describe("战斗回合拆分", () => {
  it("单侧提交不结算，两侧齐了才结算", () => {
    let state = withBattle();
    const round = state.phase.kind === "battle" ? state.phase.battle.round : 0;

    state = gameReducer(state, { type: "submitScrollChoice", side: "a" });
    expect(state.phase.kind).toBe("battle");
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    // 还在等对方，回合没有推进，也没有掷骰
    expect(state.phase.battle.round).toBe(round);
    expect(state.lastEvents.filter((e) => e.type === "attackRolled")).toHaveLength(0);

    state = gameReducer(state, { type: "submitScrollChoice", side: "b" });
    expect(state.lastEvents.filter((e) => e.type === "attackRolled")).toHaveLength(1);
  });

  it("PvE 中敌人一侧自动视为已提交，玩家一提交就结算", () => {
    let state = createInitialGame(4242);
    state.phase = {
      kind: "battle",
      battle: makeBattle({ kind: "pve", aPlayerId: "player1", enemyId: "slime", hpB: 8 }),
    };
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    expect(state.phase.battle.choiceB.status).toBe("declined");

    state = gameReducer(state, { type: "submitScrollChoice", side: "a" });
    expect(state.lastEvents.filter((e) => e.type === "attackRolled")).toHaveLength(1);
  });

  it("新回合开始时重置双方选择", () => {
    let state = withBattle();
    state = resolveRound(state);
    if (state.phase.kind !== "battle") throw new Error("战斗提前结束，请换个种子");

    expect(state.phase.battle.choiceA.status).toBe("pending");
    expect(state.phase.battle.choiceB.status).toBe("pending");
  });

  it("拒绝提交手上没有的牌，以及时机不对的牌", () => {
    let state = withBattle();
    state.players.player1.scrolls = [{ instanceId: "guard-1", kind: "guard" }];

    // player1 是攻击方，护盾卷轴时机不对
    state = gameReducer(state, { type: "submitScrollChoice", side: "a", instanceId: "guard-1" });
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    expect(state.phase.battle.choiceA.status).toBe("pending");

    // 手上根本没有的牌
    state = gameReducer(state, { type: "submitScrollChoice", side: "a", instanceId: "ghost" });
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    expect(state.phase.battle.choiceA.status).toBe("pending");
  });
});

describe("暗牌裁剪 viewFor", () => {
  it("自己的手牌看得见牌面，对手的只剩牌背", () => {
    const state = createInitialGame(20260805);
    state.players.player1.scrolls = [{ instanceId: "s1", kind: "might" }];
    state.players.player2.scrolls = [{ instanceId: "s2", kind: "guard" }];

    const view = viewFor(state, "player1");

    const own = view.players.player1.scrolls[0];
    const foe = view.players.player2.scrolls[0];
    expect(isHiddenScroll(own)).toBe(false);
    expect(isHiddenScroll(foe)).toBe(true);
    expect(foe.instanceId).toBe("s2"); // 保留 id，界面才能给牌背做动画
  });

  it("张数是公开的", () => {
    const state = createInitialGame(20260805);
    state.players.player2.scrolls = [
      { instanceId: "s1", kind: "might" },
      { instanceId: "s2", kind: "guard" },
    ];

    expect(viewFor(state, "player1").players.player2.scrolls).toHaveLength(2);
  });

  it("装备始终公开", () => {
    const state = createInitialGame(20260805);
    state.players.player2.equipment = [{ instanceId: "e1", kind: "sword" }];

    expect(viewFor(state, "player1").players.player2.equipment).toEqual([
      { instanceId: "e1", kind: "sword" },
    ]);
  });

  it("抽卡事件对旁观者裁掉牌面", () => {
    const state = createInitialGame(20260805);
    state.lastEvents = [
      { id: 1, type: "scrollGranted", playerId: "player2", instanceId: "s9", kind: "might" },
    ];

    const owner = viewFor(state, "player2").lastEvents[0];
    const other = viewFor(state, "player1").lastEvents[0];

    expect(owner.type === "scrollGranted" && owner.kind).toBe("might");
    expect(other.type === "scrollGranted" && other.kind).toBeUndefined();
    expect(other.type === "scrollGranted" && other.instanceId).toBe("s9");
  });

  it("旁白与历史记录也要裁，否则裁手牌等于白做", () => {
    const state = createInitialGame(20260805);
    const secret = { owner: "player2" as PlayerId, publicText: "苍潮旅者打开宝箱，获得一张卷轴。" };
    state.message = { text: "苍潮旅者打开宝箱，获得力量卷轴。", secret };
    state.history = [state.message];
    state.lastEvents = [
      { id: 1, type: "narration", text: "苍潮旅者打开宝箱，获得力量卷轴。", secret },
    ];

    const own = viewFor(state, "player2");
    expect(own.message.text).toContain("力量卷轴");
    expect(own.history[0].text).toContain("力量卷轴");

    const foe = viewFor(state, "player1");
    expect(foe.message.text).toBe(secret.publicText);
    expect(foe.history[0].text).toBe(secret.publicText);
    expect(foe.lastEvents[0].type === "narration" && foe.lastEvents[0].text).toBe(secret.publicText);
  });

  it("对手已提交的卷轴选择不能泄露内容", () => {
    // GameRule 8.3：必须在看不到信息的前提下决定是否使用卷轴。
    // 若对手选了哪张牌（甚至只是"选了/没选"）先一步可见，这条规则就废了。
    let state = withBattle();
    state.players.player1.scrolls = [{ instanceId: "atk-1", kind: "might" }];
    state = gameReducer(state, {
      type: "submitScrollChoice",
      side: "a",
      instanceId: "atk-1",
    });

    const foe = viewFor(state, "player2");
    if (foe.phase.kind !== "battle") throw new Error("unreachable");

    // 对手只该知道"已提交"，不该知道提交了什么
    expect(foe.phase.battle.choiceA.status).toBe("submitted");
    expect(JSON.stringify(foe.phase.battle.choiceA)).not.toContain("atk-1");
    // 自己那一侧还没提交，状态照常可见
    expect(foe.phase.battle.choiceB.status).toBe("pending");

    // 提交方自己看得到完整选择
    const own = viewFor(state, "player1");
    if (own.phase.kind !== "battle") throw new Error("unreachable");
    expect(own.phase.battle.choiceA).toEqual({ status: "chosen", instanceId: "atk-1" });
  });

  it("对手选择不使用卷轴，同样只显示已提交", () => {
    // "没用牌"本身也是情报，不能提前让对方知道
    let state = withBattle();
    state = gameReducer(state, { type: "submitScrollChoice", side: "a" });

    const foe = viewFor(state, "player2");
    if (foe.phase.kind !== "battle") throw new Error("unreachable");
    expect(foe.phase.battle.choiceA.status).toBe("submitted");
  });

  it("PvE 中敌人一侧的自动放弃是公开的", () => {
    // 敌人不使用卷轴是规则（8.6），没有隐藏的必要
    const state = createInitialGame(4242);
    state.phase = {
      kind: "battle",
      battle: makeBattle({ kind: "pve", aPlayerId: "player1", enemyId: "slime", hpB: 8 }),
    };

    const view = viewFor(state, "player2");
    if (view.phase.kind !== "battle") throw new Error("unreachable");
    expect(view.phase.battle.choiceB.status).toBe("declined");
  });

  it("整局跑下来，属于对手的机密文案一条都不外泄", () => {
    let state = createInitialGame(PLAYTHROUGH_SEED);
    let checkedSecrets = 0;

    for (let step = 0; step < PLAYTHROUGH_CAP && state.phase.kind !== "gameOver"; step += 1) {
      switch (state.phase.kind) {
        case "awaitingRoll": state = gameReducer(state, { type: "rollMovement" }); break;
        case "turnComplete": state = gameReducer(state, { type: "endTurn" }); break;
        case "battle": {
          const battle = state.phase.battle;
          const attackerId = battle.attacker === "a"
            ? battle.aPlayerId
            : battle.bPlayerId;
          const defenderId = battle.attacker === "a"
            ? battle.bPlayerId
            : battle.aPlayerId;
          const attack = attackerId
            ? state.players[attackerId].scrolls.find((item) =>
                ["dragonStrike", "loadedDicePool", "might"].includes(item.kind)
              )?.instanceId
            : undefined;
          const defense = defenderId
            ? state.players[defenderId].scrolls.find((item) => item.kind === "guard")?.instanceId
            : undefined;
          state = resolveRound(state, { attack, defense });
          break;
        }
        case "pvpPenalty": {
          const { winnerId, loserId } = state.phase.penalty;
          const winner = state.players[winnerId];
          const loser = state.players[loserId];
          const canPayHp = pvpHpTransferAmount(winner, loser) > 0;
          const scroll = loser.scrolls[0];
          const equipment = loser.equipment[0];
          state = canPayHp
            ? gameReducer(state, { type: "choosePvpPenalty", choice: "hp" })
            : scroll
              ? gameReducer(state, {
                  type: "choosePvpPenalty",
                  choice: "resource",
                  resourceType: "scroll",
                  instanceId: scroll.instanceId,
                })
              : equipment
                ? gameReducer(state, {
                    type: "choosePvpPenalty",
                    choice: "resource",
                    resourceType: "equipment",
                    instanceId: equipment.instanceId,
                  })
                // 后退永远付得出，兜底选它，整局才不会卡在代价阶段
                : gameReducer(state, { type: "choosePvpPenalty", choice: "retreat" });
          break;
        }
        case "equipmentChoice":
          state = gameReducer(state, { type: "chooseEquipment" });
          break;
        default: break;
      }

      for (const viewer of ["player1", "player2"] as PlayerId[]) {
        const opponent: PlayerId = viewer === "player1" ? "player2" : "player1";
        const view = viewFor(state, viewer);

        // 对手手上每一张牌都必须是牌背
        for (const scroll of view.players[opponent].scrolls) {
          expect(isHiddenScroll(scroll)).toBe(true);
        }

        // 凡是标了机密且不属于观看者的文案，视图里必须换成公开说法
        const raw = [state.message, ...state.history];
        const shown = [view.message, ...view.history];
        raw.forEach((entry, index) => {
          if (!entry.secret) return;
          if (entry.secret.owner === viewer) {
            expect(shown[index].text).toBe(entry.text);
          } else {
            expect(shown[index].text).toBe(entry.secret.publicText);
            expect(shown[index].text).not.toBe(entry.text);
            checkedSecrets += 1;
          }
        });

        // 裁剪后的载荷里不能再残留原文，否则客户端可以自己还原
        expect(allText(shown)).not.toContain("secret");
        for (const event of view.lastEvents) {
          if (event.type === "narration") expect("secret" in event).toBe(false);
          if (event.type === "scrollGranted" && event.playerId === opponent) {
            expect(event.kind).toBeUndefined();
          }
        }
      }
    }

    expect(state.phase.kind).toBe("gameOver");
    // 确认这一局确实产生过需要保密的文案，否则断言等于没跑
    expect(checkedSecrets).toBeGreaterThan(0);
  });
});
