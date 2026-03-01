import { AppError } from "./errors";
import {
  KIMI_MODEL_NAME,
  createChat,
  parseProcess,
  sendMessageStream,
  uploadFile
} from "./kimi";
import { ensureKimiRefreshToken, invalidateKimiTokens } from "./kimiAuth";
import { buildSummaryMessages } from "./prompt";
import { saveKimiTokens } from "./storage";
import type { PageContent, Settings } from "./types";

const FILE_FIRST_URL_PATTERNS: RegExp[] = [
  /\.pdf(?:$|[?#])/i,
  /(?:youtube\.com|youtu\.be|bilibili\.com|vimeo\.com)/i,
  /arxiv\.org/i
];

function shouldPreferFileMode(url: string): boolean {
  return FILE_FIRST_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function buildKimiUserContent(pageContent: PageContent, settings: Settings): string {
  const messages = buildSummaryMessages(pageContent, settings);
  const systemPrompt = messages.find((message) => message.role === "system")?.content.trim() ?? "";
  const userPrompt = messages.find((message) => message.role === "user")?.content.trim() ?? "";

  return [
    "请严格遵循以下要求进行网页总结。",
    "输出格式要求（必须遵守）：",
    "1) 使用标准 Markdown。",
    "2) 标题必须写成 `## 标题`（# 后要有空格）。",
    "3) 用有序/无序列表表达要点，不要使用表格语法（不要用 `|` 组织表格）。",
    "4) 段落之间空一行，避免大段连续文本。",
    "【系统要求】",
    systemPrompt,
    "【用户请求】",
    userPrompt
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");
}

function sanitizeFilename(input: string): string {
  const normalized = input.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const fallback = normalized.length > 0 ? normalized : "webpage";
  return `${fallback.slice(0, 48)}.md`;
}

function buildMarkdownPayload(pageContent: PageContent): string {
  return [
    `# ${pageContent.title || "未命名网页"}`,
    "",
    `- URL: ${pageContent.url}`,
    `- Extracted At: ${pageContent.extractedAt}`,
    "",
    "## Content",
    "",
    pageContent.text
  ].join("\n");
}

function isAuthError(error: unknown): boolean {
  return error instanceof AppError && error.code === "AUTH";
}

type SummarizeContext = {
  pageContent: PageContent;
  settings: Settings;
};

export async function summarizeWithKimi(context: SummarizeContext): Promise<string> {
  let tokenState = await ensureKimiRefreshToken();

  const onTokens = async (nextTokens: typeof tokenState) => {
    tokenState = nextTokens;
    await saveKimiTokens(nextTokens);
  };
  const onAuthInvalid = async () => {
    await invalidateKimiTokens();
  };

  const runTextPath = async (): Promise<string> => {
    const { chatId } = await createChat({
      tokens: tokenState,
      onTokens,
      onAuthInvalid
    });

    return sendMessageStream({
      tokens: tokenState,
      chatId,
      content: buildKimiUserContent(context.pageContent, context.settings),
      onTokens,
      onAuthInvalid
    });
  };

  const runFilePath = async (): Promise<string> => {
    const { fileId } = await uploadFile({
      tokens: tokenState,
      filename: sanitizeFilename(context.pageContent.title),
      content: buildMarkdownPayload(context.pageContent),
      onTokens,
      onAuthInvalid
    });

    const parsed = await parseProcess({
      tokens: tokenState,
      fileId,
      onTokens,
      onAuthInvalid
    });

    const { chatId } = await createChat({
      tokens: tokenState,
      onTokens,
      onAuthInvalid
    });

    return sendMessageStream({
      tokens: tokenState,
      chatId,
      content: buildKimiUserContent(context.pageContent, context.settings),
      references: [
        {
          file_id: fileId,
          parse_process_id: parsed.processId
        }
      ],
      onTokens,
      onAuthInvalid
    });
  };

  if (shouldPreferFileMode(context.pageContent.url)) {
    try {
      return await runFilePath();
    } catch (error) {
      if (isAuthError(error)) {
        throw error;
      }

      return runTextPath();
    }
  }

  return runTextPath();
}

export function getKimiDisplayModel(): string {
  return KIMI_MODEL_NAME;
}
