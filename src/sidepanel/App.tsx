import { useMemo, useState } from "react";
import { HistoryPage } from "./pages/HistoryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SummaryPage } from "./pages/SummaryPage";

type TabKey = "summary" | "settings" | "history";

const TAB_ITEMS: Array<{ key: TabKey; label: string }> = [
  { key: "summary", label: "总结" },
  { key: "settings", label: "设置" },
  { key: "history", label: "历史" }
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("summary");

  const content = useMemo(() => {
    if (activeTab === "summary") {
      return <SummaryPage />;
    }

    if (activeTab === "settings") {
      return <SettingsPage />;
    }

    return <HistoryPage />;
  }, [activeTab]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>网页总结助手</h1>
        <p>整页一键总结，支持多种默认模板与自定义提示词</p>
      </header>

      <nav className="tab-nav" aria-label="功能页签">
        {TAB_ITEMS.map((item) => (
          <button
            key={item.key}
            className={item.key === activeTab ? "tab-btn active" : "tab-btn"}
            type="button"
            onClick={() => setActiveTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main className="page-body">{content}</main>
    </div>
  );
}
