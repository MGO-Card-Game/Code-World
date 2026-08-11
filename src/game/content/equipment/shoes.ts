import { defineEquipment } from "./definition";
import { targetsEliteOrBoss } from "../../enemyClassification";

/** 逐日靴本场抽到的加成方向，存入装备的 battleMemo。 */
const SUNCHASER_ATTACK = 1;
const SUNCHASER_DEFENSE = 2;

/** 鞋具：让玩家更容易走到关键节点，但不直接取消路线选择。 */
export const SHOES = defineEquipment("shoes", {
  travelerBoots: {
    name: "旅行者短靴",
    description: "地图移动骰上限 +1",
    rarity: "N",
    modifiers: [{ type: "dieSides", die: "movement", value: 1 }],
  },

  windboundWraps: {
    name: "疾风绑腿",
    description: "移动骰上限 +1；生命上限 +2",
    rarity: "N",
    modifiers: [
      { type: "dieSides", die: "movement", value: 1 },
      { type: "maxHp", value: 2 },
    ],
  },

  veteransMarchBoots: {
    name: "士兵行军靴",
    description: "移动骰上限 +1；本场战斗从第 3 回合起，攻击与防御各 +1",
    rarity: "N",
    modifiers: [{ type: "dieSides", die: "movement", value: 1 }],
    effects: {
      /*
        迅雷战靴（SR）的反面：那张在第 1 回合爆发，这张前两回合完全没有收益，
        换来的是打得越久越强。速胜的对局里它就是一双 +1 移动的鞋，
        这就是它的 N 档定位。

        battle.round 每个攻击回合 +1、攻防每轮交替，所以「第 3 回合起」意味着
        双方各已经出手过一次。不判 dieKind：攻防两侧都加，钩子本来就只在
        自己参与的那一侧被调用，一轮里只会命中其中一个。
      */
      beforeRoll({ dieKind, battle, modifiers, addBattleLog }) {
        if (battle.round < 3) return;
        modifiers.flatBonus += 1;
        addBattleLog(
          `士兵行军靴踩稳了阵脚，本次${dieKind === "attack" ? "攻击" : "防御"} +1。`,
        );
      },
    },
  },

  gamekeepersBoots: {
    name: "护卫靴",
    description: "移动骰上限 +1；对手是精英或首领时，防御骰上限 +1",
    rarity: "N",
    modifiers: [{ type: "dieSides", die: "movement", value: 1 }],
    effects: {
      /*
        判据和寒铁长枪一致（首领，或者带了精英词缀的普通怪），只是搬到防守侧：
        那张是打强敌更疼，这张是挨强敌更抗。对普通怪完全没有收益，
        所以它是一双「平时白板、硬仗才立起来」的鞋。

        写成 sidesOverride 而不是 flatBonus，和血誓指环、无名骑士遗甲同一种量纲——
        卡面前半句说的也是骰面上限，同一张卡上不该混用两种加法。
      */
      beforeRoll({ dieKind, battle, modifiers, addBattleLog }) {
        if (dieKind !== "defense") return;
        if (!targetsEliteOrBoss(battle)) return;
        modifiers.sidesOverride = (modifiers.sidesOverride ?? 6) + 1;
        addBattleLog("你绑紧了护卫靴，本次防御骰上限 +1。");
      },
    },
  },

  runnersBoots: {
    name: "逃亡者短靴",
    description: "移动骰上限 +1；本场战斗第一次结算己方防御骰时，防御骰上限额外 +1",
    rarity: "R",
    modifiers: [{ type: "dieSides", die: "movement", value: 1 }],
    effects: {
      /*
        「本场第一次」用暗格占位，套路同灰铁胸甲——区别是这里改的是骰面上限
        （sidesOverride），不是伤害减免。防御骰上限的加成叠在别的骰面来源之上，
        写法与无名骑士遗甲、血誓指环一致：先取当前 sidesOverride（没有就是基础 6），
        再往上加。
      */
      beforeRoll({ dieKind, item, modifiers, addBattleLog }) {
        if (dieKind !== "defense") return;
        if (item.battleMemo !== undefined) return;
        item.battleMemo = 1;
        modifiers.sidesOverride = (modifiers.sidesOverride ?? 6) + 1;
        addBattleLog("逃亡者短靴借势一闪，本次防御骰上限 +1。");
      },
    },
  },

  lynxBoots: {
    name: "山猫软靴",
    description: "地图移动骰上限 +1；本场战斗第一次攻击时，攻击骰最低点数为 2",
    rarity: "N",
    modifiers: [{ type: "dieSides", die: "movement", value: 1 }],
    effects: {
      // N 档只削掉第一次攻击最差的那一面；后手时的防御不会提前消耗暗格。
      beforeRoll({ dieKind, item, modifiers, addBattleLog }) {
        if (dieKind !== "attack" || item.battleMemo !== undefined) return;
        item.battleMemo = 1;
        modifiers.minimumRoll = Math.max(modifiers.minimumRoll, 2);
        addBattleLog("山猫软靴让起手步伐更稳，本场第一次攻击的骰子最低为 2。");
      },
    },
  },

  headwindBoots: {
    name: "逆风长靴",
    description: "地图移动骰上限 +2；战斗前 2 回合，攻击骰和防御骰上限 -1",
    rarity: "R",
    modifiers: [{ type: "dieSides", die: "movement", value: 2 }],
    effects: {
      /*
        这是移动专精的取舍牌：地图上稳定多两面，代价集中在战斗开局。直接改
        sidesOverride 能让代价同样作用于 D20 等骰面替换，不会被卷轴绕开。
      */
      beforeRoll({ battle, modifiers, addBattleLog }) {
        if (battle.round > 2) return;
        modifiers.sidesOverride = (modifiers.sidesOverride ?? 6) - 1;
        addBattleLog("逆风长靴尚未卸去风阻，本次骰面上限 -1。");
      },
    },
  },

  houndstepBoots: {
    name: "猎踪靴",
    description: "移动骰上限 +2，但防御骰上限 -1",
    rarity: "N",
    modifiers: [
      { type: "dieSides", die: "movement", value: 2 },
      { type: "dieSides", die: "defense", value: -1 },
    ],
  },

  stormstepBoots: {
    name: "迅雷战靴",
    description: "移动骰上限 +1，攻击骰上限 +1；本场战斗第一次由己方发起攻击时，本次攻击额外投 1 个骰子",
    rarity: "SR",
    modifiers: [
      { type: "dieSides", die: "movement", value: 1 },
      { type: "dieSides", die: "attack", value: 1 },
    ],
    effects: {
      /*
        「己方发起的第一次攻击」不用暗格也能判：dieKind === "attack" 这个钩子
        只会在自己是本轮攻击方时触发（battleRound 只拿 attackerSide 调用它），
        而 battle.round === 1 意味着这是先攻骰定下来的那一位第一次出手。
        自己若是后攻，第一轮里 dieKind 只会是 "defense"，这张卡天然不会误触发。
      */
      beforeRoll({ dieKind, battle, modifiers, addBattleLog }) {
        if (dieKind !== "attack") return;
        if (battle.round !== 1) return;
        modifiers.extraDice += 1;
        addBattleLog("迅雷战靴踏雷而起，本次攻击额外投 1 个骰子。");
      },
    },
  },

  sunchaserBoots: {
    name: "逐日靴",
    description: "移动骰上限 +2；每场战斗开始时，随机使本场攻击或防御 +3",
    rarity: "PR",
    modifiers: [{ type: "dieSides", die: "movement", value: 2 }],
    effects: {
      // 一场只抽一次并写入暗格；战斗结束时由 clearBattleMemos 统一清理。
      onBattleStart({ item, random, addBattleLog }) {
        const chosen = random() < 0.5 ? SUNCHASER_ATTACK : SUNCHASER_DEFENSE;
        item.battleMemo = chosen;
        addBattleLog(
          chosen === SUNCHASER_ATTACK
            ? "逐日靴追逐烈阳，本场攻击 +3。"
            : "逐日靴踏住日影，本场防御 +3。",
        );
      },
      beforeRoll({ dieKind, item, modifiers }) {
        const chosen = dieKind === "attack" ? SUNCHASER_ATTACK : SUNCHASER_DEFENSE;
        if (item.battleMemo !== chosen) return;
        modifiers.flatBonus += 3;
      },
    },
  },
});
