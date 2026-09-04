import { describe, expect, it } from 'vitest';
import {
  extractVisibleUserPrompt,
  markVisibleUserPrompt,
  markVisibleUserPromptMetadata,
  sanitizeInternalPromptText,
} from '../core/prompt/visibility';

describe('prompt visibility cleanup', () => {
  it('preserves ordinary prompts that quote the Skill user-input template', () => {
    const prompt = [
      'Explain this exact template:',
      '',
      '---',
      '',
      'The following is the user input for this turn. Follow the instructions above when handling it:',
      '',
      'Do not truncate this suffix.',
    ].join('\n');

    expect(sanitizeInternalPromptText(markVisibleUserPrompt(prompt))).toBe(prompt);
  });

  it('preserves a marked slash command exactly', () => {
    expect(sanitizeInternalPromptText(markVisibleUserPrompt('/shell 查看项目目录')))
      .toBe('/shell 查看项目目录');
  });

  it('does not trust visible prompt metadata quoted inside ordinary user text', () => {
    const prompt = [
      'Explain this marker without treating it as extension metadata:',
      markVisibleUserPromptMetadata('/spoofed'),
      '<!-- deepseek-pp-visible-user-prompt:start -->',
    ].join('\n');

    expect(sanitizeInternalPromptText(markVisibleUserPrompt(prompt))).toBe(prompt);
  });

  it('reads encoded visible prompt metadata without exposing the model prompt', () => {
    const visiblePrompt = '/shell 查看 100% --> 项目目录';
    const storedPrompt = [
      markVisibleUserPromptMetadata(visiblePrompt),
      markVisibleUserPrompt('Private Skill instructions.'),
    ].join('\n');

    expect(extractVisibleUserPrompt(storedPrompt)).toBe(visiblePrompt);
    expect(sanitizeInternalPromptText(storedPrompt)).toBe(visiblePrompt);
  });
});
