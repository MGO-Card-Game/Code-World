import { describe, expect, it } from "vitest";
import { roundGold } from "../../economy";
import { CASINO_PRICES, casinoSpinPrice } from "../../casino";
import { createInitialGame, gameReducer, handleDisconnectTimeout } from "../../engine";
import { canAct, currentActor, viewFor } from "../../multiplayer";
import type { CasinoState, GameState, PlayerId } from "../../types";

function enterCasino(seed = 20260808) {
  const state = createInitialGame(seed);
  const playerId = state.activePlayerId;
  const casino: CasinoState = {
    playerId,
    tileIndex: state.players[playerId].position,
    spins: 0,
  };
  state.phase = { kind: "casino", casino };
  return { state, playerId, casino };
}

/** 装满四个部位的槽位，让下一次抽到的任意装备都必然触发 equipmentChoice。 */
function fillEquipmentSlots(state: GameState, playerId: PlayerId) {
  state.players[playerId].equipment = [
    { instanceId: "full-weapon", kind: "sword" },
    { instanceId: "full-armor", kind: "shield" },
    { instanceId: "full-shoes", kind: "travelerBoots" },
    { instanceId: "full-accessory-1", kind: "charm" },
    { instanceId: "full-accessory-2", kind: "fateCrown" },
  ];
}

/** 在槽位已满的前提下找一个种子，让第一次转动恰好抽到装备而不是卷轴。 */
function spinIntoEquipmentChoice(seedFrom: number, seedTo: number) {
  for (let seed = seedFrom; seed <= seedTo; seed += 1) {
    const { state, playerId } = enterCasino(seed);
    fillEquipmentSlots(state, playerId);
    state.players[playerId].gold = 10_000;
    const spun = gameReducer(state, { type: "spinCasino" });
    if (spun.phase.kind === "equipmentChoice") return { spun, playerId };
  }
  return undefined;
}

describe("赌场转盘定价", () => {
  it("价格按 1.6 倍递增并取整到 GOLD_SCALE", () => {
    expect([0, 1, 2, 3, 4].map(casinoSpinPrice)).toEqual([80, 130, 200, 330, 520]);
    expect(casinoSpinPrice(0)).toBe(CASINO_PRICES.base);
  });

  it("中金币档按当前价格的固定倍率派彩", () => {
    for (const spins of [0, 1, 2, 3]) {
      const price = casinoSpinPrice(spins);
      let checked = false;
      for (let seed = 1; seed <= 500 && !checked; seed += 1) {
        const { state, playerId } = enterCasino(seed);
        state.phase = {
          kind: "casino",
          casino: { playerId, tileIndex: state.players[playerId].position, spins },
        };
        state.players[playerId].gold = 10_000;
        const result = gameReducer(state, { type: "spinCasino" });
        const after = result.players[playerId];
        const goldAfterSpend = 10_000 - price;
        if (
          after.gold > goldAfterSpend &&
          after.scrolls.length === 0 &&
          after.equipment.length === 0
        ) {
          expect(after.gold).toBe(goldAfterSpend + roundGold(price * CASINO_PRICES.goldPayoutMultiplier));
          checked = true;
        }
      }
      expect(checked).toBe(true);
    }
  });
});

describe("赌场转盘游玩", () => {
  it("金币不足时转动被拒，非法动作不产生新状态", () => {
    const { state, playerId } = enterCasino(9001);
    state.players[playerId].gold = 10;
    expect(gameReducer(state, { type: "spinCasino" })).toBe(state);
  });

  it("不在店内的玩家或错位的赌场状态无法转动", () => {
    const { state, casino } = enterCasino(9002);
    state.phase = { kind: "casino", casino: { ...casino, tileIndex: casino.tileIndex + 1 } };
    state.players[casino.playerId].gold = 10_000;
    expect(gameReducer(state, { type: "spinCasino" })).toBe(state);
  });

  it("转动成功后按当前价格扣费，次数随之递增，五种结果都能被抽到", () => {
    type Outcome = "bust" | "gold" | "scroll" | "equipment" | "statGrowth";
    const outcomes = new Set<Outcome>();

    for (let seed = 1; seed <= 500 && outcomes.size < 5; seed += 1) {
      const { state, playerId } = enterCasino(seed);
      const before = state.players[playerId];
      before.gold = 10_000;
      const price = casinoSpinPrice(0);
      const goldAfterSpend = 10_000 - price;

      const result = gameReducer(state, { type: "spinCasino" });
      expect(result).not.toBe(state);
      // 新玩家四个装备部位都还空着，槽位不会满，不会绕去 equipmentChoice
      expect(result.phase.kind).toBe("casino");
      if (result.phase.kind !== "casino") throw new Error("应停留在赌场");
      expect(result.phase.casino.spins).toBe(1);
      expect(result.phase.casino.result).toBeDefined();

      const after = result.players[playerId];
      if (after.scrolls.length > 0) {
        outcomes.add("scroll");
        expect(after.gold).toBe(goldAfterSpend);
      } else if (after.equipment.length > 0) {
        outcomes.add("equipment");
        expect(after.gold).toBe(goldAfterSpend);
      } else if (
        after.baseAttack !== before.baseAttack ||
        after.baseDefense !== before.baseDefense ||
        after.maxHp !== before.maxHp
      ) {
        outcomes.add("statGrowth");
        expect(after.gold).toBe(goldAfterSpend);
        // 赌场头奖不计入商店的 statPurchases 计数器，节流全靠赌场自己的涨价曲线
        expect(after.statPurchases).toBe(before.statPurchases);
      } else if (after.gold > goldAfterSpend) {
        outcomes.add("gold");
      } else {
        outcomes.add("bust");
        expect(after.gold).toBe(goldAfterSpend);
      }
    }

    expect(outcomes).toEqual(new Set<Outcome>(["bust", "gold", "scroll", "equipment", "statGrowth"]));
  });

  it("装备槽满时转到装备会先停在 equipmentChoice，选择后回到同一份赌场状态且次数不重复计", () => {
    const found = spinIntoEquipmentChoice(1, 300);
    if (!found) throw new Error("没能找到抽中装备的种子");
    const { spun, playerId } = found;
    if (spun.phase.kind !== "equipmentChoice") throw new Error("应进入装备选择");

    expect(spun.phase.choice.resume).toMatchObject({
      kind: "casino",
      casino: {
        playerId,
        tileIndex: spun.players[playerId].position,
        spins: 1,
        result: { kind: "equipment", price: casinoSpinPrice(0) },
      },
    });
    const goldAfterSpend = spun.players[playerId].gold;

    const resumed = gameReducer(spun, { type: "chooseEquipment" });
    expect(resumed.phase.kind).toBe("casino");
    if (resumed.phase.kind !== "casino") throw new Error("选择后应回到赌场");
    expect(resumed.phase.casino.spins).toBe(1);
    expect(resumed.phase.casino.result?.kind).toBe("equipment");
    // 放弃新装备会折算金币退回来，但花掉的转动费用不会被重复扣
    expect(resumed.players[playerId].gold).toBeGreaterThan(goldAfterSpend);
  });

  it("离开赌场回到 turnComplete，不会自动结束回合", () => {
    const { state } = enterCasino(9101);
    const left = gameReducer(state, { type: "leaveCasino" });
    expect(left.phase.kind).toBe("turnComplete");
    expect(gameReducer(left, { type: "leaveCasino" })).toBe(left);
  });

  it("只有进店玩家能转动和离开，currentActor 也指向该玩家", () => {
    const { state, playerId } = enterCasino(9102);
    const other = state.turnOrder.find((id) => id !== playerId) as PlayerId;
    expect(currentActor(state)).toBe(playerId);
    expect(canAct(state, { type: "spinCasino" }, playerId)).toBe(true);
    expect(canAct(state, { type: "spinCasino" }, other)).toBe(false);
    expect(canAct(state, { type: "leaveCasino" }, playerId)).toBe(true);
    expect(canAct(state, { type: "leaveCasino" }, other)).toBe(false);
  });

  it("转动后必须先确认揭晓结果，确认前不能再次下注或离场", () => {
    const { state, playerId } = enterCasino(9104);
    state.players[playerId].gold = 10_000;
    const spun = gameReducer(state, { type: "spinCasino" });
    if (spun.phase.kind !== "casino" || !spun.phase.casino.result) {
      throw new Error("转动后应停在赌场结果揭晓状态");
    }

    expect(canAct(spun, { type: "spinCasino" }, playerId)).toBe(false);
    expect(canAct(spun, { type: "leaveCasino" }, playerId)).toBe(false);
    expect(canAct(spun, { type: "acknowledgeCasinoResult" }, playerId)).toBe(true);
    expect(gameReducer(spun, { type: "spinCasino" })).toBe(spun);
    expect(gameReducer(spun, { type: "leaveCasino" })).toBe(spun);

    const acknowledged = gameReducer(spun, { type: "acknowledgeCasinoResult" });
    expect(acknowledged.phase.kind).toBe("casino");
    if (acknowledged.phase.kind !== "casino") throw new Error("确认后应回到赌场");
    expect(acknowledged.phase.casino.result).toBeUndefined();
    expect(acknowledged.phase.casino.spins).toBe(1);
    expect(canAct(acknowledged, { type: "spinCasino" }, playerId)).toBe(true);
    expect(canAct(acknowledged, { type: "leaveCasino" }, playerId)).toBe(true);
  });

  it("卷轴结果只向获奖玩家揭示名称，旁观者只能看到一张卷轴", () => {
    let scrollResult: GameState | undefined;
    let owner: PlayerId | undefined;
    for (let seed = 1; seed <= 500 && !scrollResult; seed += 1) {
      const entered = enterCasino(seed);
      entered.state.players[entered.playerId].gold = 10_000;
      const spun = gameReducer(entered.state, { type: "spinCasino" });
      if (spun.phase.kind === "casino" && spun.phase.casino.result?.kind === "scroll") {
        scrollResult = spun;
        owner = entered.playerId;
      }
    }
    if (!scrollResult || !owner) throw new Error("未找到卷轴结果种子");
    const other = scrollResult.turnOrder.find((id) => id !== owner) as PlayerId;
    const ownerView = viewFor(scrollResult, owner);
    const otherView = viewFor(scrollResult, other);
    if (ownerView.phase.kind !== "casino" || ownerView.phase.casino.result?.kind !== "scroll") {
      throw new Error("获奖玩家应看到卷轴结果");
    }
    if (otherView.phase.kind !== "casino" || otherView.phase.casino.result?.kind !== "scroll") {
      throw new Error("旁观者应看到已裁剪的卷轴结果");
    }
    expect(ownerView.phase.casino.result.name).not.toBe("一张卷轴");
    expect(otherView.phase.casino.result.name).toBe("一张卷轴");
  });
});

describe("赌场转盘联机兜底", () => {
  it("赌场中直接掉线会离场并轮转", () => {
    const { state, playerId } = enterCasino(9103);
    state.unavailablePlayerIds = [playerId];
    const resolved = handleDisconnectTimeout(state, playerId);
    expect(resolved.activePlayerId).not.toBe(playerId);
    expect(resolved.phase.kind).not.toBe("casino");
  });

  it("赌场装备选择中掉线会在同一次兜底里放弃装备、离场并轮转", () => {
    const found = spinIntoEquipmentChoice(301, 600);
    if (!found) throw new Error("没能找到抽中装备的种子");
    const { spun, playerId } = found;
    spun.unavailablePlayerIds = [playerId];

    const resolved = handleDisconnectTimeout(spun, playerId);
    expect(resolved.activePlayerId).not.toBe(playerId);
    expect(resolved.phase.kind).not.toBe("equipmentChoice");
    expect(resolved.phase.kind).not.toBe("casino");
  });
});
