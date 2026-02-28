import { MAX_CONTENT_LENGTH, type PageContent } from "../lib/types";

type ExtractRequest = {
  type: "EXTRACT_PAGE_CONTENT";
};

type ExtractResponse =
  | { ok: true; data: PageContent }
  | { ok: false; error: string };

const BLOCKED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "SVG",
  "CANVAS",
  "VIDEO",
  "AUDIO",
  "IFRAME"
]);

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function isElementVisible(element: Element): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function collectVisibleText(root: Element): string {
  const fragments: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  let current = walker.nextNode();
  while (current) {
    const parent = current.parentElement;
    const text = normalizeWhitespace(current.textContent ?? "");

    if (
      parent &&
      text.length > 0 &&
      !BLOCKED_TAGS.has(parent.tagName) &&
      isElementVisible(parent)
    ) {
      fragments.push(text);
    }

    current = walker.nextNode();
  }

  return normalizeWhitespace(fragments.join(" "));
}

function collectParagraphText(): string {
  const seen = new Set<string>();
  const paragraphs = Array.from(document.querySelectorAll("p"));

  for (const paragraph of paragraphs) {
    if (!isElementVisible(paragraph)) {
      continue;
    }

    const text = normalizeWhitespace(paragraph.textContent ?? "");
    if (text.length >= 30) {
      seen.add(text);
    }
  }

  return normalizeWhitespace(Array.from(seen).join("\n"));
}

function pickBestText(): string {
  const articleText = (() => {
    const article = document.querySelector("article");
    return article ? collectVisibleText(article) : "";
  })();

  if (articleText.length >= 200) {
    return articleText;
  }

  const mainText = (() => {
    const main = document.querySelector("main");
    return main ? collectVisibleText(main) : "";
  })();

  if (mainText.length >= 200) {
    return mainText;
  }

  const paragraphText = collectParagraphText();
  const candidates = [articleText, mainText, paragraphText];
  return candidates.sort((a, b) => b.length - a.length)[0] ?? "";
}

function truncateText(text: string): string {
  if (text.length <= MAX_CONTENT_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_CONTENT_LENGTH)}\n\n[内容已截断]`;
}

function buildPageContent(): PageContent {
  const text = truncateText(pickBestText());

  return {
    title: document.title || "未命名页面",
    url: window.location.href,
    text,
    extractedAt: new Date().toISOString()
  };
}

chrome.runtime.onMessage.addListener(
  (message: ExtractRequest, _sender, sendResponse: (response: ExtractResponse) => void) => {
    if (message?.type !== "EXTRACT_PAGE_CONTENT") {
      return;
    }

    try {
      sendResponse({
        ok: true,
        data: buildPageContent()
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "正文提取失败。"
      });
    }
  }
);
