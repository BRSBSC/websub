import { AppError } from "./errors";
import {
  CUSTOM_PROMPT_MAX_LENGTH,
  DEFAULT_SETTINGS,
  MAX_HISTORY_RECORDS,
  isDefaultTemplateId,
  isSummaryTemplateId,
  type DefaultTemplateId,
  type Settings,
  type SummaryRecord
} from "./types";

const SETTINGS_KEY = "settings";
const HISTORY_KEY = "summary_history";

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

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function normalizeCustomSystemPrompt(prompt: string | undefined): string {
  const input = (prompt ?? "").trim();
  return input.length > CUSTOM_PROMPT_MAX_LENGTH
    ? input.slice(0, CUSTOM_PROMPT_MAX_LENGTH)
    : input;
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

function sanitizeSettings(value: Partial<Settings> | undefined): Settings {
  const summaryTemplateId = resolveSummaryTemplateId(value);
  const lastDefaultTemplateId = resolveLastDefaultTemplateId(value, summaryTemplateId);

  return {
    apiBaseUrl: normalizeBaseUrl(value?.apiBaseUrl ?? DEFAULT_SETTINGS.apiBaseUrl),
    apiKey: (value?.apiKey ?? DEFAULT_SETTINGS.apiKey).trim(),
    model: (value?.model ?? DEFAULT_SETTINGS.model).trim(),
    outputLanguage: "zh-CN",
    summaryTemplateId,
    lastDefaultTemplateId,
    customSystemPrompt: normalizeCustomSystemPrompt(value?.customSystemPrompt)
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

  return {
    id: record.id,
    title: record.title,
    url: record.url,
    summary: record.summary,
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
