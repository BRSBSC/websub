import { AppError } from "./errors";
import {
  CUSTOM_PROMPT_MAX_LENGTH,
  DEFAULT_SETTINGS,
  MAX_HISTORY_RECORDS,
  isDefaultTemplateId,
  isProviderType,
  isSummaryTemplateId,
  isThemePreference,
  type DefaultTemplateId,
  type KimiAuthStatus,
  type KimiTokens,
  type QwenTokens,
  type Settings,
  type SummaryRecord
} from "./types";

const SETTINGS_KEY = "settings";
const HISTORY_KEY = "summary_history";
const KIMI_TOKENS_KEY = "kimi_tokens";
const QWEN_TOKENS_KEY = "qwen_tokens";

function storageGet<T extends string>(keys: T[]): Promise<Record<T, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new AppError("读取本地存储失败。", { code: "RUNTIME" }));
        return;
      }

      resolve(result as Record<T, unknown>);
    });
  });
}

function storageSet(data: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(data, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new AppError("写入本地存储失败。", { code: "RUNTIME" }));
        return;
      }

      resolve();
    });
  });
}

function storageRemove(keys: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new AppError("清理本地存储失败。", { code: "RUNTIME" }));
        return;
      }

      resolve();
    });
  });
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function normalizeCustomSystemPrompt(prompt: string | undefined): string {
  const input = (prompt ?? "").trim();
  return input.length > CUSTOM_PROMPT_MAX_LENGTH
    ? input.slice(0, CUSTOM_PROMPT_MAX_LENGTH)
    : input;
}

function resolveProvider(value: Partial<Settings> | undefined): Settings["provider"] {
  const rawProvider = typeof value?.provider === "string"
    ? value.provider
    : DEFAULT_SETTINGS.provider;

  return isProviderType(rawProvider) ? rawProvider : DEFAULT_SETTINGS.provider;
}

function resolveSummaryTemplateId(value: Partial<Settings> | undefined): Settings["summaryTemplateId"] {
  const legacySummaryFormat = (value as { summaryFormat?: unknown } | undefined)?.summaryFormat;
  const rawTemplateId =
    typeof value?.summaryTemplateId === "string"
      ? value.summaryTemplateId
      : typeof legacySummaryFormat === "string"
        ? legacySummaryFormat
        : DEFAULT_SETTINGS.summaryTemplateId;

  return isSummaryTemplateId(rawTemplateId) ? rawTemplateId : DEFAULT_SETTINGS.summaryTemplateId;
}

function resolveLastDefaultTemplateId(
  value: Partial<Settings> | undefined,
  summaryTemplateId: Settings["summaryTemplateId"]
): DefaultTemplateId {
  const rawLastDefaultTemplateId =
    typeof value?.lastDefaultTemplateId === "string"
      ? value.lastDefaultTemplateId
      : isDefaultTemplateId(summaryTemplateId)
        ? summaryTemplateId
        : DEFAULT_SETTINGS.lastDefaultTemplateId;

  return isDefaultTemplateId(rawLastDefaultTemplateId)
    ? rawLastDefaultTemplateId
    : DEFAULT_SETTINGS.lastDefaultTemplateId;
}

function resolveThemePreference(value: Partial<Settings> | undefined): Settings["themePreference"] {
  const rawThemePreference = typeof value?.themePreference === "string"
    ? value.themePreference
    : DEFAULT_SETTINGS.themePreference;

  return isThemePreference(rawThemePreference)
    ? rawThemePreference
    : DEFAULT_SETTINGS.themePreference;
}

function sanitizeSettings(value: Partial<Settings> | undefined): Settings {
  const summaryTemplateId = resolveSummaryTemplateId(value);
  const lastDefaultTemplateId = resolveLastDefaultTemplateId(value, summaryTemplateId);

  return {
    provider: resolveProvider(value),
    apiBaseUrl: normalizeBaseUrl(value?.apiBaseUrl ?? DEFAULT_SETTINGS.apiBaseUrl),
    apiKey: (value?.apiKey ?? DEFAULT_SETTINGS.apiKey).trim(),
    model: (value?.model ?? DEFAULT_SETTINGS.model).trim(),
    outputLanguage: "zh-CN",
    summaryTemplateId,
    lastDefaultTemplateId,
    customSystemPrompt: normalizeCustomSystemPrompt(value?.customSystemPrompt),
    themePreference: resolveThemePreference(value)
  };
}

export async function getSettings(): Promise<Settings> {
  const result = await storageGet([SETTINGS_KEY]);
  const current = result[SETTINGS_KEY] as Partial<Settings> | undefined;
  return sanitizeSettings(current);
}

export async function saveSettings(next: Partial<Settings>): Promise<Settings> {
  const merged = sanitizeSettings({
    ...(await getSettings()),
    ...next
  });

  await storageSet({ [SETTINGS_KEY]: merged });
  return merged;
}

export async function getSummaryHistory(): Promise<SummaryRecord[]> {
  const result = await storageGet([HISTORY_KEY]);
  const history = result[HISTORY_KEY];

  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .map((item) => normalizeSummaryRecord(item))
    .filter((item): item is SummaryRecord => item !== null)
    .slice(0, MAX_HISTORY_RECORDS);
}

function normalizeSummaryRecord(value: unknown): SummaryRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<SummaryRecord>;
  if (
    typeof record.id !== "string" ||
    typeof record.title !== "string" ||
    typeof record.url !== "string" ||
    typeof record.summary !== "string" ||
    typeof record.model !== "string" ||
    typeof record.createdAt !== "string"
  ) {
    return null;
  }

  const templateId = isSummaryTemplateId(String(record.templateId))
    ? (record.templateId as SummaryRecord["templateId"])
    : DEFAULT_SETTINGS.summaryTemplateId;

  const rawProvider = typeof record.provider === "string"
    ? record.provider
    : DEFAULT_SETTINGS.provider;
  const provider = isProviderType(rawProvider) ? rawProvider : DEFAULT_SETTINGS.provider;

  return {
    id: record.id,
    title: record.title,
    url: record.url,
    summary: record.summary,
    provider,
    model: record.model,
    templateId,
    createdAt: record.createdAt
  };
}

export async function addSummaryRecord(record: SummaryRecord): Promise<void> {
  const current = await getSummaryHistory();
  const next = [record, ...current].slice(0, MAX_HISTORY_RECORDS);
  await storageSet({ [HISTORY_KEY]: next });
}

function sanitizeKimiTokens(value: unknown): KimiTokens | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<KimiTokens>;
  const refreshToken = typeof candidate.refreshToken === "string"
    ? candidate.refreshToken.trim()
    : "";
  if (!refreshToken) {
    return null;
  }

  const accessToken = typeof candidate.accessToken === "string" && candidate.accessToken.trim().length > 0
    ? candidate.accessToken.trim()
    : undefined;
  const updatedAt = typeof candidate.updatedAt === "string" && candidate.updatedAt.trim().length > 0
    ? candidate.updatedAt
    : new Date().toISOString();

  return {
    refreshToken,
    accessToken,
    updatedAt
  };
}

export async function getKimiTokens(): Promise<KimiTokens | null> {
  const result = await storageGet([KIMI_TOKENS_KEY]);
  return sanitizeKimiTokens(result[KIMI_TOKENS_KEY]);
}

export async function saveKimiTokens(input: {
  refreshToken: string;
  accessToken?: string;
}): Promise<KimiTokens> {
  const refreshToken = input.refreshToken.trim();
  if (!refreshToken) {
    throw new AppError("Kimi 登录状态无效，请重新连接。", { code: "AUTH" });
  }

  const tokenState: KimiTokens = {
    refreshToken,
    accessToken: input.accessToken?.trim() ? input.accessToken.trim() : undefined,
    updatedAt: new Date().toISOString()
  };
  await storageSet({ [KIMI_TOKENS_KEY]: tokenState });
  return tokenState;
}

export async function clearKimiTokens(): Promise<void> {
  await storageRemove([KIMI_TOKENS_KEY]);
}

export async function getKimiAuthStatus(): Promise<KimiAuthStatus> {
  const tokens = await getKimiTokens();
  if (!tokens) {
    return {
      connected: false,
      updatedAt: null
    };
  }

  return {
    connected: tokens.refreshToken.trim().length > 0,
    updatedAt: tokens.updatedAt
  };
}

function sanitizeQwenTokens(value: unknown): QwenTokens | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<QwenTokens>;
  const token = typeof candidate.token === "string"
    ? candidate.token.trim()
    : "";
  if (!token) {
    return null;
  }

  const updatedAt = typeof candidate.updatedAt === "string" && candidate.updatedAt.trim().length > 0
    ? candidate.updatedAt
    : new Date().toISOString();

  const account = typeof candidate.account === "string" && candidate.account.trim().length > 0
    ? candidate.account.trim()
    : undefined;

  return {
    token,
    updatedAt,
    account
  };
}

export async function getQwenTokens(): Promise<QwenTokens | null> {
  const result = await storageGet([QWEN_TOKENS_KEY]);
  return sanitizeQwenTokens(result[QWEN_TOKENS_KEY]);
}

export async function saveQwenTokens(input: {
  token: string;
  account?: string;
}): Promise<QwenTokens> {
  const token = input.token.trim();
  if (!token) {
    throw new AppError("Qwen 登录状态无效，请重新连接。", { code: "AUTH" });
  }

  const tokenState: QwenTokens = {
    token,
    account: input.account?.trim() ? input.account.trim() : undefined,
    updatedAt: new Date().toISOString()
  };
  await storageSet({ [QWEN_TOKENS_KEY]: tokenState });
  return tokenState;
}

export async function clearQwenTokens(): Promise<void> {
  await storageRemove([QWEN_TOKENS_KEY]);
}

export async function getQwenAuthStatus(): Promise<KimiAuthStatus> {
  const tokens = await getQwenTokens();
  if (!tokens) {
    return {
      connected: false,
      updatedAt: null
    };
  }

  return {
    connected: tokens.token.trim().length > 0,
    updatedAt: tokens.updatedAt
  };
}
