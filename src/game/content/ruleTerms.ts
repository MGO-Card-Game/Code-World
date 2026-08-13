import type { StatModifier } from "../effects/battleHooks";

/**
 * 通用规则术语。
 *
 * 和 keywords.ts 的分工：关键字是「无视防御」「自损」这类一整条特殊规则，
 * 规则术语则是卡面散文反复使用的基础词汇。术语留在句子原位并提供统一释义，
 * 不再额外占一枚标签；否则「攻击骰上限 +1」这种基础数值也会把小卡挤满。
 *
 * 每个词按概念登记，aliases 只负责兼容自然语序。例如「移动骰上限」和
 * 「地图移动骰上限」说的是同一件事，不值得让玩家背两个定义。
 */
export interface RuleTermDefinition {
  label: string;
  aliases: readonly string[];
  rule: string;
  group: "die" | "result" | "stat";
}

export const RULE_TERMS = {
  attackDieLimit: {
    label: "攻击骰上限",
    aliases: ["攻击骰面上限"],
    rule: "攻击骰能掷出的最高点数，也就是 D 后面的数字；例如上限 7 表示使用 D7。",
    group: "die",
  },
  defenseDieLimit: {
    label: "防御骰上限",
    aliases: ["防御骰面上限"],
    rule: "防御骰能掷出的最高点数，也就是 D 后面的数字；例如上限 8 表示使用 D8。",
    group: "die",
  },
  movementDieLimit: {
    label: "移动骰上限",
    aliases: ["地图移动骰上限", "移动骰面上限", "地图移动骰面上限"],
    rule: "地图移动骰能掷出的最高点数。它改变可随机走出的最远距离，不直接增加每次移动结果。",
    group: "die",
  },
  initiativeDieLimit: {
    label: "先攻骰上限",
    aliases: ["先攻骰面上限"],
    rule: "先攻骰能掷出的最高点数。先攻只决定战斗第一次由哪一方攻击。",
    group: "die",
  },
  combatDieLimit: {
    label: "战斗骰上限",
    aliases: ["战斗骰面上限", "骰面上限"],
    rule: "本次攻击骰或防御骰能掷出的最高点数，也就是投掷结果里的最高面。",
    group: "die",
  },
  attackDiceCount: {
    label: "攻击骰数量",
    aliases: [],
    rule: "一次攻击要投几颗骰子。多颗攻击骰的点数相加后参与攻防结算。",
    group: "die",
  },
  defenseDiceCount: {
    label: "防御骰数量",
    aliases: [],
    rule: "一次防御要投几颗骰子。多颗防御骰的点数相加后参与攻防结算。",
    group: "die",
  },
  movementDiceCount: {
    label: "移动骰数量",
    aliases: ["地图移动骰数量"],
    rule: "地图移动时投几颗骰子；多颗移动骰的点数相加，作为本次移动距离。",
    group: "die",
  },
  attackDie: {
    label: "攻击骰",
    aliases: [],
    rule: "攻击方在一次攻击中投掷的骰子。骰点总值再加攻击等修正，与对方防御比较。",
    group: "die",
  },
  defenseDie: {
    label: "防御骰",
    aliases: [],
    rule: "防守方在一次攻击中投掷的骰子。骰点总值再加防御等修正，用来抵消攻击。",
    group: "die",
  },
  movementDie: {
    label: "移动骰",
    aliases: ["地图移动骰"],
    rule: "地图阶段用于决定移动距离的骰子，与战斗中的攻击骰、防御骰分开计算。",
    group: "die",
  },
  initiativeDie: {
    label: "先攻骰",
    aliases: [],
    rule: "战斗开始时双方用来决定第一次攻击方的骰子；之后双方轮流攻击。",
    group: "die",
  },
  highestFace: {
    label: "最高面",
    aliases: [],
    rule: "骰子当前能掷出的最大点数。它会随骰面上限变化，不固定等于 6。",
    group: "result",
  },
  rollTotal: {
    label: "骰点总值",
    aliases: [
      "攻击骰点数之和",
      "防御骰点数之和",
      "骰点数之和",
      "骰子点数之和",
      "点数之和",
      "骰子总值",
    ],
    rule: "本次所有骰子的点数之和；固定攻击、防御与其他加值不包含在内。",
    group: "result",
  },
  maxHp: {
    label: "生命上限",
    aliases: [],
    rule: "角色可以恢复到的最高生命值。提高生命上限不一定同时恢复当前生命。",
    group: "stat",
  },
} as const satisfies Record<string, RuleTermDefinition>;

export type RuleTermKind = keyof typeof RULE_TERMS;

export interface RuleTermMatch {
  kind: RuleTermKind;
  text: string;
  start: number;
  end: number;
}

const labels = (Object.entries(RULE_TERMS) as [RuleTermKind, RuleTermDefinition][])
  .flatMap(([kind, definition]) => [definition.label, ...definition.aliases]
    .map((text) => ({ kind, text })))
  // 长词必须先匹配：「攻击骰上限」不能先被截成「攻击骰」。
  .sort((a, b) => b.text.length - a.text.length);

const LABEL_TO_KIND = new Map(labels.map(({ kind, text }) => [text, kind]));
const TERM_SOURCE = labels
  .map(({ text }) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

export function ruleTermDefinition(kind: RuleTermKind): RuleTermDefinition {
  return RULE_TERMS[kind];
}

/**
 * 已经结构化的永久修正直接映射到术语概念，内容检查不必再各写一份字符串判据。
 *
 * statBonus 暂不映射：自然语言里的「攻击」既可能是基础属性，也可能是某一次攻击
 * 或动作，单靠搜词无法证明卡面说的是 modifier 那一项。
 */
export function ruleTermsForModifiers(modifiers: readonly StatModifier[]): RuleTermKind[] {
  const terms = new Set<RuleTermKind>();
  for (const modifier of modifiers) {
    switch (modifier.type) {
      case "dieSides":
        terms.add({
          attack: "attackDieLimit",
          defense: "defenseDieLimit",
          movement: "movementDieLimit",
          initiative: "initiativeDieLimit",
        }[modifier.die] as RuleTermKind);
        break;
      case "diceCount":
        terms.add({
          attack: "attackDiceCount",
          defense: "defenseDiceCount",
          movement: "movementDiceCount",
        }[modifier.die] as RuleTermKind);
        break;
      case "maxHp":
        terms.add("maxHp");
        break;
      case "statBonus":
        break;
    }
  }
  return [...terms];
}

/** 找出一段卡面文字里的通用规则术语，供 UI 保留原句并原位加解释。 */
export function findRuleTerms(text: string): RuleTermMatch[] {
  const matches: RuleTermMatch[] = [];
  const pattern = new RegExp(TERM_SOURCE, "g");
  for (const match of text.matchAll(pattern)) {
    const matched = match[0];
    const kind = LABEL_TO_KIND.get(matched);
    const start = match.index;
    if (!kind || start === undefined) continue;
    matches.push({ kind, text: matched, start, end: start + matched.length });
  }
  return matches;
}
