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

function isPipeRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line.trim());
}

function normalizeHeadingSpacing(line: string): string {
  return line.replace(/^(\s{0,3}#{1,6})([^\s#])/g, "$1 $2");
}

function normalizePipeHeavyLine(line: string): string {
  const pipeCount = (line.match(/\|/g) ?? []).length;
  if (pipeCount < 4) {
    return line;
  }

  const segments = line
    .split("|")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .filter((segment) => !/^:?-{3,}:?$/.test(segment));
  if (segments.length < 2) {
    return line;
  }

  return `- ${segments.join("；")}`;
}

export function normalizeSummaryMarkdown(markdown: string): string {
  if (!markdown.trim()) {
    return markdown;
  }

  const input = markdown.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  const lines = input.split("\n");
  const normalizedLines: string[] = [];
  let inTable = false;

  for (let index = 0; index < lines.length; index += 1) {
    const current = normalizeHeadingSpacing(lines[index]);
    const next = index + 1 < lines.length ? lines[index + 1] : "";

    if (inTable) {
      if (isPipeRow(current) || isTableSeparator(current)) {
        normalizedLines.push(current);
        continue;
      }
      inTable = false;
    }

    if (isPipeRow(current) && isTableSeparator(next)) {
      normalizedLines.push(current);
      inTable = true;
      continue;
    }

    if (!inTable) {
      normalizedLines.push(normalizePipeHeavyLine(current));
      continue;
    }

    normalizedLines.push(current);
  }

  return normalizedLines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/([^\n])\n(#{1,6}\s)/g, "$1\n\n$2")
    .replace(/^(#{1,6}\s[^\n]+)\n(?!\n|#|- |\* |\+ |\d+\. |> |\|)/gm, "$1\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripMarkdown(markdown: string): string {
  return MARKDOWN_CLEANUP_RULES.reduce((result, rule) => {
    return result.replace(rule.pattern, rule.replace);
  }, markdown);
}

export function toPlainPreview(markdown: string, maxLength = 160): string {
  const clean = stripMarkdown(normalizeSummaryMarkdown(markdown)).trim();
  if (clean.length <= maxLength) {
    return clean || "（无内容）";
  }

  return `${clean.slice(0, maxLength).trim()}...`;
}
