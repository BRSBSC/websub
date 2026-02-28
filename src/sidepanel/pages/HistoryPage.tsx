import { useEffect, useState } from "react";
import { toPlainPreview } from "../../lib/markdown";
import { getTemplateLabel } from "../../lib/prompt";
import { getSummaryHistory } from "../../lib/storage";
import type { SummaryRecord } from "../../lib/types";
import { MarkdownContent } from "../components/MarkdownContent";

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return date.toLocaleString("zh-CN");
}

export function HistoryPage() {
  const [records, setRecords] = useState<SummaryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedRecordIds, setExpandedRecordIds] = useState<string[]>([]);

  const loadHistory = async () => {
    setLoading(true);
    setError("");
    try {
      const history = await getSummaryHistory();
      setRecords(history);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "读取历史记录失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  const copyRecord = async (record: SummaryRecord) => {
    try {
      await navigator.clipboard.writeText(record.summary);
    } catch {
      setError("复制失败，请手动复制。");
    }
  };

  const toggleExpanded = (recordId: string) => {
    setExpandedRecordIds((current) => {
      return current.includes(recordId)
        ? current.filter((id) => id !== recordId)
        : [...current, recordId];
    });
  };

  return (
    <section className="panel history-panel">
      <header className="panel-head">
        <div>
          <h2>最近 10 条历史</h2>
          <p>可回看摘要、展开 Markdown 详情并快速复制全文。</p>
        </div>
        <button type="button" className="ghost-btn" onClick={loadHistory} disabled={loading}>
          {loading ? "刷新中..." : "刷新"}
        </button>
      </header>

      {error ? <p className="status error">{error}</p> : null}

      {loading ? <p className="hint">正在读取历史...</p> : null}
      {!loading && records.length === 0 ? <p className="hint">暂无历史记录。</p> : null}

      <ul className="history-list" aria-live="polite">
        {records.map((record) => {
          const expanded = expandedRecordIds.includes(record.id);

          return (
            <li key={record.id} className="history-item">
              <div className="history-meta">
                <strong>{record.title || "未命名页面"}</strong>
                <div className="history-tags">
                  <span className="meta-chip">{formatTime(record.createdAt)}</span>
                  <span className="meta-chip">模型：{record.model}</span>
                  <span className="meta-chip">模板：{getTemplateLabel(record.templateId)}</span>
                </div>
              </div>

              <a href={record.url} target="_blank" rel="noreferrer" className="history-link">
                {record.url}
              </a>
              <p className="history-preview">{toPlainPreview(record.summary)}</p>

              {expanded ? (
                <div className="history-markdown-detail">
                  <MarkdownContent markdown={record.summary} />
                </div>
              ) : null}

              <div className="history-actions">
                <button type="button" className="ghost-btn" onClick={() => toggleExpanded(record.id)}>
                  {expanded ? "收起详情" : "查看详情"}
                </button>
                <button type="button" className="ghost-btn" onClick={() => copyRecord(record)}>
                  复制全文
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
