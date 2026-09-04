import { describe, expect, it } from "vitest";
import { normalizeInlineAgentNativeMarkdown } from "../core/inline-agent/native-markdown";

describe("inline-agent native markdown normalization", () => {
  it("canonicalizes xychart shorthand without touching other fenced blocks", () => {
    const markdown = [
      "before",
      "````html",
      '<script>const fence = "```";</script>',
      "````",
      "```xychart-beta",
      'title "Revenue"',
      "line [1, 2, 3]",
      "```",
      "```xychart",
      "xychart-beta",
      "bar [3, 2, 1]",
      "```",
      "after",
    ].join("\n");

    expect(normalizeInlineAgentNativeMarkdown(markdown)).toBe(
      [
        "before",
        "````html",
        '<script>const fence = "```";</script>',
        "````",
        "```mermaid",
        "xychart-beta",
        'title "Revenue"',
        "line [1, 2, 3]",
        "```",
        "```mermaid",
        "xychart-beta",
        "bar [3, 2, 1]",
        "```",
        "after",
      ].join("\n"),
    );
  });

  it("preserves CRLF and normalizes an unterminated final chart fence", () => {
    expect(
      normalizeInlineAgentNativeMarkdown("```xychart-beta\r\nline [1, 2]"),
    ).toBe("```mermaid\r\nxychart-beta\r\nline [1, 2]");
  });

  it("replaces a legacy xychart body directive instead of emitting two directives", () => {
    const markdown = [
      "```xychart-beta",
      "xychart",
      '    title "Live regression"',
      '    x-axis ["1", "2", "3"]',
      "    line [1, 2, 3]",
      "```",
    ].join("\n");

    expect(normalizeInlineAgentNativeMarkdown(markdown)).toBe(
      [
        "```mermaid",
        "xychart-beta",
        '    title "Live regression"',
        '    x-axis ["1", "2", "3"]',
        "    line [1, 2, 3]",
        "```",
      ].join("\n"),
    );
  });

  it("normalizes an indented chart fence with a longer legal closing fence", () => {
    const markdown = [
      "  ```XYCHART-BETA extra-info",
      'title "Indented"',
      "line [1, 2]",
      "   ````",
      "",
      "```mermaid",
      "xychart-beta",
      "bar [2, 1]",
      "```",
    ].join("\n");

    expect(normalizeInlineAgentNativeMarkdown(markdown)).toBe(
      [
        "  ```mermaid",
        "xychart-beta",
        'title "Indented"',
        "line [1, 2]",
        "   ````",
        "",
        "```mermaid",
        "xychart-beta",
        "bar [2, 1]",
        "```",
      ].join("\n"),
    );
  });
});
