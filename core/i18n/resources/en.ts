import type { LocaleMessages } from './zh-CN';
import { common } from './en/common';
import { manifest } from './en/manifest';
import { app } from './en/app';
import { locale } from './en/locale';
import { sidepanel } from './en/sidepanel';
import { content } from './en/content';
import { background } from './en/background';
import { tool } from './en/tool';
import { prompt } from './en/prompt';
import { pet } from './en/pet';

export const en = {
  common,
  manifest,
  app,
  locale,
  sidepanel,
  content,
  background,
  tool,
  prompt,
  pet,
} as const satisfies LocaleMessages;
