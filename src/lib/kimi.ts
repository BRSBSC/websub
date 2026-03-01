import { AppError, createHttpError } from "./errors";
import { normalizeSummaryMarkdown } from "./markdown";
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

type StreamExtraction = {
  text: string;
  role: string;
  event: string;
};

function buildKimiHeaders(token?: string): Headers {
  const headers = new Headers();
  headers.set("x-msh-platform", "web");
  headers.set("x-msh-version", "1.0.0");
  headers.set("R-Timezone", Intl.DateTimeFormat().resolvedOptions().timeZone);
  if (token?.trim()) {
    headers.set("Authorization", `Bearer ${token.trim()}`);
  }
  return headers;
}

function ensureAuthError(status?: number): AppError {
  return new AppError(KIMI_AUTH_ERROR_MESSAGE, {
    code: "AUTH",
    status
  });
}

function isAuthLikeError(error: unknown): boolean {
  return (
    error instanceof AppError &&
    (error.code === "AUTH" || error.status === 401 || error.status === 403)
  );
}

function normalizeToken(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function asRawText(input: unknown): string {
  return typeof input === "string" ? input : "";
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
    method: "GET",
    headers: buildKimiHeaders(safeRefreshToken)
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
    const headers = buildKimiHeaders(accessToken);
    const originHeaders = new Headers(input.init.headers);
    originHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
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
    } catch (error) {
      if (isAuthLikeError(error)) {
        await input.onAuthInvalid();
        throw ensureAuthError(401);
      }
      throw error;
    }
  }

  let response = await execute(currentTokens.accessToken ?? "");
  if (response.status !== 401 && response.status !== 403) {
    return response;
  }

  try {
    await refreshOnce();
  } catch (error) {
    if (isAuthLikeError(error)) {
      await input.onAuthInvalid();
      throw ensureAuthError(401);
    }
    throw error;
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
    asRawText(data.text),
    asRawText(data.delta),
    asRawText(data.content),
    asRawText(data.reply)
  ].find((item) => item.length > 0);
  if (direct && direct.length > 0) {
    return direct;
  }

  const nestedKeys = ["data", "message", "delta", "result"];
  for (const key of nestedKeys) {
    const nested = data[key];
    if (!nested || typeof nested !== "object") {
      continue;
    }

    const nestedText = [
      asRawText((nested as JsonRecord).text),
      asRawText((nested as JsonRecord).delta),
      asRawText((nested as JsonRecord).content)
    ].find((item) => item.length > 0);
    if (nestedText && nestedText.length > 0) {
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
        const deltaText = asRawText((fromDelta as JsonRecord).content);
        if (deltaText.length > 0) {
          return deltaText;
        }
      }

      const fromMessage = choiceData.message;
      if (fromMessage && typeof fromMessage === "object") {
        const messageText = asRawText((fromMessage as JsonRecord).content);
        if (messageText.length > 0) {
          return messageText;
        }
      }
    }
  }

  return "";
}

function extractStreamRole(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const data = payload as JsonRecord;
  const roleCandidates = [
    normalizeToken(data.role),
    normalizeToken((data.data as JsonRecord | undefined)?.role),
    normalizeToken((data.message as JsonRecord | undefined)?.role),
    normalizeToken((data.delta as JsonRecord | undefined)?.role),
    normalizeToken((data.result as JsonRecord | undefined)?.role)
  ].filter(Boolean);
  if (roleCandidates.length > 0) {
    return roleCandidates[0].toLowerCase();
  }

  const choices = data.choices;
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      if (!choice || typeof choice !== "object") {
        continue;
      }

      const choiceData = choice as JsonRecord;
      const choiceRole = normalizeToken((choiceData.delta as JsonRecord | undefined)?.role)
        || normalizeToken((choiceData.message as JsonRecord | undefined)?.role)
        || normalizeToken(choiceData.role);
      if (choiceRole) {
        return choiceRole.toLowerCase();
      }
    }
  }

  return "";
}

function extractStreamEvent(payload: unknown, sseEventName: string): string {
  if (sseEventName.trim()) {
    return sseEventName.trim().toLowerCase();
  }

  if (!payload || typeof payload !== "object") {
    return "";
  }

  const data = payload as JsonRecord;
  return (
    normalizeToken(data.event).toLowerCase()
    || normalizeToken((data.data as JsonRecord | undefined)?.event).toLowerCase()
    || normalizeToken(data.type).toLowerCase()
  );
}

function extractStreamPiece(payload: unknown, sseEventName: string): StreamExtraction {
  return {
    text: extractStreamText(payload),
    role: extractStreamRole(payload),
    event: extractStreamEvent(payload, sseEventName)
  };
}

function findOverlapSuffixPrefix(current: string, next: string): number {
  const max = Math.min(current.length, next.length);
  for (let len = max; len > 0; len -= 1) {
    if (current.slice(-len) === next.slice(0, len)) {
      return len;
    }
  }
  return 0;
}

function mergeStreamChunk(current: string, next: string): string {
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }

  if (next === current) {
    return current;
  }

  // Some providers stream cumulative full text; keep the newest full chunk.
  if (next.startsWith(current)) {
    return next;
  }
  if (current.startsWith(next)) {
    return current;
  }

  // Avoid duplication caused by overlapping chunk boundaries.
  const overlap = findOverlapSuffixPrefix(current, next);
  if (overlap > 0) {
    return `${current}${next.slice(overlap)}`;
  }

  return `${current}${next}`;
}

function shouldUseAsAssistantChunk(piece: StreamExtraction): boolean {
  const role = piece.role;
  if (role === "assistant" || role === "model" || role === "bot") {
    return true;
  }
  if (role === "user" || role === "system") {
    return false;
  }

  const eventName = piece.event;
  if (!eventName) {
    return false;
  }

  if (/(request|req|input|prompt|user)/i.test(eventName)) {
    return false;
  }
  if (/(completion|cmpl|assistant|reply|delta|token|output|answer)/i.test(eventName)) {
    return true;
  }

  return false;
}

function stripPromptEcho(text: string, prompt: string): string {
  let output = text.trim();
  const cleanPrompt = prompt.trim();
  if (!output) {
    return output;
  }

  if (cleanPrompt && output.includes(cleanPrompt)) {
    output = output.split(cleanPrompt).join("").trim();
  }

  const noisyPrefixes = [
    "请严格遵循以下要求进行网页总结。",
    "【系统要求】",
    "【用户请求】",
    "请总结以下网页内容："
  ];
  for (const prefix of noisyPrefixes) {
    if (output.startsWith(prefix)) {
      const lastIdx = output.lastIndexOf(prefix);
      if (lastIdx > 0) {
        output = output.slice(lastIdx).trim();
      }
    }
  }

  return output;
}

function normalizeMarkdownLayout(text: string): string {
  let output = text.replace(/\r\n/g, "\n");

  // Ensure heading markers are valid Markdown: `## Heading`
  output = output.replace(/^(#{1,6})([^\s#])/gm, "$1 $2");
  output = output.replace(/[ \t]+\n/g, "\n");

  // Convert malformed single-line "table-like" output into readable list items.
  output = output
    .split("\n")
    .map((line) => {
      const pipeCount = (line.match(/\|/g) ?? []).length;
      if (pipeCount < 4) {
        return line;
      }

      const isTableSeparator = /^\s*\|?\s*:?-{3,}/.test(line);
      if (isTableSeparator) {
        return line;
      }

      const parts = line
        .split("|")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (parts.length < 2) {
        return line;
      }

      return `- ${parts.join("； ")}`;
    })
    .join("\n");

  // Keep visual rhythm around headings.
  output = output.replace(/([^\n])\n(#{1,6}\s)/g, "$1\n\n$2");
  output = output.replace(/^(#{1,6}\s[^\n]+)\n(?!\n|#|- |\d+\. |\|)/gm, "$1\n\n");
  output = output.replace(/\n{3,}/g, "\n\n");

  return output.trim();
}

async function collectStreamContent(response: Response, prompt: string): Promise<string> {
  if (!response.body) {
    const payload = await parseJsonSafe(response);
    const text = extractStreamText(payload);
    if (text) {
      return normalizeSummaryMarkdown(stripPromptEcho(text, prompt));
    }
    throw new AppError("Kimi 返回内容为空，请重试。", { code: "RUNTIME" });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let done = false;
  let buffer = "";
  let allText = "";
  let assistantText = "";
  let currentEventName = "";

  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        currentEventName = "";
        continue;
      }

      if (line.startsWith("event:")) {
        currentEventName = line.slice(6).trim();
        continue;
      }

      if (!line.startsWith("data:")) {
        continue;
      }

      const payloadText = line.slice(5).trim();
      if (!payloadText || payloadText === "[DONE]") {
        continue;
      }

      try {
        const payload = JSON.parse(payloadText) as unknown;
        const piece = extractStreamPiece(payload, currentEventName);
        if (!piece.text) {
          continue;
        }

        allText = mergeStreamChunk(allText, piece.text);
        if (shouldUseAsAssistantChunk(piece)) {
          assistantText = mergeStreamChunk(assistantText, piece.text);
        }
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
        const payload = JSON.parse(payloadText) as unknown;
        const piece = extractStreamPiece(payload, currentEventName);
        if (piece.text) {
          allText = mergeStreamChunk(allText, piece.text);
          if (shouldUseAsAssistantChunk(piece)) {
            assistantText = mergeStreamChunk(assistantText, piece.text);
          }
        }
      } catch {
        // Ignore malformed trailing chunk.
      }
    }
  }

  const primary = assistantText.trim().length > 0 ? assistantText : allText;
  return normalizeSummaryMarkdown(stripPromptEcho(primary, prompt));
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

    const summary = await collectStreamContent(response, input.content);
    if (summary) {
      return summary;
    }
  }

  throw new AppError("Kimi 返回内容为空，请重试。", { code: "RUNTIME" });
}
