import type { NewMemory } from '../../core/types';
import { getActivePreset } from '../../core/preset/store';

/**
 * 把「当前激活 GAL 角色」归属到模型自动沉淀的记忆上（characterId）。
 *
 * 只在模型经 memory 工具落库的路径调用：
 * - 模型在角色扮演对话中主动记住的内容 → 自动归入该角色的记忆空间（记忆跟着角色走）；
 * - 用户经 sidepanel / gal 界面手动添加的记忆不走这里，归属由调用方显式给出；
 * - 未激活任何带 characterId 的预设（普通 deepseek-pp 模式）→ 原样返回，行为不变。
 */
export async function attributeMemoryToActiveCharacter(
  memory: NewMemory,
): Promise<NewMemory> {
  const preset = await getActivePreset();
  const characterId = preset?.characterId && preset.characterId.trim() !== ''
    ? preset.characterId.trim()
    : null;
  if (!characterId) return memory;
  return { ...memory, characterId };
}
