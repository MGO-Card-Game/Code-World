import { describe, expect, it } from "vitest";
import { equipmentCategory } from "../content/equipment";
import { MAP_EVENTS } from "../content/events";
import { drawableScrollKinds, SCROLLS } from "../content/scrolls";
import { ECONOMY } from "../economy";
import { createInitialGame, gameReducer, handleDisconnectTimeout } from "../engine";
import { MAP_REGION_SIZE } from "../map";
import { canAct, viewFor } from "../multiplayer";
import type { GameEvent, GameState, PlayerId } from "../types";

/**
 * 事件是按旁白关键字识别的，不是按副作用反推的。
 *
 * 反推的写法在事件只有九个、且副作用两两不同时还成立；温泉和山路喘息都只回血、
 * 篝火同时发牌，再往下加事件就会互相盖住。关键字来自各事件自己的 narration，
 * 改文案时测试会红，这正是想要的——文案是玩家唯一能看到的事件身份。
 */
const EVENT_NARRATIONS = {
  roadsideRespite: "奇遇带来喘息",
  hotSpring: "浸入山涧温泉",
  fallingRocks: "山路落石",
  mire: "泥泞沼泽",
  lostPurse: "在路边捡到钱袋",
  travelerGift: "从旅人手中获得",
  fallenAdventurer: "冒险者的尸体",
  weaponInStone: "嵌在石头中的武器",
  coinRain: "天降金钱雨",
  campfire: "旅人的篝火旁",
  impulseBuy: "被摊主说动",
  // 收到牌和无人可收两条旁白共用这一段，两种情况都认得出来
  requisition: "交出一张卷轴",
  twinSlayer: "双子杀手",
  weaponCollector: "武器收藏家",
  veteranGuidance: "得到武者指点",
  guardianInscription: "参悟守护碑铭",
  casinoRoulette: "走进路边的赌场",
} as const;

type NarratedEventKind = keyof typeof EVENT_NARRATIONS;

/**
 * 认出这一格触发的是哪个事件。
 *
 * 两点讲究：
 * 一是扫整段 history 而不是只看 message——message 只有最后一条旁白，而多效果
 * 事件的识别句未必在最后（冲动消费的最后一句是损失生命）。
 * 二是按旁白**出现的先后**取，不是按表里的键序——翻跟头会接着结算落点，落点又
 * 可能是另一个事件格，那时 history 里会有两条识别句，取表序会认成后触发的那个。
 * 注意 history 是新的在前（见 addHistory），所以要反过来遍历才是时间顺序。
 */
function identify(state: GameState): NarratedEventKind | undefined {
  const kinds = Object.keys(EVENT_NARRATIONS) as NarratedEventKind[];
  for (const entry of [...state.history].reverse()) {
    const hit = kinds.find((kind) => entry.text.includes(EVENT_NARRATIONS[kind]));
    if (hit) return hit;
  }
  return undefined;
}

/** 从旁白里取出掷骰点数，用来核对掷骰事件的数值确实来自那一次投骰。 */
function rolledValue(state: GameState) {
  const matched = /掷出 (\d+) 点/.exec(state.message.text);
  if (!matched) throw new Error(`旁白里没有掷骰点数：${state.message.text}`);
  return Number(matched[1]);
}

function landOnEvent(seed: number) {
  const state = createInitialGame(seed);
  const player = state.players[state.activePlayerId];
  // 留出 10 点回血空间，1d10 温泉才能完整生效；金币断言按“从 0 起”核对。
  player.hp = 10;
  player.gold = 0;
  return landOnEventFrom(state);
}

/**
 * 事件结算现在停在通知弹层上，取出它背后真正的结果阶段。
 *
 * 不把确认动作并进 landOnEvent：gameReducer 每次都会清空 lastEvents，
 * 提前确认会把各用例要断言的结构化事件一起冲掉。
 */
function phaseAfterNotice(state: GameState) {
  return state.phase.kind === "mapEventNotice"
    ? gameReducer(state, { type: "acknowledgeMapEvent" }).phase
    : state.phase;
}

/** 取 lastEvents 而不是取 GameState，这样裁剪后的视图也能直接传进来。 */
function eventsOf<T extends GameEvent["type"]>(
  source: { lastEvents: readonly GameEvent[] },
  type: T,
) {
  return source.lastEvents.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
}

describe("地图事件结算", () => {
  it("注册表里的每个事件都能经真实抽取触发，且结算符合各自的定义", () => {
    const seen = new Set<string>();
    const expected = new Set(Object.keys(MAP_EVENTS));

    for (let seed = 1; seed <= 2000 && seen.size < expected.size; seed += 1) {
      const state = landOnEvent(seed);
      const player = state.players[state.activePlayerId];
      const kind = identify(state);
      if (!kind) throw new Error(`无法识别的事件旁白：${state.message.text}`);
      seen.add(kind);

      switch (kind) {
        case "casinoRoulette":
          expect(phaseAfterNotice(state)).toEqual({
            kind: "casino",
            casino: { playerId: player.id, tileIndex: player.position, spins: 0 },
          });
          continue;
        case "roadsideRespite":
          expect(player.hp).toBe(13);
          expect(eventsOf(state, "playerHpChanged")[0])
            .toMatchObject({ from: 10, to: 13, reason: "event" });
          break;
        case "hotSpring": {
          const roll = rolledValue(state);
          expect(roll).toBeGreaterThanOrEqual(1);
          expect(roll).toBeLessThanOrEqual(10);
          // 满血上限在 20，从 10 点起掷 1d10 永远能完整吃满
          expect(player.hp).toBe(10 + roll);
          expect(eventsOf(state, "playerHpChanged")[0])
            .toMatchObject({ from: 10, to: 10 + roll, reason: "event" });
          break;
        }
        case "fallingRocks":
          expect(player.hp).toBe(8);
          expect(eventsOf(state, "playerHpChanged")[0])
            .toMatchObject({ from: 10, to: 8, reason: "event" });
          break;
        case "mire":
          expect(player.skipNextMovement).toEqual({ reason: "沼泽" });
          expect(player.hp).toBe(10);
          expect(eventsOf(state, "playerHpChanged")).toHaveLength(0);
          break;
        case "lostPurse":
          expect(player.gold).toBe(ECONOMY.eventGold);
          expect(eventsOf(state, "goldChanged")[0])
            .toMatchObject({ from: 0, to: ECONOMY.eventGold, reason: "event" });
          break;
        case "coinRain": {
          const roll = rolledValue(state);
          expect(roll).toBeGreaterThanOrEqual(1);
          expect(roll).toBeLessThanOrEqual(6);
          expect(player.gold).toBe(roll * ECONOMY.eventGold);
          expect(eventsOf(state, "goldChanged")[0])
            .toMatchObject({ from: 0, to: roll * ECONOMY.eventGold, reason: "event" });
          break;
        }
        case "travelerGift":
          expect(player.scrolls).toHaveLength(1);
          expect(eventsOf(state, "scrollGranted")).toHaveLength(1);
          break;
        case "campfire":
          expect(player.scrolls.map((scroll) => scroll.kind))
            .toEqual(["gameMeat", "gameMeat"]);
          expect(eventsOf(state, "scrollGranted")).toHaveLength(2);
          // 发牌不回血：野味要留到玩家自己想用的时候
          expect(player.hp).toBe(10);
          break;
        case "impulseBuy": {
          // landOnEvent 把金币清成 0，所以这里只核对攻击与扣血；扣钱另有专门用例
          expect(player.baseAttack).toBe(6);
          expect(player.baseDefense).toBe(2);
          expect(player.hp).toBe(7);
          expect(eventsOf(state, "baseStatChanged").map((event) => event.stat))
            .toEqual(["attack"]);
          expect(eventsOf(state, "playerHpChanged")[0])
            .toMatchObject({ from: 10, to: 7, reason: "event" });
          expect(eventsOf(state, "goldChanged")).toHaveLength(0);
          break;
        }
        case "requisition":
          // 这个测试床里对手手上没有卷轴，走的是「一张都收不到」那条分支
          expect(player.scrolls).toHaveLength(0);
          expect(eventsOf(state, "scrollTransferred")).toHaveLength(0);
          break;
        case "twinSlayer":
          // 默认测试床里没有手牌，事件应明确说明无牌可复制并直接收尾
          expect(player.scrolls).toHaveLength(0);
          expect(state.message.text).toContain("没有可供双子杀手复制的卷轴");
          break;
        case "weaponCollector":
          // 默认测试床里没有装备，不应凭空获得防御
          expect(player.baseDefense).toBe(2);
          expect(state.message.text).toContain("没有可以交给武器收藏家的装备");
          break;
        case "fallenAdventurer":
          expect(eventsOf(state, "equipmentGranted")).toHaveLength(1);
          break;
        case "weaponInStone":
          expect(equipmentCategory(player.equipment[0].kind)).toBe("weapon");
          expect(eventsOf(state, "equipmentGranted")).toHaveLength(1);
          break;
        case "veteranGuidance":
          expect(eventsOf(state, "baseStatChanged")[0])
            .toMatchObject({ stat: "attack", to: player.baseAttack });
          break;
        case "guardianInscription":
          expect(eventsOf(state, "baseStatChanged")[0])
            .toMatchObject({ stat: "defense", to: player.baseDefense });
          break;
      }
      // 事件一律先停在通知上，确认后才回到回合收尾
      expect(state.phase.kind).toBe("mapEventNotice");
      expect(phaseAfterNotice(state).kind).toBe("turnComplete");
    }

    expect(seen).toEqual(expected);
  });

  it("掷骰事件的旁白点数与实际结算一致，且同种子必然复现", () => {
    for (const kind of ["hotSpring", "coinRain"] as const) {
      let checked = false;
      for (let seed = 1; seed <= 2000 && !checked; seed += 1) {
        const state = landOnEvent(seed);
        if (identify(state) !== kind) continue;
        // 同一个种子重放，掷骰结果必须逐位相同——事件掷骰走的是 state 的随机流
        const replayed = landOnEvent(seed);
        expect(replayed.message.text).toBe(state.message.text);
        expect(replayed.players[replayed.activePlayerId].hp)
          .toBe(state.players[state.activePlayerId].hp);
        expect(replayed.players[replayed.activePlayerId].gold)
          .toBe(state.players[state.activePlayerId].gold);
        checked = true;
      }
      expect(checked).toBe(true);
    }
  });

  it("温泉回血照样受生命上限约束，旁白仍报出真实的掷骰点数", () => {
    let checked = false;
    for (let seed = 1; seed <= 2000 && !checked; seed += 1) {
      const probe = landOnEvent(seed);
      if (identify(probe) !== "hotSpring") continue;

      const state = createInitialGame(seed);
      const player = state.players[state.activePlayerId];
      player.position = 10;
      player.hp = player.maxHp - 1;
      const opponent = Object.values(state.players)
        .find((candidate) => candidate.id !== player.id)!;
      opponent.position = 0;
      const preview = gameReducer(state, { type: "rollMovement" });
      const movement = preview.lastEvents.find((event) => event.type === "movementRolled");
      if (movement?.type !== "movementRolled") throw new Error("应该产生移动投骰事件");
      const target = state.map.tiles[player.position + movement.value];
      target.type = "event";
      target.safeZone = false;
      delete target.enemyId;
      delete target.eliteAffix;
      const resolved = gameReducer(state, { type: "rollMovement" });

      const healed = resolved.players[resolved.activePlayerId];
      expect(healed.hp).toBe(healed.maxHp);
      expect(rolledValue(resolved)).toBeGreaterThanOrEqual(1);
      expect(resolved.message.text).toContain("恢复 1 点生命");
      checked = true;
    }
    expect(checked).toBe(true);
  });

  it("沼泽的移动锁在下一回合兑现，旁白说明的是沼泽而不是战地药剂", () => {
    const initial = createInitialGame(7);
    initial.activePlayerId = "player2";
    initial.phase = { kind: "turnComplete" };
    initial.players.player1.skipNextMovement = { reason: "沼泽" };

    const state = gameReducer(initial, { type: "endTurn" });

    expect(state.activePlayerId).toBe("player1");
    expect(state.phase.kind).toBe("turnComplete");
    expect(state.players.player1.skipNextMovement).toBeUndefined();
    expect(state.message.text).toContain("受沼泽影响，本回合无法移动");
  });

  it("冲动消费按余额扣 30%，向下取整", () => {
    let checked = false;
    for (let seed = 1; seed <= 2000 && !checked; seed += 1) {
      if (identify(landOnEvent(seed)) !== "impulseBuy") continue;

      const state = createInitialGame(seed);
      const player = state.players[state.activePlayerId];
      // 250 的 30% 是 75；取一个除不尽的数，顺带守住向下取整
      player.gold = 250;
      const resolved = landOnEventFrom(state);
      const settled = resolved.players[resolved.activePlayerId];

      expect(settled.gold).toBe(175);
      expect(eventsOf(resolved, "goldChanged")[0])
        .toMatchObject({ from: 250, to: 175, reason: "event" });
      expect(resolved.history.map((entry) => entry.text))
        .toContainEqual(expect.stringContaining("花掉 75 金币"));
      checked = true;
    }
    expect(checked).toBe(true);
  });

  it("冲动消费不会把生命扣到 1 以下，也不会降低基础防御", () => {
    let checked = false;
    for (let seed = 1; seed <= 2000 && !checked; seed += 1) {
      if (identify(landOnEvent(seed)) !== "impulseBuy") continue;

      const state = createInitialGame(seed);
      state.players[state.activePlayerId].hp = 1;
      const defenseBefore = state.players[state.activePlayerId].baseDefense;
      const resolved = landOnEventFrom(state);
      const settled = resolved.players[resolved.activePlayerId];

      expect(settled.hp).toBe(1);
      expect(settled.baseDefense).toBe(defenseBefore);
      expect(eventsOf(resolved, "playerHpChanged")).toHaveLength(0);
      expect(eventsOf(resolved, "baseStatChanged").map((event) => event.stat))
        .toEqual(["attack"]);
      expect(resolved.history.map((entry) => entry.text))
        .toContainEqual(expect.stringContaining("好在及时收手"));
      checked = true;
    }
    expect(checked).toBe(true);
  });

  /*
    三人局要自己扫种子，不能拿两人局扫出来的种子去重放：开局先攻是逐人投骰的，
    多一名玩家整条随机流就错位，抽到的事件也跟着变。所以先按三人局布好局面再
    结算，然后看这一局到底抽中了什么。
  */
  function landOnRequisition(prepare: (state: GameState, donors: PlayerId[]) => void) {
    for (let seed = 1; seed <= 4000; seed += 1) {
      const state = createInitialGame(seed, {}, ["player1", "player2", "player3"]);
      const takerId = state.activePlayerId;
      const donors = state.turnOrder.filter((id) => id !== takerId);
      prepare(state, donors);
      const resolved = landOnEventFrom(state);
      if (identify(resolved) !== "requisition") continue;
      return { resolved, takerId, donors };
    }
    throw new Error("4000 个种子内应抽到拿来主义");
  }

  it("拿来主义从每个有牌的对手各收一张，空手的对手跳过", () => {
    const { resolved, takerId, donors } = landOnRequisition((state, ids) => {
      state.players[ids[0]].scrolls = [
        { instanceId: "donated-1", kind: "might" },
        { instanceId: "donated-2", kind: "guard" },
      ];
      state.players[ids[1]].scrolls = [];
    });
    const taker = resolved.players[takerId];

    // 有牌的那家交出一张、剩一张；空手那家不产生任何事件
    expect(taker.scrolls).toHaveLength(1);
    expect(resolved.players[donors[0]].scrolls).toHaveLength(1);
    expect(resolved.players[donors[1]].scrolls).toHaveLength(0);

    const transfers = eventsOf(resolved, "scrollTransferred");
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ fromId: donors[0], toId: takerId });
    expect(transfers[0].instanceId).toBe(taker.scrolls[0].instanceId);
  });

  it("拿来主义转手的牌，旁观者既看不到牌名也看不到事件里的 kind", () => {
    const { resolved, takerId, donors } = landOnRequisition((state, ids) => {
      state.players[ids[0]].scrolls = [{ instanceId: "donated-1", kind: "might" }];
      state.players[ids[1]].scrolls = [];
    });

    // 交接双方看得到具体是哪一张
    for (const insider of [takerId, donors[0]]) {
      const view = viewFor(resolved, insider);
      expect(eventsOf(view, "scrollTransferred")[0].kind).toBe("might");
    }
    // 第三方只知道"有一张牌换了手"
    const outsider = viewFor(resolved, donors[1]);
    expect(eventsOf(outsider, "scrollTransferred")[0].kind).toBeUndefined();
    // 旁白本来就不点名，任何人都读不出牌名
    expect(outsider.history.map((entry) => entry.text).join("\n"))
      .not.toContain(SCROLLS.might.name);
  });

  it("事件结算停在通知上，事件身份和逐条旁白都带进弹层", () => {
    const state = landOnEvent(1);
    const kind = identify(state);

    if (state.phase.kind !== "mapEventNotice") throw new Error("事件应停在通知上");
    const notice = state.phase.notice;
    expect(notice.playerId).toBe(state.activePlayerId);
    expect(notice.kind).toBe(kind);
    // 弹层里的每一句都真的在这次结算里发生过，顺序也和发生顺序一致
    expect(notice.lines.length).toBeGreaterThan(0);
    const narrated = eventsOf(state, "narration").map((event) => event.text);
    const texts = notice.lines.map((line) => line.text);
    expect(texts).toEqual(narrated.slice(-texts.length));
    // 只收事件自己产生的旁白，走到这一格的那句移动不算
    expect(texts).not.toContain(narrated[0]);
  });

  it("确认之前不会轮到下一个人", () => {
    const state = landOnEvent(1);
    const actor = state.activePlayerId;

    // 通知没关掉时，结束回合这类动作都不该被放行
    expect(canAct(state, { type: "endTurn" }, actor)).toBe(false);
    expect(canAct(state, { type: "acknowledgeMapEvent" }, actor)).toBe(true);
    const other = state.turnOrder.find((id) => id !== actor)!;
    expect(canAct(state, { type: "acknowledgeMapEvent" }, other)).toBe(false);

    const acknowledged = gameReducer(state, { type: "acknowledgeMapEvent" });
    expect(acknowledged.phase.kind).toBe("turnComplete");
    expect(acknowledged.activePlayerId).toBe(actor);
  });

  it("弹层里点名牌名的旁白，对旁观者按暗牌裁剪", () => {
    let checked = false;
    for (let seed = 1; seed <= 2000 && !checked; seed += 1) {
      const state = landOnEvent(seed);
      if (state.phase.kind !== "mapEventNotice") continue;
      const owner = state.phase.notice.playerId;
      const secretLine = state.phase.notice.lines.find((line) => line.secret);
      if (!secretLine) continue;

      const other = state.turnOrder.find((id) => id !== owner)!;
      const outsider = viewFor(state, other);
      if (outsider.phase.kind !== "mapEventNotice") throw new Error("裁剪不该换掉阶段");
      const outsiderTexts = outsider.phase.notice.lines.map((line) => line.text);
      expect(outsiderTexts).toContain(secretLine.secret!.publicText);
      expect(outsiderTexts).not.toContain(secretLine.text);
      // 自己那份仍然是明文
      const insider = viewFor(state, owner);
      if (insider.phase.kind !== "mapEventNotice") throw new Error("裁剪不该换掉阶段");
      expect(insider.phase.notice.lines.map((line) => line.text)).toContain(secretLine.text);
      checked = true;
    }
    expect(checked).toBe(true);
  });

  it("掉线的人不停在通知上，事件直接结算到底", () => {
    const state = createInitialGame(1);
    state.unavailablePlayerIds = [state.activePlayerId];
    const resolved = landOnEventFrom(state);

    expect(resolved.phase.kind).not.toBe("mapEventNotice");
  });

  it("野味只由篝火发放，不会混进随机卡池", () => {
    expect(drawableScrollKinds()).not.toContain("gameMeat");
  });

  it("伤害事件不能把玩家降到 1 点以下", () => {
    let checked = false;
    for (let seed = 1; seed <= 100 && !checked; seed += 1) {
      const state = createInitialGame(seed);
      state.players[state.activePlayerId].hp = 1;
      const resolved = landOnEventFrom(state);
      const narration = resolved.message.text;
      if (!narration.includes("山路落石")) continue;
      expect(resolved.players[resolved.activePlayerId].hp).toBe(1);
      expect(eventsOf(resolved, "playerHpChanged")).toHaveLength(0);
      checked = true;
    }
    expect(checked).toBe(true);
  });

  it("石中武器仍遵守武器槽上限，槽满时进入替换选择", () => {
    let checked = false;
    for (let seed = 1; seed <= 1000 && !checked; seed += 1) {
      const state = createInitialGame(seed);
      const player = state.players[state.activePlayerId];
      player.equipment = [{ instanceId: "existing-weapon", kind: "sword" }];
      const resolved = landOnEventFrom(state);
      if (!resolved.message.text.includes("嵌在石头中的武器")) continue;

      // 通知先讲完事件，装备取舍挂在它的 resume 上，确认后才接手
      expect(resolved.phase.kind).toBe("mapEventNotice");
      const afterNotice = phaseAfterNotice(resolved);
      expect(afterNotice.kind).toBe("equipmentChoice");
      if (afterNotice.kind === "equipmentChoice") {
        expect(afterNotice.choice.playerId).toBe(player.id);
        expect(equipmentCategory(afterNotice.choice.offered.kind)).toBe("weapon");
        expect(afterNotice.choice.resume).toEqual({ kind: "turnComplete" });
      }
      expect(resolved.players[player.id].equipment)
        .toEqual([{ instanceId: "existing-weapon", kind: "sword" }]);
      checked = true;
    }
    expect(checked).toBe(true);
  });

  it("双子杀手让玩家选择已有卷轴，并把具有新实例 ID 的复制品加入手牌", () => {
    let found: GameState | undefined;
    for (let seed = 1; seed <= 2000 && !found; seed += 1) {
      const state = createInitialGame(seed);
      state.players[state.activePlayerId].scrolls = [
        { instanceId: "might-original", kind: "might" },
        { instanceId: "guard-original", kind: "guard" },
      ];
      const resolved = landOnEventFrom(state);
      if (identify(resolved) === "twinSlayer") found = resolved;
    }
    if (!found || found.phase.kind !== "mapEventNotice") {
      throw new Error("2000 个种子内应抽到双子杀手并停在事件通知");
    }

    const owner = found.phase.notice.playerId;
    expect(found.phase.notice.resume).toMatchObject({
      kind: "mapEventScrollChoice",
      choice: {
        playerId: owner,
        candidateIds: ["might-original", "guard-original"],
        eventKind: "twinSlayer",
      },
    });

    const choosing = gameReducer(found, { type: "acknowledgeMapEvent" });
    expect(choosing.phase.kind).toBe("mapEventScrollChoice");
    expect(canAct(
      choosing,
      { type: "chooseMapEventScroll", instanceId: "might-original" },
      owner,
    )).toBe(true);
    const other = choosing.turnOrder.find((id) => id !== owner)!;
    expect(canAct(
      choosing,
      { type: "chooseMapEventScroll", instanceId: "might-original" },
      other,
    )).toBe(false);

    const copied = gameReducer(choosing, {
      type: "chooseMapEventScroll",
      instanceId: "might-original",
    });
    const mightCards = copied.players[owner].scrolls.filter((scroll) => scroll.kind === "might");
    expect(mightCards).toHaveLength(2);
    expect(new Set(mightCards.map((scroll) => scroll.instanceId)).size).toBe(2);
    expect(copied.players[owner].scrolls.map((scroll) => scroll.instanceId))
      .toContain("might-original");
    expect(eventsOf(copied, "scrollGranted")).toHaveLength(1);
    expect(copied.phase.kind).toBe("turnComplete");

    const outsider = viewFor(copied, other);
    expect(eventsOf(outsider, "scrollGranted")[0].kind).toBeUndefined();
    expect(outsider.message.text).toContain("复制了一张卷轴");
    expect(outsider.message.text).not.toContain(SCROLLS.might.name);
  });

  it("武器收藏家可收走所选装备并永久增加 1 点基础防御", () => {
    let found: GameState | undefined;
    for (let seed = 1; seed <= 2000 && !found; seed += 1) {
      const state = createInitialGame(seed);
      const player = state.players[state.activePlayerId];
      player.equipment = [
        { instanceId: "boots-offer", kind: "windboundWraps" },
        { instanceId: "sword-keep", kind: "sword" },
      ];
      // windboundWraps 提供 2 点最大生命，验证交出时走统一卸装逻辑。
      player.maxHp += 2;
      player.hp = player.maxHp;
      const resolved = landOnEventFrom(state);
      if (identify(resolved) === "weaponCollector") found = resolved;
    }
    if (!found || found.phase.kind !== "mapEventNotice") {
      throw new Error("2000 个种子内应抽到武器收藏家并停在事件通知");
    }

    const owner = found.phase.notice.playerId;
    const defenseBefore = found.players[owner].baseDefense;
    expect(found.phase.notice.resume).toMatchObject({
      kind: "mapEventEquipmentChoice",
      choice: {
        playerId: owner,
        candidateIds: ["boots-offer", "sword-keep"],
        eventKind: "weaponCollector",
      },
    });

    const choosing = gameReducer(found, { type: "acknowledgeMapEvent" });
    expect(choosing.phase.kind).toBe("mapEventEquipmentChoice");
    const traded = gameReducer(choosing, {
      type: "chooseMapEventEquipment",
      instanceId: "boots-offer",
    });
    expect(traded.players[owner].equipment.map((item) => item.instanceId))
      .toEqual(["sword-keep"]);
    expect(traded.players[owner].baseDefense).toBe(defenseBefore + 1);
    expect(traded.players[owner].maxHp).toBe(20);
    expect(traded.players[owner].hp).toBe(20);
    expect(eventsOf(traded, "baseStatChanged")).toContainEqual(expect.objectContaining({
      stat: "defense",
      from: defenseBefore,
      to: defenseBefore + 1,
    }));
    expect(traded.phase.kind).toBe("turnComplete");
  });

  it("武器收藏家的交易可以拒绝，装备与防御均保持不变", () => {
    const state = createInitialGame(20260812);
    state.players.player1.equipment = [{ instanceId: "sword-keep", kind: "sword" }];
    state.phase = {
      kind: "mapEventEquipmentChoice",
      choice: {
        playerId: "player1",
        candidateIds: ["sword-keep"],
        eventKind: "weaponCollector",
        effectIndex: 0,
      },
    };
    const defenseBefore = state.players.player1.baseDefense;

    const declined = gameReducer(state, { type: "chooseMapEventEquipment" });
    expect(declined.players.player1.equipment).toEqual(state.players.player1.equipment);
    expect(declined.players.player1.baseDefense).toBe(defenseBefore);
    expect(eventsOf(declined, "baseStatChanged")).toHaveLength(0);
    expect(declined.message.text).toContain("谢绝了武器收藏家的交易");
    expect(declined.phase.kind).toBe("turnComplete");
  });
});

/**
 * 让当前行动玩家踩上一格事件格。
 *
 * 所有对手一律挪到 0 号格：只挪一个的话，三人以上的对局里剩下那个可能正好站在
 * 落点上，把事件格变成相遇战。
 */
function landOnEventFrom(
  state: GameState,
  /** 摆好默认站位之后、真正结算之前的最后一次布置；用来放置跨区域的对手等。 */
  prepare?: (state: GameState) => void,
) {
  const player = state.players[state.activePlayerId];
  player.position = 10;
  for (const candidate of Object.values(state.players)) {
    if (candidate.id !== player.id) candidate.position = 0;
  }
  prepare?.(state);
  const preview = gameReducer(state, { type: "rollMovement" });
  const movement = preview.lastEvents.find((event) => event.type === "movementRolled");
  if (movement?.type !== "movementRolled") throw new Error("应该产生移动投骰事件");
  const target = state.map.tiles[player.position + movement.value];
  target.type = "event";
  target.safeZone = false;
  delete target.enemyId;
  delete target.eliteAffix;
  return gameReducer(state, { type: "rollMovement" });
}
