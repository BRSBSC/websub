import { AppError, createHttpError } from "./errors";
import { buildSummaryMessages } from "./prompt";
import type { PageContent, Settings } from "./types";

const REQUEST_TIMEOUT_MS = 30_000;

type ModelListResponse = {
  data?: Array<{ id?: string }>;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function buildAuthHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey.trim()}`
  };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new AppError("请求超时，请重试。", { code: "TIMEOUT" });
    }

    throw new AppError("网络连接失败，请检查 API 地址或网络状态。", {
      code: "NETWORK"
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function parseErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const data = (await response.json()) as { error?: { message?: string } };
    return data.error?.message;
  } catch {
    return undefined;
  }
}

export async function fetchModels(input: {
  apiBaseUrl: string;
  apiKey: string;
}): Promise<string[]> {
  const apiBaseUrl = normalizeBaseUrl(input.apiBaseUrl);
  const apiKey = input.apiKey.trim();

  if (!apiBaseUrl) {
    throw new AppError("请先填写 API 地址。", { code: "VALIDATION" });
  }

  if (!apiKey) {
    throw new AppError("请先填写 API Key。", { code: "VALIDATION" });
  }

  const response = await fetchWithTimeout(`${apiBaseUrl}/v1/models`, {
    method: "GET",
    headers: buildAuthHeaders(apiKey)
  });

  if (!response.ok) {
    throw createHttpError(response.status, await parseErrorDetail(response));
  }

  const data = (await response.json()) as ModelListResponse;
  const models = (data.data ?? [])
    .map((item) => item.id?.trim() ?? "")
    .filter((id) => id.length > 0)
    .sort((a, b) => a.localeCompare(b));

  if (models.length === 0) {
    throw new AppError("模型列表为空，请手动输入模型名称。", { code: "RUNTIME" });
  }

  return models;
}

function normalizeCompletionText(content: string | Array<{ text?: string }> | undefined): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((chunk) => chunk.text?.trim() ?? "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

export async function summarizePage(input: {
  settings: Settings;
  pageContent: PageContent;
}): Promise<string> {
  const apiBaseUrl = normalizeBaseUrl(input.settings.apiBaseUrl);
  const apiKey = input.settings.apiKey.trim();
  const model = input.settings.model.trim();

  if (!apiBaseUrl || !apiKey || !model) {
    throw new AppError("请先在设置中填写 API 地址、API Key 和模型。", {
      code: "VALIDATION"
    });
  }

  const response = await fetchWithTimeout(`${apiBaseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: buildAuthHeaders(apiKey),
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.3,
      messages: buildSummaryMessages(input.pageContent, input.settings)
    })
  });

  if (!response.ok) {
    throw createHttpError(response.status, await parseErrorDetail(response));
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const content = normalizeCompletionText(
    data.choices?.[0]?.message?.content as string | Array<{ text?: string }> | undefined
  );

  if (!content) {
    throw new AppError("模型返回内容为空，请重试。", { code: "RUNTIME" });
  }

  return content;
}
