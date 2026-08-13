/**
 * 牌面关键字：把反复出现的规则从散文里提出来，变成一个有定义的词。
 *
 * 一条关键字同时是三样东西——牌面上印的字（label）、玩家点开能读到的规则
 * （rule）、以及它在引擎里对应哪一段机制（engine）。三者放在一起是刻意的：
 * 关键字要解决的问题正是"牌面写的"和"引擎做的"各自漂移，把它们拆到文档和
 * 代码两处，只是把漂移挪了个地方。
 *
 * 收词的判据是**复现**，不是"这个机制很重要"。只有一张卡用得上的规则，
 * 在那张卡的描述里说清楚就够了；印成关键字反而要玩家多记一个词。
 */
export interface KeywordDefinition {
  /** 牌面上印的字 */
  label: string;
  /** 玩家点开详情时读到的规则原文 */
  rule: string;
  /** 这个词在引擎里落在哪。给内容作者看，不进界面 */
  engine: string;
}

export const KEYWORDS = {
  ignoreDefense: {
    label: "无视防御",
    rule: "这份伤害不参与攻防差，直接加进本次结算；但仍会经过受击方的减伤与伤害上限。",
    engine: "RollModifiers.bonusDamage",
  },

  directDamage: {
    label: "掷骰前伤害",
    rule: "在双方掷骰之前先结算，减去目标当前的防御值，并照常经过受击方的减伤。",
    engine: 'ScrollEffectDefinition { type: "directDamage" } 或钩子里的 dealDamage',
  },

  damageCap: {
    label: "伤害上限",
    rule: "单次受到的伤害不会超过这个数，攻防差与掷骰前伤害一并压住。",
    engine: "EnemyDamageContext.capDamage",
  },

  selfCost: {
    label: "自损",
    rule: "损失生命不是受到伤害，不触发减伤类效果；战斗里可以把自己扣倒，地图上至少保留 1 点。",
    engine: "loseHp / applyBattleHpLoss",
  },

  battleOnly: {
    label: "本场战斗限定",
    rule: "战斗开始时发到手上，结束时收回；不进常驻手牌，也不会从宝箱或战斗奖励里抽到。",
    engine: "OwnedScroll.temporary + 定义上的 drawable: false",
  },

  eliteOnly: {
    label: "精英与首领限定",
    rule: "只能对精英怪、带词条的漫游怪和阶段首领打出；其他战斗里它根本不进可选列表。",
    engine: "ScrollDefinition.usableAgainst",
  },

  needsTarget: {
    label: "需选目标",
    rule: "打出后先选一名其他玩家，效果落在他身上。",
    engine: 'ScrollEffectDefinition { type: "targetPlayer" }（由 effects 推导）',
  },

  replacesMovement: {
    label: "代替移动",
    rule: "用它代替本回合的移动骰，只能在还没掷骰时使用。",
    engine: "chooseMovement / advanceTiles / teleport / teleportAnywhere / swapPositions（由 effects 推导）",
  },

  skipsPath: {
    label: "不经沿途",
    rule: "只结算落点，途中的营地回血与守关门计次都不会触发。",
    engine: "teleport / teleportAnywhere / swapPositions（由 effects 推导）",
  },
} as const satisfies Record<string, KeywordDefinition>;

/** 直接由配置键推导；新增关键字时无需再维护另一份字符串联合类型。 */
export type KeywordKind = keyof typeof KEYWORDS;

/**
 * 关键字的展示顺序，就是上面表里的书写顺序。
 *
 * 定一个全局顺序而不是各卡按声明先后排：同一个词在不同卡上出现的位置要一致，
 * 否则玩家扫一眼牌面找不到固定的落点。手写声明与推导出来的词也因此不分先后，
 * 混在一起后仍然落回同一个次序。
 */
const KEYWORD_ORDER = Object.keys(KEYWORDS) as KeywordKind[];

export function keywordDefinition(kind: KeywordKind): KeywordDefinition {
  return KEYWORDS[kind];
}

/** 去重并排成固定顺序。各处的 xxxKeywords() 都经这里出口。 */
export function orderKeywords(kinds: Iterable<KeywordKind>): KeywordKind[] {
  const present = new Set(kinds);
  return KEYWORD_ORDER.filter((kind) => present.has(kind));
}
