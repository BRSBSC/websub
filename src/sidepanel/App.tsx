import { History, SlidersHorizontal, Sparkles, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getSettings } from "../lib/storage";
import type { ThemePreference } from "../lib/types";
import { HistoryPage } from "./pages/HistoryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SummaryPage } from "./pages/SummaryPage";

type TabKey = "summary" | "settings" | "history";

type ResolvedTheme = "light" | "dark";

const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";

const TAB_ITEMS: Array<{ key: TabKey; label: string; icon: LucideIcon }> = [
  { key: "summary", label: "总结", icon: Sparkles },
  { key: "settings", label: "设置", icon: SlidersHorizontal },
  { key: "history", label: "历史", icon: History }
];

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }

  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? "dark" : "light";
}

function resolveTheme(preference: ThemePreference, systemTheme: ResolvedTheme): ResolvedTheme {
  return preference === "system" ? systemTheme : preference;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("summary");
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());

  useEffect(() => {
    let mounted = true;

    void (async () => {
      try {
        const settings = await getSettings();
        if (mounted) {
          setThemePreference(settings.themePreference);
        }
      } catch {
        // Ignore theme bootstrap failures and keep safe defaults.
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY);
    const onChange = () => {
      setSystemTheme(mediaQuery.matches ? "dark" : "light");
    };

    onChange();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", onChange);
      return () => mediaQuery.removeEventListener("change", onChange);
    }

    mediaQuery.addListener(onChange);
    return () => mediaQuery.removeListener(onChange);
  }, []);

  const resolvedTheme = useMemo(
    () => resolveTheme(themePreference, systemTheme),
    [systemTheme, themePreference]
  );

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  const content = useMemo(() => {
    if (activeTab === "summary") {
      return <SummaryPage />;
    }

    if (activeTab === "settings") {
      return <SettingsPage onThemePreferenceChange={setThemePreference} />;
    }

    return <HistoryPage />;
  }, [activeTab]);

  const currentThemeLabel =
    themePreference === "system"
      ? `系统${systemTheme === "dark" ? "深色" : "浅色"}`
      : themePreference === "dark"
        ? "深色"
        : "浅色";

  return (
    <div className="app-shell">
      <header className="app-header app-brand">
        <div className="brand-top">
          <span className="brand-badge">Websum</span>
          <span className="theme-badge">主题：{currentThemeLabel}</span>
        </div>
        <h1>网页总结助手</h1>
        <p>整页一键总结，支持模板切换、历史追溯与深浅主题。</p>
      </header>

      <nav className="segment-nav" aria-label="功能页签">
        {TAB_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.key === activeTab;
          return (
            <button
              key={item.key}
              className={active ? "segment-btn active" : "segment-btn"}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => setActiveTab(item.key)}
            >
              <Icon size={16} strokeWidth={2} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <main className="page-body">{content}</main>
    </div>
  );
}
