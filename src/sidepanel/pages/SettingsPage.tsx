import { useEffect, useMemo, useState } from "react";
import { getTemplateLabel, PROMPT_TEMPLATES } from "../../lib/prompt";
import { sendRuntimeMessage } from "../../lib/runtime";
import { clearKimiTokens, getSettings, saveSettings } from "../../lib/storage";
import {
  CUSTOM_PROMPT_MAX_LENGTH,
  DEFAULT_SETTINGS,
  isDefaultTemplateId,
  type FetchModelsResult,
  type KimiAuthStatus,
  type ProviderType,
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

function formatUpdatedAt(value: string | null): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("zh-CN");
}

function getProviderLabel(provider: ProviderType): string {
  return provider === "kimi_web" ? "Kimi（免 Key）" : "OpenAI 兼容";
}

export function SettingsPage({ onThemePreferenceChange }: SettingsPageProps) {
  const [form, setForm] = useState<Settings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle", message: "" });
  const [kimiStatus, setKimiStatus] = useState<KimiAuthStatus>({
    connected: false,
    updatedAt: null
  });
  const [loadingKimiStatus, setLoadingKimiStatus] = useState(false);
  const [connectingKimi, setConnectingKimi] = useState(false);

  const refreshKimiStatus = async (silent = false) => {
    if (!silent) {
      setStatus({ kind: "idle", message: "" });
    }

    setLoadingKimiStatus(true);
    try {
      const response = await sendRuntimeMessage<KimiAuthStatus>({
        type: "GET_KIMI_AUTH_STATUS"
      });
      if (!response.ok) {
        throw new Error(response.error);
      }
      setKimiStatus(response.data);
    } catch (error) {
      if (!silent) {
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : "读取 Kimi 连接状态失败，请重试。"
        });
      }
    } finally {
      setLoadingKimiStatus(false);
    }
  };

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

    void refreshKimiStatus(true);
  }, [onThemePreferenceChange]);

  const canFetchModels = useMemo(() => {
    if (form.provider !== "openai") {
      return false;
    }

    return form.apiBaseUrl.trim().length > 0 && form.apiKey.trim().length > 0;
  }, [form.provider, form.apiBaseUrl, form.apiKey]);

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

  const onChangeProvider = (provider: ProviderType) => {
    onChange("provider", provider);
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
    if (customPromptTooLong) {
      return `自定义提示词不能超过 ${CUSTOM_PROMPT_MAX_LENGTH} 字符。`;
    }

    if (form.provider === "openai") {
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
        provider: form.provider,
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
        setStatus({
          kind: "success",
          message: `设置已保存，当前提供商：${getProviderLabel(saved.provider)}。`
        });
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

  const onConnectKimi = async () => {
    setConnectingKimi(true);
    setStatus({ kind: "idle", message: "" });
    try {
      const response = await sendRuntimeMessage<KimiAuthStatus>({
        type: "CONNECT_KIMI"
      });
      if (!response.ok) {
        throw new Error(response.error);
      }

      setKimiStatus(response.data);
      setStatus({
        kind: "success",
        message: `Kimi 已连接，更新时间：${formatUpdatedAt(response.data.updatedAt)}。`
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "连接 Kimi 失败，请重试。"
      });
    } finally {
      setConnectingKimi(false);
    }
  };

  const onDisconnectKimi = async () => {
    setStatus({ kind: "idle", message: "" });
    try {
      await clearKimiTokens();
      setKimiStatus({
        connected: false,
        updatedAt: null
      });
      setStatus({
        kind: "success",
        message: "已断开 Kimi 连接。"
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "断开 Kimi 失败，请重试。"
      });
    }
  };

  return (
    <section className="panel settings-panel">
      <header className="panel-head">
        <div>
          <h2>接口与偏好设置</h2>
          <p>支持 OpenAI 兼容接口与 Kimi 免 Key 两种模式，模板与主题设置通用。</p>
        </div>
      </header>

      <div className="settings-groups">
        <section className="sub-card">
          <h3>提供商</h3>
          <label className="field">
            <span>总结提供商</span>
            <select
              value={form.provider}
              onChange={(event) => onChangeProvider(event.target.value as ProviderType)}
            >
              <option value="openai">OpenAI 兼容</option>
              <option value="kimi_web">Kimi（免 Key）</option>
            </select>
          </label>
          <p className="hint">切换后点击“保存设置”生效。</p>
        </section>

        {form.provider === "openai" ? (
          <section className="sub-card">
            <h3>OpenAI 兼容 API 配置</h3>

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
        ) : (
          <section className="sub-card">
            <h3>Kimi 连接状态</h3>
            <p className="hint">通过 Kimi 网页登录态使用，免 API Key，本地持久化存储 token。</p>
            <div className="history-tags">
              <span className="meta-chip">状态：{kimiStatus.connected ? "已连接" : "未连接"}</span>
              <span className="meta-chip">更新时间：{formatUpdatedAt(kimiStatus.updatedAt)}</span>
            </div>

            <div className="inline-actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={onConnectKimi}
                disabled={connectingKimi}
              >
                {connectingKimi ? "连接中..." : kimiStatus.connected ? "重新连接 Kimi" : "连接 Kimi"}
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => void refreshKimiStatus()}
                disabled={loadingKimiStatus || connectingKimi}
              >
                {loadingKimiStatus ? "刷新中..." : "刷新状态"}
              </button>
            </div>

            <div className="inline-actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={onDisconnectKimi}
                disabled={!kimiStatus.connected}
              >
                断开连接
              </button>
            </div>
          </section>
        )}

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
                <p className="hint">Fallback template: {getTemplateLabel(form.lastDefaultTemplateId)}</p>
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
