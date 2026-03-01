import { AppError, createHttpError } from "./errors";
import { normalizeSummaryMarkdown } from "./markdown";
import type { QwenTokens } from "./types";

const REQUEST_TIMEOUT_MS = 30_000;
const QWEN_REQUEST_MODEL = "qwen3.5-plus";

export const QWEN_ORIGIN = "https://chat.qwen.ai";
export const QWEN_MODEL_NAME = "qwen-web-intl";
export const QWEN_AUTH_ERROR_MESSAGE = "登录状态失效，请重新连接 Qwen";

type JsonRecord = Record<string, unknown>;

type ChatCreateResult = {
  chatId: string;
};

type AuthCheckResult = {
  account?: string;
};

type SendMessageStreamInput = {
  tokens: QwenTokens;
  chatId: string;
  content: string;
};

type StreamExtraction = {
  text: string;
  role: string;
  event: string;
};

function buildQwenHeaders(token: string, headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers);
  nextHeaders.set("Authorization", `Bearer ${token.trim()}`);
  return nextHeaders;
}

function ensureAuthError(status?: number): AppError {
  return new AppError(QWEN_AUTH_ERROR_MESSAGE, {
    code: "AUTH",
    status
  });
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

function getPayloadErrorCode(payload: unknown): string {
  return getStringField(payload, ["code", "error_code", "errorCode"]);
}

function getPayloadErrorDetail(payload: unknown): string {
  return getStringField(payload, ["details", "detail", "message", "msg", "error", "errorMsg"]);
}

function isUnauthorizedCode(code: string): boolean {
  const value = code.trim().toLowerCase();
  if (!value) {
    return false;
  }

  return value.includes("unauthorized") || value.includes("forbidden") || value.includes("token");
}

function isUnauthorizedDetail(detail: string): boolean {
  const value = detail.trim().toLowerCase();
  if (!value) {
    return false;
  }

  return (
    value.includes("unauthorized")
    || value.includes("session has expired")
    || value.includes("token is no longer valid")
    || value.includes("no permission")
  );
}

function isUnauthorizedPayload(payload: unknown): boolean {
  const code = getPayloadErrorCode(payload);
  const detail = getPayloadErrorDetail(payload);
  return isUnauthorizedCode(code) || isUnauthorizedDetail(detail);
}

function isPayloadSuccessFalse(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const success = (payload as JsonRecord).success;
  return success === false;
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

  if (next.startsWith(current)) {
    return next;
  }
  if (current.startsWith(next)) {
    return current;
  }

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

  output = output.replace(/^(#{1,6})([^\s#])/gm, "$1 $2");
  output = output.replace(/[ \t]+\n/g, "\n");
  output = output.replace(/([^\n])\n(#{1,6}\s)/g, "$1\n\n$2");
  output = output.replace(/^(#{1,6}\s[^\n]+)\n(?!\n|#|- |\d+\. |\|)/gm, "$1\n\n");
  output = output.replace(/\n{3,}/g, "\n\n");

  return output.trim();
}

function randomId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function resolvePayloadErrorMessage(payload: unknown, fallback: string): string {
  const detail = getPayloadErrorDetail(payload);
  return detail || fallback;
}

function extractResponseTextFromPayload(payload: unknown): string {
  const direct = extractStreamText(payload);
  if (direct) {
    return direct;
  }

  return "";
}

export async function checkAuth(tokens: QwenTokens): Promise<AuthCheckResult> {
  const token = tokens.token.trim();
  if (!token) {
    throw ensureAuthError(401);
  }

  const response = await fetchWithTimeout(`${QWEN_ORIGIN}/api/v1/auths/`, {
    method: "GET",
    credentials: "omit",
    headers: buildQwenHeaders(token)
  });

  if (response.status === 401 || response.status === 403) {
    throw ensureAuthError(response.status);
  }

  const payload = await parseJsonSafe(response);
  if (isUnauthorizedPayload(payload)) {
    throw ensureAuthError(401);
  }

  if (!response.ok) {
    throw createHttpError(response.status, resolvePayloadErrorMessage(payload, "Qwen 授权校验失败。"));
  }

  const account = getStringField(payload, ["email", "name"]) || undefined;
  return { account };
}

export async function createChat(input: { tokens: QwenTokens }): Promise<ChatCreateResult> {
  const token = input.tokens.token.trim();
  if (!token) {
    throw ensureAuthError(401);
  }

  const response = await fetchWithTimeout(`${QWEN_ORIGIN}/api/v2/chats/new`, {
    method: "POST",
    credentials: "omit",
    headers: buildQwenHeaders(token, {
      "Content-Type": "application/json"
    }),
    body: JSON.stringify({
      title: "网页总结",
      models: [QWEN_REQUEST_MODEL],
      chat_mode: "chat",
      chat_type: "t2t",
      timestamp: Date.now(),
      project_id: ""
    })
  });

  if (response.status === 401 || response.status === 403) {
    throw ensureAuthError(response.status);
  }

  const payload = await parseJsonSafe(response);
  if (isUnauthorizedPayload(payload)) {
    throw ensureAuthError(401);
  }

  if (!response.ok) {
    throw createHttpError(response.status, resolvePayloadErrorMessage(payload, "Qwen 会话创建失败，请重试。"));
  }

  if (isPayloadSuccessFalse(payload)) {
    throw new AppError(resolvePayloadErrorMessage(payload, "Qwen 会话创建失败，请重试。"), {
      code: "RUNTIME"
    });
  }

  const chatId = getStringField(payload, ["id"]);
  if (!chatId) {
    throw new AppError("Qwen 会话创建失败，请重试。", { code: "RUNTIME" });
  }

  return { chatId };
}

async function collectStreamContent(response: Response, prompt: string): Promise<string> {
  if (!response.body) {
    const payload = await parseJsonSafe(response);
    const text = extractResponseTextFromPayload(payload);
    if (text) {
      return normalizeSummaryMarkdown(normalizeMarkdownLayout(stripPromptEcho(text, prompt)));
    }
    throw new AppError("Qwen 返回内容为空，请重试。", { code: "RUNTIME" });
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

      let parsed: unknown = null;
      try {
        parsed = JSON.parse(payloadText);
      } catch {
        continue;
      }

      if (isUnauthorizedPayload(parsed)) {
        throw ensureAuthError(401);
      }

      const piece = extractStreamPiece(parsed, currentEventName);
      if (!piece.text) {
        continue;
      }

      allText = mergeStreamChunk(allText, piece.text);
      if (shouldUseAsAssistantChunk(piece)) {
        assistantText = mergeStreamChunk(assistantText, piece.text);
      }
    }
  }

  const tail = buffer.trim();
  if (tail.startsWith("data:")) {
    const payloadText = tail.slice(5).trim();
    if (payloadText && payloadText !== "[DONE]") {
      try {
        const parsed = JSON.parse(payloadText) as unknown;
        if (isUnauthorizedPayload(parsed)) {
          throw ensureAuthError(401);
        }

        const piece = extractStreamPiece(parsed, currentEventName);
        if (piece.text) {
          allText = mergeStreamChunk(allText, piece.text);
          if (shouldUseAsAssistantChunk(piece)) {
            assistantText = mergeStreamChunk(assistantText, piece.text);
          }
        }
      } catch (error) {
        if (error instanceof AppError && error.code === "AUTH") {
          throw error;
        }
      }
    }
  }

  const primary = assistantText.trim().length > 0 ? assistantText : allText;
  const summary = normalizeSummaryMarkdown(normalizeMarkdownLayout(stripPromptEcho(primary, prompt)));
  if (!summary) {
    throw new AppError("Qwen 返回内容为空，请重试。", { code: "RUNTIME" });
  }

  return summary;
}

export async function sendMessageStream(input: SendMessageStreamInput): Promise<string> {
  const token = input.tokens.token.trim();
  if (!token) {
    throw ensureAuthError(401);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const messageId = randomId();
  const childId = randomId();

  const response = await fetchWithTimeout(
    `${QWEN_ORIGIN}/api/v2/chat/completions?chat_id=${encodeURIComponent(input.chatId)}`,
    {
      method: "POST",
      credentials: "omit",
      headers: buildQwenHeaders(token, {
        "Content-Type": "application/json",
        Accept: "text/event-stream"
      }),
      body: JSON.stringify({
        stream: true,
        version: "2.1",
        incremental_output: true,
        chat_id: input.chatId,
        chat_mode: "chat",
        model: QWEN_REQUEST_MODEL,
        parent_id: null,
        messages: [
          {
            fid: messageId,
            parentId: null,
            childrenIds: [childId],
            role: "user",
            content: input.content,
            user_action: "chat",
            files: [],
            timestamp: nowSeconds,
            models: [QWEN_REQUEST_MODEL],
            chat_type: "t2t",
            feature_config: {
              thinking_enabled: true,
              output_schema: "phase",
              research_mode: "normal",
              auto_thinking: true,
              thinking_format: "summary",
              auto_search: true
            },
            extra: {
              meta: {
                subChatType: "t2t"
              }
            },
            sub_chat_type: "t2t",
            parent_id: null
          }
        ],
        timestamp: nowSeconds
      })
    }
  );

  if (response.status === 401 || response.status === 403) {
    throw ensureAuthError(response.status);
  }

  if (!response.ok) {
    const payload = await parseJsonSafe(response);
    if (isUnauthorizedPayload(payload)) {
      throw ensureAuthError(401);
    }

    throw createHttpError(response.status, resolvePayloadErrorMessage(payload, "Qwen 请求失败，请重试。"));
  }

  return collectStreamContent(response, input.content);
}
