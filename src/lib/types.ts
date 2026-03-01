export const DEFAULT_TEMPLATE_IDS = [
  "short_2sent_3bullets",
  "detailed_bg_terms",
  "detailed_chapter",
  "detailed_fact_opinion"
] as const;

export type DefaultTemplateId = (typeof DEFAULT_TEMPLATE_IDS)[number];
export type SummaryTemplateId = DefaultTemplateId | "custom";
export type ThemePreference = "system" | "light" | "dark";
export type ProviderType = "openai" | "kimi_web";

export type PromptTemplate = {
  id: SummaryTemplateId;
  label: string;
  description: string;
  isDefault: boolean;
};

export type Settings = {
  provider: ProviderType;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  outputLanguage: "zh-CN";
  summaryTemplateId: SummaryTemplateId;
  lastDefaultTemplateId: DefaultTemplateId;
  customSystemPrompt: string;
  themePreference: ThemePreference;
};

export type PageContent = {
  title: string;
  url: string;
  text: string;
  extractedAt: string;
};

export type SummaryRecord = {
  id: string;
  title: string;
  url: string;
  summary: string;
  provider: ProviderType;
  model: string;
  templateId: SummaryTemplateId;
  createdAt: string;
};

export type KimiTokens = {
  refreshToken: string;
  accessToken?: string;
  updatedAt: string;
};

export type KimiAuthStatus = {
  connected: boolean;
  updatedAt: string | null;
};

export type RuntimeMessage =
  | { type: "OPEN_SIDE_PANEL" }
  | { type: "CONNECT_KIMI" }
  | { type: "GET_KIMI_AUTH_STATUS" }
  | {
      type: "FETCH_MODELS";
      payload: { apiBaseUrl: string; apiKey: string };
    }
  | {
      type: "SUMMARIZE_ACTIVE_TAB";
      payload: { settings: Settings };
    };

export type RuntimeResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type FetchModelsResult = {
  models: string[];
};

export type SummarizeResult = {
  pageContent: PageContent;
  summary: string;
  record: SummaryRecord;
};

export const DEFAULT_SETTINGS: Settings = {
  provider: "openai",
  apiBaseUrl: "https://api.openai.com",
  apiKey: "",
  model: "",
  outputLanguage: "zh-CN",
  summaryTemplateId: "short_2sent_3bullets",
  lastDefaultTemplateId: "short_2sent_3bullets",
  customSystemPrompt: "",
  themePreference: "system"
};

export const MAX_CONTENT_LENGTH = 12_000;
export const MAX_HISTORY_RECORDS = 10;
export const CUSTOM_PROMPT_MAX_LENGTH = 2000;

export function isDefaultTemplateId(value: string): value is DefaultTemplateId {
  return (DEFAULT_TEMPLATE_IDS as readonly string[]).includes(value);
}

export function isSummaryTemplateId(value: string): value is SummaryTemplateId {
  return value === "custom" || isDefaultTemplateId(value);
}

export function isThemePreference(value: string): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function isProviderType(value: string): value is ProviderType {
  return value === "openai" || value === "kimi_web";
}
