import {
  DEFAULT_TEMPLATE_IDS,
  type DefaultTemplateId,
  type PageContent,
  type PromptTemplate,
  type Settings,
  type SummaryTemplateId
} from "./types";

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

const TEMPLATE_LABELS: Record<SummaryTemplateId, string> = {
  short_2sent_3bullets: "快速阅读（默认）",
  detailed_bg_terms: "详细版（背景/术语）",
  detailed_chapter: "详细版（章节拆解）",
  detailed_fact_opinion: "详细版（事实/观点）",
  custom: "自定义系统提示词"
};

const TEMPLATE_DESCRIPTIONS: Record<SummaryTemplateId, string> = {
  short_2sent_3bullets: "主要总结网页内容，以便快速阅读。",
  detailed_bg_terms: "摘要 + 背景 + 要点 + 术语 + 结论，适合学习型内容。",
  detailed_chapter: "摘要 + 章节拆解 + 结论，适合长文按段理解。",
  detailed_fact_opinion: "摘要 + 事实/观点分离 + 结论，强调信息判断。",
  custom: "使用你自定义的系统提示词；为空时回退到上次默认模板。"
};

const DEFAULT_SYSTEM_PROMPTS: Record<DefaultTemplateId, string> = {
  short_2sent_3bullets: [
    "你是一位网页内容总结助手。",
    "你的目标是总结网页核心信息，帮助用户快速阅读。",
    "请使用简体中文，保持准确、精炼、易扫读。",
    "严格使用以下格式：",
    "1) 摘要（2 句）",
    "2) 核心要点（3 条）",
    "不要输出额外解释，不要编造信息。"
  ].join("\n"),
  detailed_bg_terms: [
    "你是一位严谨的内容分析助手。",
    "请使用简体中文，并严格使用以下结构：",
    "1) 摘要",
    "2) 背景",
    "3) 关键要点",
    "4) 术语解释",
    "5) 结论",
    "若网页未提供某部分信息，请明确写“未提及”。禁止编造。"
  ].join("\n"),
  detailed_chapter: [
    "你是一位结构化阅读助手。",
    "请使用简体中文，并严格使用以下结构：",
    "1) 摘要",
    "2) 章节拆解（按主题分小节）",
    "3) 结论",
    "每节简洁但要覆盖核心信息，不要编造。"
  ].join("\n"),
  detailed_fact_opinion: [
    "你是一位信息甄别助手。",
    "请使用简体中文，并严格使用以下结构：",
    "1) 摘要",
    "2) 客观事实",
    "3) 观点与判断",
    "4) 结论",
    "必须区分事实与观点；信息不足时明确标注“不确定”。"
  ].join("\n")
};

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  ...DEFAULT_TEMPLATE_IDS.map((id) => ({
    id,
    label: TEMPLATE_LABELS[id],
    description: TEMPLATE_DESCRIPTIONS[id],
    isDefault: true
  })),
  {
    id: "custom",
    label: TEMPLATE_LABELS.custom,
    description: TEMPLATE_DESCRIPTIONS.custom,
    isDefault: false
  }
];

export function getTemplateLabel(templateId: SummaryTemplateId): string {
  return TEMPLATE_LABELS[templateId] ?? templateId;
}

export function resolveEffectiveTemplateId(settings: Settings): SummaryTemplateId {
  if (settings.summaryTemplateId !== "custom") {
    return settings.summaryTemplateId;
  }

  return settings.customSystemPrompt.trim().length > 0 ? "custom" : settings.lastDefaultTemplateId;
}

export function buildSystemPrompt(settings: Settings): string {
  const effectiveTemplateId = resolveEffectiveTemplateId(settings);
  if (effectiveTemplateId === "custom") {
    return settings.customSystemPrompt.trim();
  }

  return DEFAULT_SYSTEM_PROMPTS[effectiveTemplateId];
}

export function buildSummaryMessages(pageContent: PageContent, settings: Settings): ChatMessage[] {
  const systemPrompt = buildSystemPrompt(settings);

  const userPrompt = [
    "请总结以下网页内容：",
    `标题：${pageContent.title || "（无标题）"}`,
    `链接：${pageContent.url}`,
    "正文：",
    pageContent.text
  ].join("\n");

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];
}
