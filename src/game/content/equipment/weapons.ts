import { defineEquipment } from "./definition";
import { targetsEliteOrBoss } from "../../enemyClassification";

/** 武器：主要抬高攻击骰上限，或者改变高点数出现时的结果。 */
export const WEAPONS = defineEquipment("weapon", {
  blackIronGreatsword: {
    name: "黑铁巨剑",
    description: "攻击时投 2 次并取较低值；额外造成 3 点伤害",
    rarity: "R",
    modifiers: [],
    effects: {
      beforeRoll({ dieKind, modifiers, addBattleLog }) {
        if (dieKind !== "attack") return;
        modifiers.rollAttempts = Math.max(modifiers.rollAttempts, 2);
        modifiers.rollSelection = "lowest";
        addBattleLog("黑铁巨剑沉重难驭，本次攻击投 2 次并取较低值。");
      },
      afterRoll({ dieKind, modifiers, addBattleLog }) {
        if (dieKind !== "attack") return;
        modifiers.bonusDamage += 3;
        addBattleLog("黑铁巨剑以重量碾过防线，额外造成 3 点伤害。");
      },
    },
  },

  oniBlade: {
    name: "鬼切",
    description: "累计击败 3 次精英后解锁：攻击骰上限 +2；攻击被完全抵挡时仍造成 2 点固定伤害",
    rarity: "SR",
    modifiers: [],
    effects: {
      modifiers({ player }) {
        const victories = Object.values(player.stageProgress).reduce(
          (total, progress) => total + progress.eliteVictories,
          0,
        );
        return victories >= 3
          ? [{ type: "dieSides", die: "attack", value: 2 }]
          : [];
      },
      beforeRoll({ player, dieKind, modifiers, addBattleLog }) {
        if (dieKind !== "attack") return;
        const victories = Object.values(player.stageProgress).reduce(
          (total, progress) => total + progress.eliteVictories,
          0,
        );
        if (victories < 3) return;
        modifiers.minimumDamage = Math.max(modifiers.minimumDamage, 2);
        addBattleLog("鬼切已经解锁，本次攻击至少造成 2 点固定伤害。");
      },
    },
  },

  sword: {
    name: "铁剑",
    description: "攻击永久 +1",
    rarity: "N",
    modifiers: [{ type: "statBonus", stat: "attack", value: 1 }],
  },

  oldKnightSword: {
    name: "旧骑士长剑",
    description: "攻击骰上限 +1；攻击骰掷出最高面时，额外造成 1 点伤害",
    rarity: "N",
    modifiers: [{ type: "dieSides", die: "attack", value: 1 }],
    effects: {
      /*
        newCard.md 原文写的是「最高值为 6 时」，但这把剑自己就把攻击骰改成了 D7，
        盯着 6 既打不到真正的最高面，再叠一件加骰面的装备还会越来越偏。
        这里统一取本次实际骰面上限，和断星剑、回响之剑的「最高值」说法一致。
        多骰时任意一颗打出上限即触发，但只加一次。
      */
      afterRoll({ dieKind, roll, modifiers, addBattleLog }) {
        if (dieKind !== "attack") return;
        if (!roll.dice.includes(roll.sides)) return;
        modifiers.bonusDamage += 1;
        addBattleLog(`旧骑士长剑掷出 ${roll.sides}，额外造成 1 点伤害。`);
      },
    },
  },

  whetstoneDagger: {
    name: "磨石短匕",
    description: "攻击骰上限 +1；攻击骰最低点数为 2",
    rarity: "N",
    modifiers: [{ type: "dieSides", die: "attack", value: 1 }],
    effects: {
      /*
        和旧骑士长剑正好是一对：那张奖励掷出最高面，这张削掉最低面。
        minimumRoll 卷轴和赐福都在用，装备这边它是第一次出现。

        刻意不写战报。这条修正每次攻击都在，而 beforeRoll 发生在投骰之前，
        根本判断不出它这次有没有真的顶到——每轮都播一条"最低点数为 2"，
        战报里全是噪音，玩家反而看不见真正发生了什么。

        取 max 而不是直接赋值：卷轴的铁壁令、精准卷轴抬得比 2 高，
        装备不该把它们压回来。
      */
      beforeRoll({ dieKind, modifiers }) {
        if (dieKind !== "attack") return;
        modifiers.minimumRoll = Math.max(modifiers.minimumRoll, 2);
      },
    },
  },

  sigilCarversKnife: {
    name: "符匠刻刀",
    description: "攻击骰上限 +1；本场战斗你每打出一张卷轴，本次攻击 +1（最多 +2）",
    rarity: "N",
    modifiers: [{ type: "dieSides", die: "attack", value: 1 }],
    effects: {
      /*
        和黑日碎片互为镜像：那张对每张卷轴收 1 点血，这张为每张卷轴发 1 点攻击。

        张数读上下文的 ownScrollsUsed，不要自己去数手牌——牌打完就离手了。
        battleRound 的 countScrollUse 排在装备钩子之前，所以本回合刚打出的牌
        本回合就算数，牌面写的因果不慢半拍。

        封顶 2 是 N 档的定位所在：不封顶的话，一局攒够手牌就能把它推到
        SR 以上的量级，而封顶之后它的天花板是固定的 +2。
      */
      beforeRoll({ dieKind, ownScrollsUsed, modifiers, addBattleLog }) {
        if (dieKind !== "attack") return;
        const bonus = Math.min(2, ownScrollsUsed);
        if (bonus <= 0) return;
        modifiers.flatBonus += bonus;
        addBattleLog(`符匠刻刀吸下本场卷轴的余墨，本次攻击 +${bonus}。`);
      },
    },
  },

  monsterHunterBlade: {
    name: "猎魔短刃",
    description: "攻击骰上限 +1；攻击生命值低于一半的目标时，攻击额外 +1",
    rarity: "N",
    modifiers: [{ type: "dieSides", die: "attack", value: 1 }],
    effects: {
      // 血量取上下文给的战斗内数值，不要读 player.hp——PvP 期间真实生命值不动
      beforeRoll({ dieKind, opponentHp, opponentMaxHp, modifiers, addBattleLog }) {
        if (dieKind !== "attack") return;
        // 用乘法而不是除法，避免半血刚好卡在浮点边界上
        if (opponentHp * 2 >= opponentMaxHp) return;
        modifiers.flatBonus += 1;
        addBattleLog("猎魔短刃嗅到血味，本次攻击 +1。");
      },
    },
  },

  rendingAxe: {
    name: "裂甲战斧",
    description: "攻击骰上限 +2，但防御骰上限 -1",
    rarity: "R",
    modifiers: [
      { type: "dieSides", die: "attack", value: 2 },
      { type: "dieSides", die: "defense", value: -1 },
    ],
  },

  twinRapier: {
    name: "双生刺剑",
    description: "攻击骰上限 +1；攻击骰点数与上一次攻击不同时，本次攻击额外 +1",
    rarity: "R",
    modifiers: [{ type: "dieSides", die: "attack", value: 1 }],
    effects: {
      /*
        比第一颗骰子，不比总和。满载骰池那类效果一加骰子，总和几乎不可能和上一轮
        重复，+1 就变成白送；盯住第一颗既贴合牌面「攻击骰」的单数说法，也不好钻。

        本场第一次攻击没有前值，所以不触发——「与上一回合不同」得先有个上一回合。
        暗格只在攻击时读写，中间隔着的防守轮不参与比较。
      */
      afterRoll({ dieKind, roll, item, modifiers, addBattleLog }) {
        if (dieKind !== "attack") return;
        const previous = item.battleMemo;
        item.battleMemo = roll.dice[0];
        if (previous === undefined || previous === roll.dice[0]) return;
        modifiers.flatBonus += 1;
        addBattleLog(`双生刺剑换手（${previous} → ${roll.dice[0]}），本次攻击 +1。`);
      },
    },
  },

  coldIronSpear: {
    name: "寒铁长枪",
    description: "攻击骰上限 +1；对精英敌人和首领额外造成 3 点伤害",
    rarity: "R",
    modifiers: [{ type: "dieSides", die: "attack", value: 1 }],
    effects: {
      afterRoll({ battle, dieKind, modifiers, addBattleLog }) {
        if (dieKind !== "attack") return;
        if (!targetsEliteOrBoss(battle)) return;
        modifiers.bonusDamage += 3;
        addBattleLog("寒铁长枪贯穿强敌，额外造成 3 点伤害。");
      },
    },
  },

  momentumHammer: {
    name: "蓄势战锤",
    description: "攻击骰上限 +1；攻击骰首颗掷出 1 或 2 时，下一次攻击 +2",
    rarity: "R",
    modifiers: [{ type: "dieSides", die: "attack", value: 1 }],
    effects: {
      /*
        低点补偿记在暗格里，并在下一次攻击的 beforeRoll 消耗。afterRoll 随后仍可
        再次蓄势，所以连续掷出低点时不会断档；但每次只获得固定 +2，不会累加。

        判首颗而不是总和，避免额外骰子把总和天然抬高后让这张牌几乎再也触发。
      */
      beforeRoll({ dieKind, item, modifiers, addBattleLog }) {
        if (dieKind !== "attack" || item.battleMemo === undefined) return;
        delete item.battleMemo;
        modifiers.flatBonus += 2;
        addBattleLog("蓄势战锤释放积蓄的惯性，本次攻击 +2。");
      },
      afterRoll({ dieKind, roll, item, addBattleLog }) {
        if (dieKind !== "attack" || roll.dice[0] > 2) return;
        item.battleMemo = 1;
        addBattleLog(`蓄势战锤借低点蓄力（${roll.dice[0]}），下一次攻击 +2。`);
      },
    },
  },

  dawnHalberd: {
    name: "晨曦长戟",
    description: "攻击骰上限 +2；本场战斗第一次攻击时，每颗攻击骰最低点数为 4",
    rarity: "SR",
    modifiers: [{ type: "dieSides", die: "attack", value: 2 }],
    effects: {
      /*
        暗格在自己的第一次攻击才写入；若角色后手，第一轮的防御不会误消耗效果。
        minimumRoll 会作用于本次投出的每颗骰子，和满载骰池等额外骰效果自然兼容。
      */
      beforeRoll({ dieKind, item, modifiers, addBattleLog }) {
        if (dieKind !== "attack" || item.battleMemo !== undefined) return;
        item.battleMemo = 1;
        modifiers.minimumRoll = Math.max(modifiers.minimumRoll, 4);
        addBattleLog("晨曦长戟迎光刺出，本场第一次攻击的骰子最低为 4。");
      },
    },
  },

  starbreakerSword: {
    name: "断星剑",
    description: "攻击骰上限 +2；攻击骰掷出最高面时，下一次攻击额外投 1 个骰子",
    rarity: "SR",
    modifiers: [{ type: "dieSides", die: "attack", value: 2 }],
    effects: {
      /*
        beforeRoll 先花掉上一次攒下的额外骰，afterRoll 再决定要不要为下一次攒。
        引擎在同一轮里先调 beforeRoll、后调 afterRoll，所以本轮又掷出最高面时，
        新攒的这颗会留给再下一次攻击，而不是被本轮自己吃掉。

        暗格只在攻击时读写：中间隔着的那一轮自己是防守方，不能把额外骰花在防御上。
      */
      beforeRoll({ dieKind, item, modifiers, addBattleLog }) {
        if (dieKind !== "attack") return;
        if (item.battleMemo === undefined) return;
        delete item.battleMemo;
        modifiers.extraDice += 1;
        addBattleLog("断星剑的余势未散，本次攻击额外投 1 个骰子。");
      },
      afterRoll({ dieKind, roll, item, addBattleLog }) {
        if (dieKind !== "attack") return;
        // 取本次实际骰面上限，理由同旧骑士长剑。多骰时攒的也只有一颗
        if (!roll.dice.includes(roll.sides)) return;
        item.battleMemo = 1;
        addBattleLog(`断星剑掷出 ${roll.sides}，下一次攻击将额外投 1 个骰子。`);
      },
    },
  },

  echoBlade: {
    name: "回响之剑",
    description: "攻击骰上限 +1；本次攻击骰点数之和的一半（向下取整）加到下一次防御总值上",
    rarity: "SR",
    modifiers: [{ type: "dieSides", die: "attack", value: 1 }],
    effects: {
      /*
        记的是攻击骰点数之和的一半，不是造成的伤害。伤害要等攻防差算完才存在，
        afterRoll 这个时机根本读不到；牌面写的也是「攻击的骰子数值」，两边正好对上。

        攻防每轮交替，所以"下一次防御"就是紧接着的那一轮，暗格活不过一轮。
      */
      afterRoll({ dieKind, roll, item, addBattleLog }) {
        if (dieKind !== "attack") return;
        const echo = Math.floor(roll.sum / 2);
        // 单骰掷出 1 时余响为 0，不写暗格也不刷日志
        if (echo <= 0) return;
        item.battleMemo = echo;
        addBattleLog(`回响之剑留下余响，下一次防御 +${echo}。`);
      },
      beforeRoll({ dieKind, item, modifiers, addBattleLog }) {
        if (dieKind !== "defense") return;
        const echo = item.battleMemo;
        if (echo === undefined) return;
        delete item.battleMemo;
        modifiers.flatBonus += echo;
        addBattleLog(`回响之剑的余响回荡，本次防御 +${echo}。`);
      },
    },
  },

  throneBreaker: {
    name: "王座破坏者",
    description: "攻击骰上限 +3；每场战斗开始时获得一张「王座破坏者」攻击牌",
    rarity: "PR",
    modifiers: [{ type: "dieSides", die: "attack", value: 3 }],
    effects: {
      // 和命运王冠同一套路：每场战斗一次的主动技 = 战斗开始时发一张战斗限定牌。
      // 区别只有时机——王冠攻防都能打，这张只在攻击时机可用。
      onBattleStart({ grantBattleScroll }) {
        grantBattleScroll("throneBreakerStrike");
      },
    },
  },
});
