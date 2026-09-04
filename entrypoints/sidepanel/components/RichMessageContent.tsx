import { useLayoutEffect } from 'react';
import ReactMarkdown from 'react-markdown';

interface RichMessageContentProps {
  text: string;
  onRendered?: () => void;
}

export default function RichMessageContent({ text, onRendered }: RichMessageContentProps) {
  useLayoutEffect(() => {
    onRendered?.();
  }, [onRendered]);

  return <ReactMarkdown>{text}</ReactMarkdown>;
}
