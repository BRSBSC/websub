import { AppError, createHttpError } from "./errors";
import type { KimiTokens } from "./types";

const KIMI_ORIGIN = "https://www.kimi.com";
const REQUEST_TIMEOUT_MS = 30_000;

export const KIMI_MODEL_NAME = "kimi-web";
export const KIMI_AUTH_ERROR_MESSAGE = "登录状态失效，请重新连接 Kimi";

type JsonRecord = Record<string, unknown>;

type RequestWithAuthInput = {
  tokens: KimiTokens;
  path: string;
  init: RequestInit;
  onTokens: (tokens: KimiTokens) => Promise<void> | void;
  onAuthInvalid: () => Promise<void> | void;
};

type ChatCreateResult = {
  chatId: string;
};

type UploadFileResult = {
  fileId: string;
};

type ParseProcessResult = {
  processId?: string;
};

type SendMessageStreamInput = {
  tokens: KimiTokens;
  chatId: string;
  content: string;
  references?: Array<{ file_id: string; parse_process_id?: string }>;
  onTokens: (tokens: KimiTokens) => Promise<void> | void;
  onAuthInvalid: () => Promise<void> | void;
};

function ensureAuthError(status?: number): AppError {
  return new AppError(KIMI_AUTH_ERROR_MESSAGE, {
    code: "AUTH",
    status
  });
}

function normalizeToken(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
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

    throw new AppError("网络连接失败，请检查网络后重试。", { code: "NETWORK" });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getStringField(payload: unknown, keys: string[]): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const data = payload as JsonRecord;
  for (const key of keys) {
    const direct = normalizeToken(data[key]);
    if (direct) {
      return direct;
    }
  }

  const nested = data.data;
  if (nested && typeof nested === "object") {
    for (const key of keys) {
      const value = normalizeToken((nested as JsonRecord)[key]);
      if (value) {
        return value;
      }
    }
  }

  return "";
}

async function parseErrorDetail(response: Response): Promise<string | undefined> {
  const payload = await parseJsonSafe(response);
  const detail = getStringField(payload, ["message", "msg", "error", "detail"]);
  return detail || undefined;
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const safeRefreshToken = refreshToken.trim();
  if (!safeRefreshToken) {
    throw ensureAuthError(401);
  }

  const response = await fetchWithTimeout(`${KIMI_ORIGIN}/api/auth/token/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      refresh_token: safeRefreshToken
    })
  });

  if (response.status === 401 || response.status === 403) {
    throw ensureAuthError(response.status);
  }

  if (!response.ok) {
    throw createHttpError(response.status, await parseErrorDetail(response));
  }

  const payload = await parseJsonSafe(response);
  const accessToken = getStringField(payload, ["access_token", "accessToken", "token"]);
  const nextRefreshToken = getStringField(payload, ["refresh_token", "refreshToken"]) || safeRefreshToken;
  if (!accessToken) {
    throw new AppError("Kimi 授权失败，请重新连接。", { code: "AUTH" });
  }

  return {
    accessToken,
    refreshToken: nextRefreshToken
  };
}

export async function requestWithAuth(input: RequestWithAuthInput): Promise<Response> {
  let currentTokens = { ...input.tokens };

  const execute = async (accessToken: string): Promise<Response> => {
    const headers = new Headers(input.init.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    return fetchWithTimeout(`${KIMI_ORIGIN}${input.path}`, {
      ...input.init,
      headers
    });
  };

  const refreshOnce = async (): Promise<void> => {
    const refreshed = await refreshAccessToken(currentTokens.refreshToken);
    currentTokens = {
      refreshToken: refreshed.refreshToken,
      accessToken: refreshed.accessToken,
      updatedAt: new Date().toISOString()
    };
    await input.onTokens(currentTokens);
  };

  if (!currentTokens.accessToken) {
    try {
      await refreshOnce();
    } catch {
      await input.onAuthInvalid();
      throw ensureAuthError(401);
    }
  }

  let response = await execute(currentTokens.accessToken ?? "");
  if (response.status !== 401 && response.status !== 403) {
    return response;
  }

  try {
    await refreshOnce();
  } catch {
    await input.onAuthInvalid();
    throw ensureAuthError(401);
  }

  response = await execute(currentTokens.accessToken ?? "");
  if (response.status === 401 || response.status === 403) {
    await input.onAuthInvalid();
    throw ensureAuthError(response.status);
  }

  return response;
}

export async function createChat(input: {
  tokens: KimiTokens;
  onTokens: (tokens: KimiTokens) => Promise<void> | void;
  onAuthInvalid: () => Promise<void> | void;
}): Promise<ChatCreateResult> {
  const response = await requestWithAuth({
    tokens: input.tokens,
    path: "/api/chat",
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "网页总结",
        born_from: "chat"
      })
    },
    onTokens: input.onTokens,
    onAuthInvalid: input.onAuthInvalid
  });

  if (!response.ok) {
    throw createHttpError(response.status, await parseErrorDetail(response));
  }

  const payload = await parseJsonSafe(response);
  const chatId = getStringField(payload, ["id", "chat_id", "chatId", "conversation_id"]);
  if (!chatId) {
    throw new AppError("Kimi 会话创建失败，请重试。", { code: "RUNTIME" });
  }

  return { chatId };
}

export async function uploadFile(input: {
  tokens: KimiTokens;
  filename: string;
  content: string;
  onTokens: (tokens: KimiTokens) => Promise<void> | void;
  onAuthInvalid: () => Promise<void> | void;
}): Promise<UploadFileResult> {
  const formData = new FormData();
  formData.append("file", new Blob([input.content], { type: "text/markdown;charset=utf-8" }), input.filename);

  const response = await requestWithAuth({
    tokens: input.tokens,
    path: "/api/file/upload",
    init: {
      method: "POST",
      body: formData
    },
    onTokens: input.onTokens,
    onAuthInvalid: input.onAuthInvalid
  });

  if (!response.ok) {
    throw createHttpError(response.status, await parseErrorDetail(response));
  }

  const payload = await parseJsonSafe(response);
  const fileId = getStringField(payload, ["id", "file_id", "fileId"]);
  if (!fileId) {
    throw new AppError("Kimi 文件上传失败，请重试。", { code: "RUNTIME" });
  }

  return { fileId };
}

export async function parseProcess(input: {
  tokens: KimiTokens;
  fileId: string;
  onTokens: (tokens: KimiTokens) => Promise<void> | void;
  onAuthInvalid: () => Promise<void> | void;
}): Promise<ParseProcessResult> {
  const response = await requestWithAuth({
    tokens: input.tokens,
    path: "/api/file/parse_process",
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        file_id: input.fileId
      })
    },
    onTokens: input.onTokens,
    onAuthInvalid: input.onAuthInvalid
  });

  if (!response.ok) {
    throw createHttpError(response.status, await parseErrorDetail(response));
  }

  const payload = await parseJsonSafe(response);
  const processId = getStringField(payload, ["id", "parse_process_id", "process_id", "parseProcessId"]);
  return { processId: processId || undefined };
}

function extractStreamText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const data = payload as JsonRecord;
  const direct = [
    normalizeToken(data.text),
    normalizeToken(data.delta),
    normalizeToken(data.content),
    normalizeToken(data.reply)
  ].find(Boolean);
  if (direct) {
    return direct;
  }

  const nestedKeys = ["data", "message", "delta", "result"];
  for (const key of nestedKeys) {
    const nested = data[key];
    if (!nested || typeof nested !== "object") {
      continue;
    }

    const nestedText = [
      normalizeToken((nested as JsonRecord).text),
      normalizeToken((nested as JsonRecord).delta),
      normalizeToken((nested as JsonRecord).content)
    ].find(Boolean);
    if (nestedText) {
      return nestedText;
    }
  }

  const choices = data.choices;
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      if (!choice || typeof choice !== "object") {
        continue;
      }

      const choiceData = choice as JsonRecord;
      const fromDelta = choiceData.delta;
      if (fromDelta && typeof fromDelta === "object") {
        const deltaText = normalizeToken((fromDelta as JsonRecord).content);
        if (deltaText) {
          return deltaText;
        }
      }

      const fromMessage = choiceData.message;
      if (fromMessage && typeof fromMessage === "object") {
        const messageText = normalizeToken((fromMessage as JsonRecord).content);
        if (messageText) {
          return messageText;
        }
      }
    }
  }

  return "";
}

async function collectStreamContent(response: Response): Promise<string> {
  if (!response.body) {
    const payload = await parseJsonSafe(response);
    const text = extractStreamText(payload);
    if (text) {
      return text;
    }
    throw new AppError("Kimi 返回内容为空，请重试。", { code: "RUNTIME" });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let done = false;
  let buffer = "";
  let finalText = "";

  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || !line.startsWith("data:")) {
        continue;
      }

      const payloadText = line.slice(5).trim();
      if (!payloadText || payloadText === "[DONE]") {
        continue;
      }

      try {
        const payload = JSON.parse(payloadText) as unknown;
        finalText += extractStreamText(payload);
      } catch {
        // Ignore malformed stream chunks.
      }
    }
  }

  const tail = buffer.trim();
  if (tail.startsWith("data:")) {
    const payloadText = tail.slice(5).trim();
    if (payloadText && payloadText !== "[DONE]") {
      try {
        finalText += extractStreamText(JSON.parse(payloadText) as unknown);
      } catch {
        // Ignore malformed trailing chunk.
      }
    }
  }

  return finalText.trim();
}

export async function sendMessageStream(input: SendMessageStreamInput): Promise<string> {
  const endpoints = [
    `/api/chat/${input.chatId}/completion/stream`,
    `/api/chat/${input.chatId}/stream`
  ];

  for (const path of endpoints) {
    const response = await requestWithAuth({
      tokens: input.tokens,
      path,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream"
        },
        body: JSON.stringify({
          kimiplus_id: "kimi",
          use_search: false,
          stream: true,
          refs: input.references ?? [],
          messages: [{ role: "user", content: input.content }]
        })
      },
      onTokens: input.onTokens,
      onAuthInvalid: input.onAuthInvalid
    });

    if (response.status === 404) {
      continue;
    }

    if (!response.ok) {
      throw createHttpError(response.status, await parseErrorDetail(response));
    }

    const summary = await collectStreamContent(response);
    if (summary) {
      return summary;
    }
  }

  throw new AppError("Kimi 返回内容为空，请重试。", { code: "RUNTIME" });
}
