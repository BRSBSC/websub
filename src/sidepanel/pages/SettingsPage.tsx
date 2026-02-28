import { useEffect, useMemo, useState } from "react";
import { getTemplateLabel, PROMPT_TEMPLATES } from "../../lib/prompt";
import { sendRuntimeMessage } from "../../lib/runtime";
import { getSettings, saveSettings } from "../../lib/storage";
import {
  CUSTOM_PROMPT_MAX_LENGTH,
  DEFAULT_SETTINGS,
  isDefaultTemplateId,
  type FetchModelsResult,
  type Settings,
  type SummaryTemplateId,
  type ThemePreference
} from "../../lib/types";

type Status = {
  kind: "idle" | "success" | "error";
  message: string;
};

type SettingsPageProps = {
  onThemePreferenceChange?: (preference: ThemePreference) => void;
};

function isValidUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function toThemePreference(value: string): ThemePreference {
  if (value === "light" || value === "dark") {
    return value;
  }

  return "system";
}

export function SettingsPage({ onThemePreferenceChange }: SettingsPageProps) {
  const [form, setForm] = useState<Settings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle", message: "" });

  useEffect(() => {
    void (async () => {
      try {
        const settings = await getSettings();
        setForm(settings);
        onThemePreferenceChange?.(settings.themePreference);
      } catch (error) {
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : "读取设置失败，请重试。"
        });
      }
    })();
  }, [onThemePreferenceChange]);

  const canFetchModels = useMemo(() => {
    return form.apiBaseUrl.trim().length > 0 && form.apiKey.trim().length > 0;
  }, [form.apiBaseUrl, form.apiKey]);

  const selectedTemplate = useMemo(() => {
    return PROMPT_TEMPLATES.find((template) => template.id === form.summaryTemplateId) ?? PROMPT_TEMPLATES[0];
  }, [form.summaryTemplateId]);

  const customPromptLength = form.customSystemPrompt.length;
  const customPromptTooLong = customPromptLength > CUSTOM_PROMPT_MAX_LENGTH;

  const onChange = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setStatus({ kind: "idle", message: "" });
    setForm((current) => ({
      ...current,
      [key]: value
    }));
  };

  const onChangeTemplate = (templateId: SummaryTemplateId) => {
    setStatus({ kind: "idle", message: "" });
    setForm((current) => ({
      ...current,
      summaryTemplateId: templateId,
      lastDefaultTemplateId: isDefaultTemplateId(templateId)
        ? templateId
        : current.lastDefaultTemplateId
    }));
  };

  const onChangeThemePreference = (nextPreference: ThemePreference) => {
    onChange("themePreference", nextPreference);
    onThemePreferenceChange?.(nextPreference);

    void (async () => {
      try {
        await saveSettings({ themePreference: nextPreference });
      } catch (error) {
        setStatus({
          kind: "error",
          message: error instanceof Error ? `主题保存失败：${error.message}` : "主题保存失败，请重试。"
        });
      }
    })();
  };

  const validate = (): string | null => {
    if (!form.apiBaseUrl.trim()) {
      return "请填写 API 地址。";
    }

    if (!isValidUrl(form.apiBaseUrl.trim())) {
      return "API 地址格式不正确，请输入 http(s) 地址。";
    }

    if (!form.apiKey.trim()) {
      return "请填写 API Key。";
    }

    if (!form.model.trim()) {
      return "请填写模型名称。";
    }

    if (customPromptTooLong) {
      return `自定义提示词不能超过 ${CUSTOM_PROMPT_MAX_LENGTH} 字符。`;
    }

    return null;
  };

  const onSave = async () => {
    const errorMessage = validate();
    if (errorMessage) {
      setStatus({ kind: "error", message: errorMessage });
      return;
    }

    setSaving(true);
    try {
      const normalizedLastDefaultTemplateId = isDefaultTemplateId(form.summaryTemplateId)
        ? form.summaryTemplateId
        : form.lastDefaultTemplateId;

      const saved = await saveSettings({
        apiBaseUrl: form.apiBaseUrl,
        apiKey: form.apiKey,
        model: form.model,
        outputLanguage: "zh-CN",
        summaryTemplateId: form.summaryTemplateId,
        lastDefaultTemplateId: normalizedLastDefaultTemplateId,
        customSystemPrompt: form.customSystemPrompt,
        themePreference: form.themePreference
      });

      setForm(saved);
      onThemePreferenceChange?.(saved.themePreference);

      if (saved.summaryTemplateId === "custom" && saved.customSystemPrompt.trim().length === 0) {
        setStatus({
          kind: "success",
          message: `设置已保存。当前将回退到“${getTemplateLabel(saved.lastDefaultTemplateId)}”。`
        });
      } else {
        setStatus({ kind: "success", message: "设置已保存。" });
      }
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "设置保存失败。"
      });
    } finally {
      setSaving(false);
    }
  };

  const onFetchModels = async () => {
    if (!canFetchModels) {
      setStatus({ kind: "error", message: "请先填写 API 地址和 API Key。" });
      return;
    }

    setLoadingModels(true);
    setStatus({ kind: "idle", message: "" });

    try {
      const response = await sendRuntimeMessage<FetchModelsResult>({
        type: "FETCH_MODELS",
        payload: {
          apiBaseUrl: form.apiBaseUrl,
          apiKey: form.apiKey
        }
      });

      if (!response.ok) {
        setStatus({
          kind: "error",
          message: `${response.error}（仍可手动输入模型）`
        });
        return;
      }

      const modelList = response.data.models;
      setModels(modelList);
      if (!form.model && modelList.length > 0) {
        onChange("model", modelList[0]);
      }
      setStatus({ kind: "success", message: `已拉取 ${modelList.length} 个模型。` });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? `${error.message}（仍可手动输入模型）`
            : "拉取模型失败（仍可手动输入模型）"
      });
    } finally {
      setLoadingModels(false);
    }
  };

  return (
    <section className="panel settings-panel">
      <header className="panel-head">
        <div>
          <h2>接口与偏好设置</h2>
          <p>配置模型、模板与主题后，即可一键总结当前页面。</p>
        </div>
      </header>

      <div className="settings-groups">
        <section className="sub-card">
          <h3>API 配置</h3>

          <label className="field">
            <span>API 地址</span>
            <input
              type="url"
              placeholder="https://api.openai.com"
              value={form.apiBaseUrl}
              onChange={(event) => onChange("apiBaseUrl", event.target.value)}
            />
          </label>

          <label className="field">
            <span>API Key</span>
            <input
              type="password"
              placeholder="sk-..."
              value={form.apiKey}
              onChange={(event) => onChange("apiKey", event.target.value)}
            />
          </label>

          <label className="field">
            <span>模型</span>
            <input
              type="text"
              list="model-options"
              placeholder="例如 gpt-4.1-mini"
              value={form.model}
              onChange={(event) => onChange("model", event.target.value)}
            />
          </label>

          <datalist id="model-options">
            {models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>

          <div className="inline-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={onFetchModels}
              disabled={loadingModels || !canFetchModels}
            >
              {loadingModels ? "拉取中..." : "拉取模型"}
            </button>
          </div>
          <p className="hint">模型拉取失败时，可直接手动输入模型名称并保存。</p>
        </section>

        <section className="sub-card">
          <h3>提示词模板</h3>

          <label className="field">
            <span>输出提示词模板</span>
            <select
              value={form.summaryTemplateId}
              onChange={(event) => onChangeTemplate(event.target.value as SummaryTemplateId)}
            >
              {PROMPT_TEMPLATES.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">{selectedTemplate.description}</p>

          {form.summaryTemplateId === "custom" ? (
            <>
              <label className="field">
                <span>自定义系统提示词</span>
                <textarea
                  rows={6}
                  placeholder="例如：你是一位专业分析师，请用...格式输出"
                  value={form.customSystemPrompt}
                  onChange={(event) => onChange("customSystemPrompt", event.target.value)}
                />
              </label>
              <p className={customPromptTooLong ? "hint counter error-text" : "hint counter"}>
                {customPromptLength}/{CUSTOM_PROMPT_MAX_LENGTH}
              </p>
              {form.customSystemPrompt.trim().length === 0 ? (
                <p className="hint">
                  当前自定义为空，执行总结时会回退到“{getTemplateLabel(form.lastDefaultTemplateId)}”。
                </p>
              ) : null}
            </>
          ) : null}
        </section>

        <section className="sub-card">
          <h3>外观设置</h3>
          <label className="field">
            <span>主题</span>
            <select
              value={form.themePreference}
              onChange={(event) => onChangeThemePreference(toThemePreference(event.target.value))}
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
          <p className="hint">默认跟随系统。你也可以手动固定为浅色或深色。</p>
        </section>
      </div>

      {status.kind === "success" ? <p className="status success">{status.message}</p> : null}
      {status.kind === "error" ? <p className="status error">{status.message}</p> : null}

      <footer className="settings-actions">
        <button type="button" className="primary-btn" onClick={onSave} disabled={saving}>
          {saving ? "保存中..." : "保存设置"}
        </button>
      </footer>
    </section>
  );
}
