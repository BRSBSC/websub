import { useState } from "react";
import { getSettings } from "../../lib/storage";
import { sendRuntimeMessage } from "../../lib/runtime";
import type { SummarizeResult } from "../../lib/types";
import { MarkdownContent } from "../components/MarkdownContent";

export function SummaryPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [copied, setCopied] = useState(false);

  const summarizeCurrentPage = async () => {
    setLoading(true);
    setError("");
    setCopied(false);

    try {
      const settings = await getSettings();
      if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
        setError("请先前往“设置”填写 API 地址、API Key 和模型。");
        return;
      }

      const response = await sendRuntimeMessage<SummarizeResult>({
        type: "SUMMARIZE_ACTIVE_TAB",
        payload: { settings }
      });

      if (!response.ok) {
        setError(response.error);
        return;
      }

      setSummary(response.data.summary);
      setPageTitle(response.data.pageContent.title);
      setSourceUrl(response.data.pageContent.url);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "总结失败，请重试。");
    } finally {
      setLoading(false);
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
    <section className="card">
      <div className="row-between">
        <h2>当前页面总结</h2>
        <button type="button" className="primary-btn" onClick={summarizeCurrentPage} disabled={loading}>
          {loading ? "总结中..." : "总结当前页面"}
        </button>
      </div>

      {error ? <p className="status error">{error}</p> : null}

      {summary ? (
        <article className="summary-block">
          <div className="summary-head">
            <div>
              <h3>{pageTitle}</h3>
              <a href={sourceUrl} target="_blank" rel="noreferrer">
                {sourceUrl}
              </a>
            </div>
            <button type="button" className="ghost-btn" onClick={copySummary}>
              {copied ? "已复制" : "复制全文"}
            </button>
          </div>
          <MarkdownContent markdown={summary} />
        </article>
      ) : (
        <p className="hint">点击“总结当前页面”后，这里会按你设置的模板输出中文总结。</p>
      )}
    </section>
  );
}
