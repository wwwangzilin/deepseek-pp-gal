export const VISIBLE_USER_PROMPT_START = '<!-- deepseek-pp-visible-user-prompt:start -->';
export const VISIBLE_USER_PROMPT_END = '<!-- deepseek-pp-visible-user-prompt:end -->';
const VISIBLE_USER_PROMPT_METADATA_PREFIX = '<!-- deepseek-pp-visible-user-prompt:value=';
const VISIBLE_USER_PROMPT_METADATA_SUFFIX = ' -->';

const TOOL_REMINDER_HEADING = 'Tool call format reminder:';
const TOOL_REMINDER_REQUIRED_LINE = 'Available tool tag names:';
const TOOL_REMINDER_FRAGMENT_PREFIXES = [
  TOOL_REMINDER_HEADING,
  TOOL_REMINDER_REQUIRED_LINE,
  'These listed tools are executable by the extension.',
  'To call a tool, use ONLY the direct XML tag',
  'For MCP tools, prefer the short tag name',
  'For local file paths, use forward slashes',
  'Do not use <invoke name="...">',
  'Do not put executable tool XML',
];

export function markVisibleUserPrompt(prompt: string): string {
  return `${VISIBLE_USER_PROMPT_START}\n${prompt}\n${VISIBLE_USER_PROMPT_END}`;
}

export function markVisibleUserPromptMetadata(prompt: string): string {
  return `${VISIBLE_USER_PROMPT_METADATA_PREFIX}${encodeURIComponent(JSON.stringify(prompt))}${VISIBLE_USER_PROMPT_METADATA_SUFFIX}`;
}

export function extractVisibleUserPrompt(text: string): string | null {
  const metadataPrompt = extractVisibleUserPromptMetadata(text);
  if (metadataPrompt !== null) return metadataPrompt;

  const start = text.indexOf(VISIBLE_USER_PROMPT_START);
  if (start === -1) return null;

  const contentStart = start + VISIBLE_USER_PROMPT_START.length;
  const end = text.indexOf(VISIBLE_USER_PROMPT_END, contentStart);
  if (end === -1) return null;

  return trimSingleBoundaryNewline(text.slice(contentStart, end));
}

function extractVisibleUserPromptMetadata(text: string): string | null {
  const visiblePromptStart = text.indexOf(VISIBLE_USER_PROMPT_START);
  if (visiblePromptStart === -1 || text[visiblePromptStart - 1] !== '\n') return null;

  const metadataLineEnd = visiblePromptStart - 1;
  const metadataLineStart = text.lastIndexOf('\n', metadataLineEnd - 1) + 1;
  const metadataLine = text.slice(metadataLineStart, metadataLineEnd);
  if (!metadataLine.startsWith(VISIBLE_USER_PROMPT_METADATA_PREFIX) ||
    !metadataLine.endsWith(VISIBLE_USER_PROMPT_METADATA_SUFFIX)) {
    return null;
  }

  const contentStart = VISIBLE_USER_PROMPT_METADATA_PREFIX.length;
  const contentEnd = metadataLine.length - VISIBLE_USER_PROMPT_METADATA_SUFFIX.length;

  try {
    const decoded = JSON.parse(decodeURIComponent(metadataLine.slice(contentStart, contentEnd)));
    return typeof decoded === 'string' ? decoded : null;
  } catch {
    return null;
  }
}

export function sanitizeInternalPromptText(
  text: string,
  fallbackVisiblePrompt?: string,
): string {
  const visiblePrompt = extractVisibleUserPrompt(text);
  if (visiblePrompt !== null) return visiblePrompt;

  if (isToolReminderOnly(text)) return '';

  if (containsToolFormatReminder(text)) {
    return fallbackVisiblePrompt ?? stripToolFormatReminder(text);
  }

  return text;
}

export function containsInternalPromptMarker(text: string): boolean {
  return text.includes(VISIBLE_USER_PROMPT_START) ||
    text.includes(VISIBLE_USER_PROMPT_METADATA_PREFIX) ||
    containsToolFormatReminder(text) ||
    isToolReminderOnly(text);
}

function trimSingleBoundaryNewline(text: string): string {
  let next = text;
  if (next.startsWith('\r\n')) next = next.slice(2);
  else if (next.startsWith('\n')) next = next.slice(1);

  if (next.endsWith('\r\n')) next = next.slice(0, -2);
  else if (next.endsWith('\n')) next = next.slice(0, -1);

  return next;
}

function containsToolFormatReminder(text: string): boolean {
  return text.includes(TOOL_REMINDER_HEADING) && text.includes(TOOL_REMINDER_REQUIRED_LINE);
}

function stripToolFormatReminder(text: string): string {
  const headingIndex = text.indexOf(TOOL_REMINDER_HEADING);
  if (headingIndex === -1) return text;

  const delimiterIndex = text.lastIndexOf('\n---', headingIndex);
  const cutIndex = delimiterIndex === -1 ? headingIndex : delimiterIndex;
  return text.slice(0, cutIndex).trim();
}

function isToolReminderOnly(text: string): boolean {
  const normalized = text.trimStart();
  if (!normalized) return false;

  return TOOL_REMINDER_FRAGMENT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}
