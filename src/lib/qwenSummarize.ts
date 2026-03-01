import { AppError } from "./errors";
import {
  QWEN_MODEL_NAME,
  checkAuth,
  createChat,
  sendMessageStream
} from "./qwen";
import { ensureQwenToken, invalidateQwenTokens } from "./qwenAuth";
import { buildSummaryMessages } from "./prompt";
import { saveQwenTokens } from "./storage";
import type { PageContent, Settings } from "./types";

type SummarizeContext = {
  pageContent: PageContent;
  settings: Settings;
};

function buildQwenUserContent(pageContent: PageContent, settings: Settings): string {
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

function isAuthError(error: unknown): boolean {
  return error instanceof AppError && error.code === "AUTH";
}

export async function summarizeWithQwen(context: SummarizeContext): Promise<string> {
  let tokenState = await ensureQwenToken();

  try {
    const auth = await checkAuth(tokenState);
    if (auth.account && auth.account !== tokenState.account) {
      tokenState = await saveQwenTokens({
        token: tokenState.token,
        account: auth.account
      });
    }

    const { chatId } = await createChat({
      tokens: tokenState
    });

    return sendMessageStream({
      tokens: tokenState,
      chatId,
      content: buildQwenUserContent(context.pageContent, context.settings)
    });
  } catch (error) {
    if (isAuthError(error)) {
      await invalidateQwenTokens();
    }
    throw error;
  }
}

export function getQwenDisplayModel(): string {
  return QWEN_MODEL_NAME;
}
