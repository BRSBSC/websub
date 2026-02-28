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
  type SummaryTemplateId
} from "../../lib/types";

type Status = {
  kind: "idle" | "success" | "error";
  message: string;
};

function isValidUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function SettingsPage() {
  const [form, setForm] = useState<Settings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle", message: "" });

  useEffect(() => {
    void (async () => {
      const settings = await getSettings();
      setForm(settings);
    })();
  }, []);

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
        customSystemPrompt: form.customSystemPrompt
      });

      setForm(saved);

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
    <section className="card">
      <h2>接口与提示词设置</h2>

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

      <div className="button-group">
        <button
          type="button"
          className="ghost-btn"
          onClick={onFetchModels}
          disabled={loadingModels || !canFetchModels}
        >
          {loadingModels ? "拉取中..." : "拉取模型"}
        </button>
        <button type="button" className="primary-btn" onClick={onSave} disabled={saving}>
          {saving ? "保存中..." : "保存设置"}
        </button>
      </div>

      {status.kind === "success" ? <p className="status success">{status.message}</p> : null}
      {status.kind === "error" ? <p className="status error">{status.message}</p> : null}
      <p className="hint">模型拉取失败时，可直接手动输入模型名称并保存。</p>
    </section>
  );
}
