import type { LocaleSchema } from '../types';
import { common } from './zh-CN/common';
import { manifest } from './zh-CN/manifest';
import { app } from './zh-CN/app';
import { locale } from './zh-CN/locale';
import { sidepanel } from './zh-CN/sidepanel';
import { content } from './zh-CN/content';
import { background } from './zh-CN/background';
import { tool } from './zh-CN/tool';
import { prompt } from './zh-CN/prompt';
import { pet } from './zh-CN/pet';

export const zhCN = {
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
} as const;

export type LocaleMessages = LocaleSchema<typeof zhCN>;
