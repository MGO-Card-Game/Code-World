import { describe, expect, it } from "vitest";

/**
 * 界面层的关键字挡板。
 *
 * 卡面关键字承担了描述里删掉的那半条规则——「无视防御」不再写在 description 上，
 * 由标签负责。于是任何**只渲染 description 的地方，玩家读到的就是残缺的卡**。
 *
 * 这条不测行为，测的是渲染点有没有漏。加这一条是因为真漏过：第一版接了六处，
 * 商店、交易、资源列表里的装备四处没接，界面上直接少了一行规则。
 */

/*
  用 import.meta.glob 而不是 node:fs 读源码：tsconfig.app.json 管的是浏览器那一侧，
  没有 node 类型，`npm run build` 的类型检查会直接报错。glob 是 Vite 自带的，
  vite-env.d.ts 已经引了 vite/client，类型现成。
*/
const sources = Object.entries(
  import.meta.glob("../*.tsx", { query: "?raw", import: "default", eager: true }),
).map(([path, text]) => ({ name: path.replace("../", ""), text: text as string }));

/** 带关键字的内容从这几个入口取；赐福、地图事件、永久成长没有关键字，不在此列。 */
const KEYWORD_BEARING = /\bSCROLLS\b|\bEQUIPMENT\b|scrollDefinition|equipmentDefinition|eliteAffixDefinition/;

/** 关键字和描述一起出去的三个出口，两个渲染、一个给读屏拼纯文本。 */
const BLURB_COMPONENTS = /CardBlurb|KeywordRules|blurbText/;

/**
 * 文件级检查放行的例外。
 *
 * PlayerPanel 引了 EQUIPMENT，但装备格只印名字；它唯一一处 `.description` 是赐福
 * 的悬停说明，而赐福没有关键字。例外只写在文件级这一条上——它真要渲染装备说明，
 * 用的会是 `EQUIPMENT[item.kind].description` 那种写法，仍然会被上一条抓住。
 */
const FILE_LEVEL_EXEMPT = new Set(["PlayerPanel.tsx"]);

describe("界面渲染点都带上了关键字", () => {
  it("直接取卷轴／装备表的 description，必须交给 CardBlurb", () => {
    /*
      只认得出「表里直接取」这一种写法（EQUIPMENT[kind].description）。中间过了一道
      局部变量的（definition.description）靠下一条用例的文件级检查兜。两条合起来，
      漏掉的那五处每一处都至少被其中一条抓住。
    */
    const direct = /(?:SCROLLS\[[^\]]+\]|EQUIPMENT\[[^\]]+\]|scrollDefinition\([^)]*\)|equipmentDefinition\([^)]*\))\.description/;
    const offenders: string[] = [];

    for (const { name, text } of sources) {
      text.split("\n").forEach((line, index) => {
        if (!direct.test(line)) return;
        // 作为 CardBlurb 的 description 属性传进去、或者交给 blurbText 拼读屏文本，都算接好了
        if (line.includes("description={") || line.includes("blurbText(")) return;
        offenders.push(`${name}:${index + 1} ${line.trim()}`);
      });
    }

    expect(offenders, "这些地方只渲染了描述，关键字那半条规则会丢").toEqual([]);
  });

  it("凡是渲染带关键字内容说明的文件，都引了 CardBlurb 或 KeywordRules", () => {
    const offenders = sources
      .filter(({ name }) => !FILE_LEVEL_EXEMPT.has(name))
      .filter(({ text }) => text.includes(".description"))
      .filter(({ text }) => KEYWORD_BEARING.test(text))
      .filter(({ text }) => !BLURB_COMPONENTS.test(text))
      .map(({ name }) => name);

    expect(offenders, "这些文件渲染了卡面说明却没有渲染关键字").toEqual([]);
  });
});
