import { defineEquipment } from "./definition";

/** 鞋具：让玩家更容易走到关键节点，但不直接取消路线选择。 */
export const SHOES = defineEquipment("shoes", {
  travelerBoots: {
    name: "旅行者短靴",
    description: "地图移动骰上限 +1（D6 → D7）",
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

  houndstepBoots: {
    name: "猎踪靴",
    description: "移动骰上限 +2，但防御骰上限 -1",
    rarity: "R",
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
    description: "移动骰上限 +2；每场战斗开始时获得一张「逐日靴」卷轴，可将本次攻击或防御 +2",
    rarity: "PR",
    modifiers: [{ type: "dieSides", die: "movement", value: 2 }],
    effects: {
      // 套路同命运王冠/王座破坏者：每场战斗一次的主动技 = 开战时发一张战斗限定牌。
      onBattleStart({ grantBattleScroll }) {
        grantBattleScroll("sunchaserBootsBoost");
      },
    },
  },
});
