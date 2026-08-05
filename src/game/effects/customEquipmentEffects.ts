import type {
  CustomEquipmentEffectResolver,
} from "./cardEffects";

/** 特殊装备的生命周期代码扩展点；普通数值装备无需在这里注册。 */
export const CUSTOM_EQUIPMENT_EFFECTS: Record<string, CustomEquipmentEffectResolver> = {};
