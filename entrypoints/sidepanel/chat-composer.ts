export interface ChatComposerKeydown {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
}

export function shouldSubmitChatComposer(event: ChatComposerKeydown): boolean {
  return event.key === 'Enter' &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229;
}
