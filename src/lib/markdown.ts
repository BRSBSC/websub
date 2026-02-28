const MARKDOWN_CLEANUP_RULES: Array<{ pattern: RegExp; replace: string }> = [
  { pattern: /```[\s\S]*?```/g, replace: " [代码块] " },
  { pattern: /`([^`]+)`/g, replace: "$1" },
  { pattern: /!\[([^\]]*)\]\([^)]+\)/g, replace: "$1" },
  { pattern: /\[([^\]]+)\]\([^)]+\)/g, replace: "$1" },
  { pattern: /^#{1,6}\s+/gm, replace: "" },
  { pattern: /^\s{0,3}>\s?/gm, replace: "" },
  { pattern: /^\s*[-*+]\s+/gm, replace: "" },
  { pattern: /^\s*\d+\.\s+/gm, replace: "" },
  { pattern: /^\s*[-*_]{3,}\s*$/gm, replace: " " },
  { pattern: /[*_~]/g, replace: "" },
  { pattern: /\|/g, replace: " " },
  { pattern: /\n+/g, replace: " " },
  { pattern: /\s+/g, replace: " " }
];

function stripMarkdown(markdown: string): string {
  return MARKDOWN_CLEANUP_RULES.reduce((result, rule) => {
    return result.replace(rule.pattern, rule.replace);
  }, markdown);
}

export function toPlainPreview(markdown: string, maxLength = 160): string {
  const clean = stripMarkdown(markdown).trim();
  if (clean.length <= maxLength) {
    return clean || "（无内容）";
  }

  return `${clean.slice(0, maxLength).trim()}...`;
}
