export const DEFAULT_TEMPLATE_IDS = [
  "tldr_5_bullets",
  "short_2sent_3bullets",
  "detailed_bg_terms",
  "detailed_chapter",
  "detailed_fact_opinion"
] as const;

export type DefaultTemplateId = (typeof DEFAULT_TEMPLATE_IDS)[number];
export type SummaryTemplateId = DefaultTemplateId | "custom";
export type ThemePreference = "system" | "light" | "dark";

export type PromptTemplate = {
  id: SummaryTemplateId;
  label: string;
  description: string;
  isDefault: boolean;
};

export type Settings = {
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
  model: string;
  templateId: SummaryTemplateId;
  createdAt: string;
};

export type RuntimeMessage =
  | { type: "OPEN_SIDE_PANEL" }
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
  apiBaseUrl: "https://api.openai.com",
  apiKey: "",
  model: "",
  outputLanguage: "zh-CN",
  summaryTemplateId: "tldr_5_bullets",
  lastDefaultTemplateId: "tldr_5_bullets",
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
