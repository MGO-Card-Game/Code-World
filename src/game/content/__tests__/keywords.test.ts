import { describe, expect, it } from "vitest";
import { BLESSINGS, blessingDefinition, type BlessingKind } from "../blessings";
import {
  ELITE_AFFIXES,
  ENEMIES,
  eliteAffixDefinition,
  enemyDefinition,
  type EliteAffixKind,
  type EnemyKind,
} from "../enemies";
import { EQUIPMENT, equipmentDefinition, type EquipmentKind } from "../equipment";
import { KEYWORDS, type KeywordKind } from "../keywords";
import { SCROLLS, scrollDefinition, scrollKeywords, type ScrollKind } from "../scrolls";

/**
 * 关键字与牌面措辞的登记表检查。
 *
 * 这一份不测行为，测的是**卡面说的和引擎做的是不是同一件事**。行为对不对由
 * 各自的用例守着；这里守的是玩家读到的那行字——它和代码一样是内容的一部分，
 * 却没有类型系统兜底，只能靠登记表把已经踩过的坑钉死。
 */

/** 玩家会读到的一段卡面文字，以及它自己声明的关键字。 */
interface Blurb {
  label: string;
  description: string;
  declared: readonly KeywordKind[];
}

/**
 * 一个自带效果代码的内容单元：它的钩子源码，加上它印出来的全部卡面文字。
 *
 * 怪是一对多——能力说明挂在 abilities 上，效果却写在怪身上；卷轴、装备和
 * 词条都是一对一。区分开之后，"源码里用了什么"按单元查，"这行字写得对不对"
 * 按文字查，两种检查不用互相迁就。
 */
interface Unit {
  label: string;
  blurbs: Blurb[];
  source: string;
}

/**
 * 把一个内容单元的效果代码摊成一段可搜索的文本。
 *
 * 卡牌定义里的钩子是真函数，JSON.stringify 的 replacer 能把它们换成源码字符串。
 * 之所以非读源码不可：`bonusDamage` 这类词只在函数体里出现，声明式 effects 和
 * 类型系统都看不见它——而"看不见"正是牌面和引擎各说各话的根源。
 */
function sourceOf(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    typeof entry === "function" ? entry.toString() : entry,
  ) ?? "";
}

const scrollUnits: Unit[] = (Object.keys(SCROLLS) as ScrollKind[]).map((kind) => {
  const definition = scrollDefinition(kind);
  const label = `卷轴 ${definition.name}(${kind})`;
  return {
    label,
    // 卷轴是唯一有推导词的一类，检查要按最终印出来的那份走
    blurbs: [{ label, description: definition.description, declared: scrollKeywords(definition) }],
    source: sourceOf(definition),
  };
});

const equipmentUnits: Unit[] = (Object.keys(EQUIPMENT) as EquipmentKind[]).map((kind) => {
  const definition = equipmentDefinition(kind);
  const label = `装备 ${definition.name}(${kind})`;
  return {
    label,
    blurbs: [{ label, description: definition.description, declared: definition.keywords ?? [] }],
    source: sourceOf(definition),
  };
});

const enemyUnits: Unit[] = (Object.keys(ENEMIES) as EnemyKind[]).map((kind) => {
  const definition = enemyDefinition(kind);
  return {
    label: `怪物 ${definition.name}(${kind})`,
    blurbs: (definition.abilities ?? []).map((ability) => ({
      label: `怪物 ${definition.name} 的「${ability.name}」`,
      description: ability.description,
      declared: ability.keywords ?? [],
    })),
    source: sourceOf(definition),
  };
});

const affixUnits: Unit[] = (Object.keys(ELITE_AFFIXES) as EliteAffixKind[]).map((kind) => {
  const definition = eliteAffixDefinition(kind);
  const label = `词条 ${definition.name}(${kind})`;
  return {
    label,
    blurbs: [{ label, description: definition.description, declared: definition.keywords ?? [] }],
    source: sourceOf(definition),
  };
});

/*
  赐福没有关键字字段也没有钩子函数，只参加措辞检查。

  它进不了关键字那半边不是遗漏：现有九条赐福全是永久数值与奖励改写，
  没有一条命中已收录的词。真出现了再给 BlessingDefinition 加字段。
*/
const blessingUnits: Unit[] = (Object.keys(BLESSINGS) as BlessingKind[]).map((kind) => {
  const definition = blessingDefinition(kind);
  const label = `赐福 ${definition.name}(${kind})`;
  return {
    label,
    blurbs: [{ label, description: definition.description, declared: [] }],
    source: "",
  };
});

const allUnits = [
  ...scrollUnits,
  ...equipmentUnits,
  ...enemyUnits,
  ...affixUnits,
  ...blessingUnits,
];
const allBlurbs = allUnits.flatMap((unit) => unit.blurbs);

/**
 * 「源码里出现了这个，就必须印这个词」。
 *
 * 每一条都对应一次真实的漂移：`bonusDamage` 全项目十一处，改这版之前只有四处
 * 在牌面上说了"无视防御"，剩下七处玩家无从知道这份伤害不吃防御。
 */
const SOURCE_RULES: readonly {
  /** 给用例起名用的人话 */
  needle: string;
  pattern: RegExp;
  keyword: KeywordKind;
  /** 只在这一类内容里查；不填就是全部 */
  only?: readonly Unit[];
}[] = [
  { needle: "bonusDamage", pattern: /bonusDamage/, keyword: "ignoreDefense" },
  { needle: "capDamage", pattern: /capDamage/, keyword: "damageCap" },
  {
    /*
      掷骰前伤害有两种写法：卷轴走声明式的 directDamage 效果，巨龙在钩子里直接
      调 dealDamage。两种都要认——只认其中一种的话，另一种就成了不受管的暗门。
    */
    needle: "掷骰前伤害",
    pattern: /dealDamage\(|"type":"(?:directDamage|mutualDirectDamage)"/,
    keyword: "directDamage",
  },
  // 自损只出现在装备的 onScrollUsed 上；怪的 loseHp 是自爆，不是"用牌的代价"
  { needle: "loseHp(", pattern: /loseHp\(/, keyword: "selfCost", only: equipmentUnits },
];

/**
 * 「印了这个词，卡面还得补上关键字说不了的那半句」。
 *
 * 判据是**带不带这张卡自己的数**：「减去其当前防御」和「损失 N 点生命」里有
 * 具体数值和条件，关键字只能表达那类规则的共性部分，替代不了。反过来，能被
 * 关键字整句吃掉的短语一律从描述里删掉，见 BANNED_WORDINGS。
 */
const REQUIRED_WORDING: Partial<Record<KeywordKind, string>> = {
  directDamage: "减去其当前防御",
  selfCost: "损失",
};

/**
 * 「印了这个词，卡面就别再重复它」——只在带这个词的卡上禁，不是全局禁。
 *
 * 和 BANNED_WORDINGS 的分工看这句话在别处还有没有正当用途：「无视防御」哪儿都不该
 * 再出现，所以全局禁；「掷骰前」只是和标签撞了，将来别的机制未必不能用这个词。
 * 界面上标签就贴在描述前面，巨龙打击会读成「掷骰前伤害 掷骰前造成 10 点伤害」。
 */
const REDUNDANT_WORDING: Partial<Record<KeywordKind, string>> = {
  directDamage: "掷骰前",
};

/**
 * 已经统一掉的写法，不许再冒出来。
 *
 * 每一条都是同一件事的第二种说法。留着两种说法的代价不在难看，而在玩家没法
 * 靠措辞反推机制——「最低点数为 2」和「最低视为 3」看着像两种效果，其实都是
 * minimumRoll。
 */
const BANNED_WORDINGS: readonly { pattern: RegExp; reason: string }[] = [
  /*
    这三句已经由关键字标签承担，描述里不许再出现。

    界面上标签就贴在描述前面，留着的话两者会并排说同一件事——96px 宽的手牌本来
    就没有那个位置。「无视防御」此前还是四张卡写、七张卡不写，收进标签之后
    这件事在结构上就不会再发生。
  */
  { pattern: /无视防御/, reason: "由「无视防御」标签承担，不要写进描述" },
  { pattern: /本场战斗限定/, reason: "由「本场战斗限定」标签承担" },
  { pattern: /精英与首领限定/, reason: "由「精英与首领限定」标签承担" },
  { pattern: /最大生命/, reason: "统一写「生命上限」" },
  { pattern: /最低点数为/, reason: "统一写「每颗X骰最低视为 N」" },
  { pattern: /每个(攻击|防御|移动|先攻)?骰/, reason: "骰子的量词统一用「颗」" },
  {
    pattern: /（D\d+ ?(→|提升为|变为) ?D\d+）|由 D\d+ 变为/,
    reason: "骰面基数会被别的装备改掉，不要写死在卡面上",
  },
  { pattern: /附加 .*点伤害/, reason: "统一写「额外造成 N 点伤害」" },
  { pattern: /攻击力/, reason: "属性名统一写「攻击」" },
];

describe("关键字登记表", () => {
  it("每条关键字都至少有一张卡在用", () => {
    const used = new Set(allBlurbs.flatMap((blurb) => blurb.declared));
    const unused = (Object.keys(KEYWORDS) as KeywordKind[])
      .filter((kind) => !used.has(kind));
    // 没人用的词只会让玩家多背一个概念，删掉或者给它配张卡
    expect(unused, "关键字登记了却没有卡在用").toEqual([]);
  });

  it("关键字的规则说明不为空——它就是玩家点开要读的那句话", () => {
    for (const [kind, definition] of Object.entries(KEYWORDS)) {
      expect(definition.label.length, `${kind} 缺 label`).toBeGreaterThan(0);
      expect(definition.rule.length, `${kind} 缺 rule`).toBeGreaterThan(0);
      expect(definition.engine.length, `${kind} 缺 engine`).toBeGreaterThan(0);
    }
  });
});

describe("关键字与效果代码对得上", () => {
  for (const { needle, pattern, keyword, only } of SOURCE_RULES) {
    const scope = only ?? allUnits;

    it(`用了 ${needle} 的内容都印了「${KEYWORDS[keyword].label}」`, () => {
      const missing = scope
        .filter((unit) => pattern.test(unit.source))
        .filter((unit) => !unit.blurbs.some((blurb) => blurb.declared.includes(keyword)))
        .map((unit) => unit.label);
      expect(missing, `这些内容用了 ${needle} 却没有声明 ${keyword}`).toEqual([]);
    });

    it(`印了「${KEYWORDS[keyword].label}」的内容确实用了 ${needle}`, () => {
      // 反过来也要查：卡改了写法、关键字忘了摘，牌面就在说一件已经不发生的事
      const stale = scope
        .filter((unit) => unit.blurbs.some((blurb) => blurb.declared.includes(keyword)))
        .filter((unit) => !pattern.test(unit.source))
        .map((unit) => unit.label);
      expect(stale, `这些内容声明了 ${keyword} 却没有用 ${needle}`).toEqual([]);
    });
  }
});

describe("战斗限定牌", () => {
  /**
   * 装备在开战时发的牌，从装备的钩子源码里挖出来。
   *
   * content-extension.md 特意点过「`drawable: false` 不能忘」——忘了的话宝箱和
   * 战斗奖励会把这张战斗限定牌当普通卷轴发出去，变成一张永久卡。那条警告此前
   * 只是一句提醒，这里把它变成一条挡板。
   */
  const grantedKinds = [...new Set(
    equipmentUnits.flatMap((unit) => [
      ...unit.source.matchAll(/grantBattleScroll\(\\?["']([A-Za-z0-9_]+)\\?["']\)/g),
    ].map((match) => match[1])),
  )];

  it("装备发的牌确实存在，且都被抓到了", () => {
    expect(grantedKinds.length).toBeGreaterThan(0);
    for (const kind of grantedKinds) {
      expect(SCROLLS, `装备发了一张不存在的卷轴 ${kind}`).toHaveProperty(kind);
    }
  });

  it("装备发的牌都印着「本场战斗限定」，也都排除在随机卡池外", () => {
    for (const kind of grantedKinds) {
      const definition = scrollDefinition(kind as ScrollKind);
      expect(scrollKeywords(definition), `${definition.name} 少了 battleOnly`)
        .toContain("battleOnly");
      expect(definition.drawable, `${definition.name} 会被当普通卷轴发出去`)
        .toBe(false);
    }
  });

  it("印了「本场战斗限定」的牌一定不参加随机抽取", () => {
    for (const kind of Object.keys(SCROLLS) as ScrollKind[]) {
      const definition = scrollDefinition(kind);
      if (!scrollKeywords(definition).includes("battleOnly")) continue;
      expect(definition.drawable, `${definition.name} 印了战斗限定却还在卡池里`)
        .toBe(false);
    }
  });
});

describe("使用对象限制", () => {
  it("挑对手的牌都印了「精英与首领限定」，反过来也一样", () => {
    for (const kind of Object.keys(SCROLLS) as ScrollKind[]) {
      const definition = scrollDefinition(kind);
      const restricted = scrollKeywords(definition).includes("eliteOnly");
      expect(
        definition.usableAgainst !== undefined,
        `${definition.name} 的使用对象限制和关键字对不上`,
      ).toBe(restricted);
    }
  });
});

describe("推导出来的关键字不要手写", () => {
  /*
    这三条只从声明式 effects 来，读一遍数组就能得出。手写一份等于给漂移开了个口子，
    判据和「category 由 timings 推导」「装备 category 由文件盖章」是同一条。
  */
  const DERIVED_ONLY: readonly KeywordKind[] = [
    "needsTarget",
    "replacesMovement",
    "skipsPath",
  ];

  it("卷轴不手写可推导的关键字", () => {
    for (const kind of Object.keys(SCROLLS) as ScrollKind[]) {
      const definition = scrollDefinition(kind);
      for (const derived of DERIVED_ONLY) {
        expect(
          definition.keywords ?? [],
          `${definition.name} 手写了可以推导的 ${derived}`,
        ).not.toContain(derived);
      }
    }
  });

  it("代替移动的牌都被推导到了", () => {
    // 六张地图牌 + 移形换影，是当前全部会顶掉移动骰的卷轴
    const replacing = (Object.keys(SCROLLS) as ScrollKind[])
      .filter((kind) => scrollKeywords(scrollDefinition(kind)).includes("replacesMovement"));
    expect(replacing.sort()).toEqual([
      "anywhereDoor",
      "bodySwap",
      "duelContract",
      "leapForward",
      "remoteDice",
      "retrace",
      "shortRangeTeleportCharm",
      "somersault",
      "townPortal",
      "withinReach",
    ]);
  });

  it("「跳过」和「走过」分得开", () => {
    // 逐格走的三张不能带 skipsPath，否则营地回血和守关门计次会被牌面说反
    const walking = ["leapForward", "remoteDice", "somersault"] as const;
    for (const kind of walking) {
      expect(scrollKeywords(scrollDefinition(kind)), `${kind} 是逐格前进`)
        .not.toContain("skipsPath");
      expect(scrollKeywords(scrollDefinition(kind))).toContain("replacesMovement");
    }
    for (const kind of ["anywhereDoor", "shortRangeTeleportCharm", "withinReach"] as const) {
      expect(scrollKeywords(scrollDefinition(kind)), `${kind} 只结算落点`)
        .toContain("skipsPath");
    }
  });
});

describe("牌面措辞", () => {
  for (const [keyword, required] of Object.entries(REQUIRED_WORDING) as [KeywordKind, string][]) {
    it(`印了「${KEYWORDS[keyword].label}」的卡面都写了「${required}」`, () => {
      const silent = allBlurbs
        .filter((blurb) => blurb.declared.includes(keyword))
        .filter((blurb) => !blurb.description.includes(required))
        .map((blurb) => `${blurb.label}：${blurb.description}`);
      expect(silent, `这些卡面没把 ${keyword} 说出来`).toEqual([]);
    });
  }

  for (const [keyword, redundant] of Object.entries(REDUNDANT_WORDING) as [KeywordKind, string][]) {
    it(`印了「${KEYWORDS[keyword].label}」的卡面不再重复「${redundant}」`, () => {
      const doubled = allBlurbs
        .filter((blurb) => blurb.declared.includes(keyword))
        .filter((blurb) => blurb.description.includes(redundant))
        .map((blurb) => `${blurb.label}：${blurb.description}`);
      expect(doubled, `标签已经说了「${redundant}」，描述里不用再写一遍`).toEqual([]);
    });
  }

  for (const { pattern, reason } of BANNED_WORDINGS) {
    it(`没有卡面还在用被统一掉的写法（${reason}）`, () => {
      const offenders = allBlurbs
        .filter((blurb) => pattern.test(blurb.description))
        .map((blurb) => `${blurb.label}：${blurb.description}`);
      expect(offenders, reason).toEqual([]);
    });
  }

  it("卡面和能力说明都不带句末句号", () => {
    /*
      只管卡与能力，不管事件。事件文本是叙述句（「拔出嵌在巨石中的武器……」），
      本来就该带句号；卡面是标签式短语，句号只会在小卡上白占一格。
    */
    const offenders = allBlurbs
      .filter((blurb) => blurb.description.endsWith("。"))
      .map((blurb) => blurb.label);
    expect(offenders, "卡面描述不要以句号结尾").toEqual([]);
  });

  it("卡面描述不为空，也不带首尾空白", () => {
    for (const blurb of allBlurbs) {
      expect(blurb.description.length, `${blurb.label} 没有描述`).toBeGreaterThan(0);
      expect(blurb.description, `${blurb.label} 描述带首尾空白`)
        .toBe(blurb.description.trim());
    }
  });
});
