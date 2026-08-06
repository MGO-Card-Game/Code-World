import { describe, expect, it } from "vitest";
import { createInitialGame, gameReducer, PVP_RETREAT_TILES } from "./engine";
import { pvpHpTransferAmount } from "./selectors";
import { makeBattle, resolveRound } from "./testSupport";
import type { GameState } from "./types";

/**
 * 造一场 a 侧稳赢的相遇战：b 侧只剩 1 点战斗生命，a 侧攻击拉满。
 * 结算完就会进入代价阶段（或者按规则直接后退）。
 */
function decidedPvp(seed: number, setup: (state: GameState) => void): GameState {
  const state = createInitialGame(seed);
  state.players.player1.baseAttack = 99;
  state.players.player2.baseDefense = 0;
  setup(state);
  state.phase = {
    kind: "battle",
    battle: makeBattle({
      kind: "pvp",
      aPlayerId: "player1",
      bPlayerId: "player2",
      hpB: 1,
    }),
  };
  return resolveRound(state);
}

describe("可转移生命的计算", () => {
  const stats = (hp: number, maxHp: number) => ({ hp, maxHp });

  it("上限 3 点，受赢家缺的血和败方剩的血双重限制", () => {
    expect(pvpHpTransferAmount(stats(10, 18), stats(10, 18))).toBe(3);
    // 赢家只缺 2 点，转不满 3
    expect(pvpHpTransferAmount(stats(16, 18), stats(10, 18))).toBe(2);
    // 败方只剩 2 点，最多交 1（代价不能把人打死）
    expect(pvpHpTransferAmount(stats(10, 18), stats(2, 18))).toBe(1);
  });

  it("付不出时返回 0，不返回负数", () => {
    // 赢家满血
    expect(pvpHpTransferAmount(stats(18, 18), stats(10, 18))).toBe(0);
    // 败方只剩 1 点
    expect(pvpHpTransferAmount(stats(10, 18), stats(1, 18))).toBe(0);
    // 两者同时成立，朴素写法会算出负数
    expect(pvpHpTransferAmount(stats(18, 18), stats(1, 18))).toBe(0);
  });
});

describe("相遇战代价阶段", () => {
  it("一无所有也照样进代价阶段，后退就是那条永远付得出的路", () => {
    // 旧规则在这里会绕过代价阶段自动后退 3 格；现在后退是三个选项之一
    let state = decidedPvp(20260805, (draft) => {
      // 赢家满血 → 转不了生命；败方两手空空 → 没有资源可交
      draft.players.player1.hp = draft.players.player1.maxHp;
      draft.players.player2.scrolls = [];
      draft.players.player2.equipment = [];
      draft.players.player2.position = 20;
    });
    expect(state.phase.kind).toBe("pvpPenalty");

    state = gameReducer(state, { type: "choosePvpPenalty", choice: "retreat" });

    expect(state.players.player2.position).toBe(20 - PVP_RETREAT_TILES);
    expect(state.phase.kind).not.toBe("pvpPenalty");
  });

  it("站在起点附近退不满，也不会退到负数", () => {
    let state = decidedPvp(20260805, (draft) => {
      draft.players.player2.position = 2;
    });

    state = gameReducer(state, { type: "choosePvpPenalty", choice: "retreat" });

    expect(state.players.player2.position).toBe(0);
    expect(state.phase.kind).not.toBe("pvpPenalty");
  });

  it("越权提交付不出的代价会被拒绝，且拒绝时原样返回旧 state", () => {
    /*
      界面按同一个函数算，压根不会画出交生命那个按钮，走到这里意味着客户端越权。
      引擎沿用"拒绝无效动作"的惯例，关键有两点：
      拒绝时返回的必须是**传入的那个对象**（服务器靠引用相等判断要不要回错误），
      以及拒绝之后不能把人卡死——后退永远可选。
    */
    const before = decidedPvp(20260805, (draft) => {
      draft.players.player1.hp = draft.players.player1.maxHp;
      draft.players.player2.scrolls = [{ instanceId: "s-1", kind: "might" }];
    });
    expect(before.phase.kind).toBe("pvpPenalty");

    const rejected = gameReducer(before, { type: "choosePvpPenalty", choice: "hp" });
    expect(rejected).toBe(before);

    // 换成能付的那一项，立刻推进
    const after = gameReducer(before, {
      type: "choosePvpPenalty",
      choice: "resource",
      resourceType: "scroll",
      instanceId: "s-1",
    });
    expect(after).not.toBe(before);
    expect(after.phase.kind).not.toBe("pvpPenalty");
    expect(after.players.player1.scrolls.map((item) => item.instanceId)).toContain("s-1");
    expect(after.players.player2.scrolls).toHaveLength(0);
  });

  it("退走的人如果就是本回合行动的人，格子内容不再结算", () => {
    // 他已经不站在那格上了。反过来，退走的是对手时，行动方还站着，格子照常结算
    let state = decidedPvp(20260805, (draft) => {
      // 让 player2（败方）成为行动方
      draft.activePlayerId = "player2";
      draft.players.player2.position = 20;
      draft.players.player1.position = 20;
    });
    expect(state.phase.kind).toBe("pvpPenalty");

    state = gameReducer(state, { type: "choosePvpPenalty", choice: "retreat" });

    expect(state.players.player2.position).toBe(20 - PVP_RETREAT_TILES);
    expect(state.phase.kind).toBe("turnComplete");
  });

  it("交生命付得出时正常转移，且不会把败方打到 0", () => {
    let state = decidedPvp(20260805, (draft) => {
      draft.players.player1.hp = 10;
      draft.players.player2.hp = 2;
      draft.players.player2.scrolls = [];
      draft.players.player2.equipment = [];
    });
    expect(state.phase.kind).toBe("pvpPenalty");

    state = gameReducer(state, { type: "choosePvpPenalty", choice: "hp" });

    // 败方只剩 2 点，只能交 1，留住最后 1 点
    expect(state.players.player1.hp).toBe(11);
    expect(state.players.player2.hp).toBe(1);
    expect(state.phase.kind).not.toBe("pvpPenalty");
  });
});
