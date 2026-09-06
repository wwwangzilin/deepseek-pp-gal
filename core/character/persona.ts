import type { GalCharacter } from '../types';

type PersonaFields = Pick<
  GalCharacter,
  'name' | 'description' | 'personality' | 'scenario' | 'exampleDialogue' | 'systemPrompt'
>;

/**
 * Renders a character card into the persona prompt injected in front of the
 * augmented request while the character is active. Pure function, shared by
 * the background (state broadcast), the content interceptor (injection) and
 * the sidepanel (preview). The framing copy intentionally follows the card's
 * authored language (fork is single-locale Simplified Chinese).
 */
export function buildCharacterPersona(char: PersonaFields | null | undefined): string {
  if (!char || !char.name) return '';
  const parts: string[] = [];
  parts.push(
    `你是「${char.name}」。你正在 GAL 酒馆舞台上与玩家角色扮演。完全以「${char.name}」身份行动说话思考，`
    + '不跳出角色，不提你是 AI/模型/助手。',
  );
  if (char.description) parts.push(`【角色设定】\n${char.description}`);
  if (char.personality) parts.push(`【性格】\n${char.personality}`);
  if (char.scenario) parts.push(`【场景】\n${char.scenario}`);
  if (char.exampleDialogue) parts.push(`【示例对话】\n${char.exampleDialogue}`);
  if (char.systemPrompt) parts.push(char.systemPrompt);
  parts.push('回复自然口语化，短句推进剧情；只输出台词与动作。');
  return parts.join('\n\n');
}

/** Built-in seed character (shown when the character library is empty). */
export function defaultGalCharacters(): Array<Omit<GalCharacter, 'createdAt' | 'updatedAt'>> {
  return [
    {
      id: 'gal-char-deepseek-niang',
      name: 'DeepSeek娘',
      color: '#ff8fa3',
      description: 'DeepSeek 娘化形象：银白长发，深海蓝眸，温柔又天然。',
      personality: '温柔、天然、乐于助人；偶尔小迷糊，关键时刻可靠。',
      scenario: '深夜书房，屏幕微光，她歪着头等你开口。',
      exampleDialogue: '玩家：你是谁？\nDeepSeek娘：我是 DeepSeek 哦～欢迎来到我的小世界。',
      greeting: '（屏幕微光映着她的脸）欢迎回来～今天想聊点什么呀？',
      systemPrompt: '',
      memoryTags: ['DeepSeek娘', '默认'],
    },
  ];
}
