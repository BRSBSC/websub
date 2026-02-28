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
    <section className="card">
      <div className="row-between">
        <h2>最近 10 条历史</h2>
        <button type="button" className="ghost-btn" onClick={loadHistory} disabled={loading}>
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>

      {error ? <p className="status error">{error}</p> : null}

      {!loading && records.length === 0 ? <p className="hint">暂无历史记录。</p> : null}

      <ul className="history-list">
        {records.map((record) => (
          <li key={record.id} className="history-item">
            <div className="history-meta">
              <strong>{record.title}</strong>
              <span>{formatTime(record.createdAt)}</span>
              <span>模型：{record.model}</span>
              <span>模板：{getTemplateLabel(record.templateId)}</span>
            </div>

            <a href={record.url} target="_blank" rel="noreferrer">
              {record.url}
            </a>
            <p>{toPlainPreview(record.summary)}</p>

            {expandedRecordIds.includes(record.id) ? (
              <div className="history-markdown-detail">
                <MarkdownContent markdown={record.summary} />
              </div>
            ) : null}

            <div className="button-group">
              <button type="button" className="ghost-btn" onClick={() => toggleExpanded(record.id)}>
                {expandedRecordIds.includes(record.id) ? "收起详情" : "查看详情"}
              </button>
              <button type="button" className="ghost-btn" onClick={() => copyRecord(record)}>
                复制全文
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
