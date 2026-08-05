import type { CustomScrollEffectResolver } from "./cardEffects";

/**
 * 无法用通用 effect 联合类型描述的卷轴，在这里注册具名解析器。
 * 卡牌配置使用 `{ type: "custom", resolver: "example" }` 引用它。
 */
export const CUSTOM_SCROLL_EFFECTS: Record<string, CustomScrollEffectResolver> = {};
