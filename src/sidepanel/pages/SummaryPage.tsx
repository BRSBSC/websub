import { useState } from "react";
import { sendRuntimeMessage } from "../../lib/runtime";
import { getSettings } from "../../lib/storage";
import { getWebProviderName } from "../../lib/webProvider";
import type { ProviderType, SummarizeResult, WebProviderAuthStatus, WebProviderType } from "../../lib/types";
import { MarkdownContent } from "../components/MarkdownContent";

function getProviderLabel(provider: ProviderType): string {
  if (provider === "openai") {
    return "OpenAI 兼容";
  }

  return provider === "kimi_web" ? "Kimi 免 Key" : "Qwen 国际版 免 Key";
}

export function SummaryPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [providerLabel, setProviderLabel] = useState("");
  const [showConnectWebProviderAction, setShowConnectWebProviderAction] = useState(false);
  const [connectingWebProvider, setConnectingWebProvider] = useState(false);
  const [pendingWebProvider, setPendingWebProvider] = useState<WebProviderType | null>(null);

  const summarizeCurrentPage = async () => {
    setLoading(true);
    setError("");
    setCopied(false);
    setShowConnectWebProviderAction(false);
    setPendingWebProvider(null);

    try {
      const settings = await getSettings();

      if (settings.provider === "openai") {
        if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
          setError("请先前往“设置”填写 API 地址、API Key 和模型。");
          return;
        }
      } else {
        setPendingWebProvider(settings.provider);
        const authStatusResponse = await sendRuntimeMessage<WebProviderAuthStatus>({
          type: "GET_WEB_PROVIDER_AUTH_STATUS",
          payload: {
            provider: settings.provider
          }
        });

        if (!authStatusResponse.ok) {
          setError(authStatusResponse.error);
          setShowConnectWebProviderAction(true);
          return;
        }

        if (!authStatusResponse.data.connected) {
          const providerName = getWebProviderName(settings.provider);
          setError(`未检测到 ${providerName} 登录状态，请先连接 ${providerName}。`);
          setShowConnectWebProviderAction(true);
          return;
        }
      }

      const response = await sendRuntimeMessage<SummarizeResult>({
        type: "SUMMARIZE_ACTIVE_TAB",
        payload: { settings }
      });

      if (!response.ok) {
        setError(response.error);
        if (settings.provider !== "openai" && response.error.includes("重新连接")) {
          setPendingWebProvider(settings.provider);
          setShowConnectWebProviderAction(true);
        }
        return;
      }

      setSummary(response.data.summary);
      setPageTitle(response.data.pageContent.title);
      setSourceUrl(response.data.pageContent.url);
      setProviderLabel(getProviderLabel(response.data.record.provider));
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "总结失败，请重试。");
    } finally {
      setLoading(false);
    }
  };

  const connectWebProvider = async () => {
    if (!pendingWebProvider) {
      return;
    }

    setConnectingWebProvider(true);
    setError("");
    try {
      const response = await sendRuntimeMessage<WebProviderAuthStatus>({
        type: "CONNECT_WEB_PROVIDER",
        payload: {
          provider: pendingWebProvider
        }
      });
      if (!response.ok) {
        setError(response.error);
        return;
      }

      setShowConnectWebProviderAction(false);
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : `连接 ${getWebProviderName(pendingWebProvider)} 失败，请重试。`
      );
    } finally {
      setConnectingWebProvider(false);
    }
  };

  const copySummary = async () => {
    if (!summary) {
      return;
    }

    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("复制失败，请手动复制。");
    }
  };

  return (
    <section className="panel summary-panel">
      <header className="panel-head summary-headline">
        <div>
          <h2>当前页面总结</h2>
          <p>一键提取正文并按模板输出中文总结。</p>
        </div>
        <button type="button" className="primary-btn" onClick={summarizeCurrentPage} disabled={loading}>
          {loading ? "总结中..." : "总结当前页面"}
        </button>
      </header>

      {error ? <p className="status error">{error}</p> : null}
      {showConnectWebProviderAction ? (
        <div className="inline-actions">
          <button
            type="button"
            className="ghost-btn"
            onClick={connectWebProvider}
            disabled={connectingWebProvider}
          >
            {connectingWebProvider
              ? "连接中..."
              : `去连接 ${pendingWebProvider ? getWebProviderName(pendingWebProvider) : "提供商"}`}
          </button>
        </div>
      ) : null}

      {summary ? (
        <article className="summary-result">
          <div className="summary-result-head">
            <div className="summary-source">
              <h3>{pageTitle || "未命名页面"}</h3>
              {sourceUrl ? (
                <a href={sourceUrl} target="_blank" rel="noreferrer" className="summary-link">
                  {sourceUrl}
                </a>
              ) : null}
              {providerLabel ? <p className="hint">提供商：{providerLabel}</p> : null}
            </div>
            <button type="button" className="ghost-btn" onClick={copySummary}>
              {copied ? "已复制" : "复制全文"}
            </button>
          </div>
          <MarkdownContent markdown={summary} />
        </article>
      ) : (
        <section className="empty-state" aria-live="polite">
          <h3>等待生成总结</h3>
          <p>点击“总结当前页面”后，这里会展示完整结果与来源信息。</p>
        </section>
      )}
    </section>
  );
}
