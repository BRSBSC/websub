import { useState } from "react";
import { sendRuntimeMessage } from "../../lib/runtime";
import { getSettings } from "../../lib/storage";
import type { KimiAuthStatus, ProviderType, SummarizeResult } from "../../lib/types";
import { MarkdownContent } from "../components/MarkdownContent";

function getProviderLabel(provider: ProviderType): string {
  return provider === "kimi_web" ? "Kimi 免 Key" : "OpenAI 兼容";
}

export function SummaryPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [providerLabel, setProviderLabel] = useState("");
  const [showConnectKimiAction, setShowConnectKimiAction] = useState(false);
  const [connectingKimi, setConnectingKimi] = useState(false);

  const summarizeCurrentPage = async () => {
    setLoading(true);
    setError("");
    setCopied(false);
    setShowConnectKimiAction(false);

    try {
      const settings = await getSettings();

      if (settings.provider === "openai") {
        if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
          setError("请先前往“设置”填写 API 地址、API Key 和模型。");
          return;
        }
      } else {
        const authStatusResponse = await sendRuntimeMessage<KimiAuthStatus>({
          type: "GET_KIMI_AUTH_STATUS"
        });

        if (!authStatusResponse.ok) {
          setError(authStatusResponse.error);
          setShowConnectKimiAction(true);
          return;
        }

        if (!authStatusResponse.data.connected) {
          setError("未检测到 Kimi 登录状态，请先连接 Kimi。");
          setShowConnectKimiAction(true);
          return;
        }
      }

      const response = await sendRuntimeMessage<SummarizeResult>({
        type: "SUMMARIZE_ACTIVE_TAB",
        payload: { settings }
      });

      if (!response.ok) {
        setError(response.error);
        if (settings.provider === "kimi_web" && response.error.includes("重新连接 Kimi")) {
          setShowConnectKimiAction(true);
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

  const connectKimi = async () => {
    setConnectingKimi(true);
    setError("");
    try {
      const response = await sendRuntimeMessage<KimiAuthStatus>({
        type: "CONNECT_KIMI"
      });
      if (!response.ok) {
        setError(response.error);
        return;
      }

      setShowConnectKimiAction(false);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "连接 Kimi 失败，请重试。");
    } finally {
      setConnectingKimi(false);
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
      {showConnectKimiAction ? (
        <div className="inline-actions">
          <button type="button" className="ghost-btn" onClick={connectKimi} disabled={connectingKimi}>
            {connectingKimi ? "连接中..." : "去连接 Kimi"}
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
