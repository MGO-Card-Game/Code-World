import { describe, expect, it } from "vitest";
import { BLESSINGS } from "./blessings";
import { ELITE_AFFIXES } from "./enemies";
import { EQUIPMENT } from "./equipment";
import {
  findRuleTerms,
  RULE_TERMS,
  ruleTermsForModifiers,
} from "./ruleTerms";

describe("通用规则术语", () => {
  it("长术语优先，不把攻击骰上限截成攻击骰", () => {
    expect(findRuleTerms("攻击骰上限 +1；攻击骰掷出最高面时触发"))
      .toMatchObject([
        { kind: "attackDieLimit", text: "攻击骰上限" },
        { kind: "attackDie", text: "攻击骰" },
        { kind: "highestFace", text: "最高面" },
      ]);
  });

  it("自然语序的别名仍然落到同一个概念", () => {
    expect(findRuleTerms("地图移动骰上限 +1；攻击骰点数之和减半"))
      .toMatchObject([
        { kind: "movementDieLimit", text: "地图移动骰上限" },
        { kind: "rollTotal", text: "攻击骰点数之和" },
      ]);
  });

  it("每个术语都有唯一显示词和完整释义", () => {
    const labels = Object.values(RULE_TERMS)
      .flatMap((definition) => [definition.label, ...definition.aliases]);
    expect(new Set(labels).size).toBe(labels.length);
    for (const [kind, definition] of Object.entries(RULE_TERMS)) {
      expect(definition.label.length, `${kind} 缺显示词`).toBeGreaterThan(0);
      expect(definition.rule.length, `${kind} 缺规则释义`).toBeGreaterThan(0);
    }
  });

  it("结构化 modifier 能自动推导对应的基础术语", () => {
    expect(ruleTermsForModifiers([
      { type: "dieSides", die: "attack", value: 1 },
      { type: "diceCount", die: "movement", value: 1 },
      { type: "maxHp", value: 2 },
      { type: "statBonus", stat: "defense", value: 1 },
    ])).toEqual(["attackDieLimit", "movementDiceCount", "maxHp"]);
  });
});

const modifierContent = [
  ...Object.values(EQUIPMENT).map((definition) => ({
    label: `装备 ${definition.name}`,
    description: definition.description,
    modifiers: definition.modifiers,
  })),
  ...Object.values(ELITE_AFFIXES).map((definition) => ({
    label: `怪物词条 ${definition.name}`,
    description: definition.description,
    modifiers: definition.modifiers,
  })),
  ...Object.values(BLESSINGS).map((definition) => ({
    label: `赐福 ${definition.name}`,
    description: definition.description,
    modifiers: definition.modifiers,
  })),
];

describe("结构化 modifier 与卡面术语对得上", () => {
  it("骰面、骰数和生命上限修正都有对应的通用术语", () => {
    const missing: string[] = [];
    for (const content of modifierContent) {
      const declared = new Set(findRuleTerms(content.description).map((term) => term.kind));
      for (const expected of ruleTermsForModifiers(content.modifiers)) {
        if (!declared.has(expected)) {
          missing.push(`${content.label}：${expected}（${content.description}）`);
        }
      }
    }
    expect(missing, "这些结构化修正没有在卡面使用对应的通用术语").toEqual([]);
  });
});
