import { AppError, toUserMessage } from "../lib/errors";
import { fetchModels, summarizePage } from "../lib/openai";
import { resolveEffectiveTemplateId } from "../lib/prompt";
import { addSummaryRecord } from "../lib/storage";
import type {
  FetchModelsResult,
  PageContent,
  RuntimeMessage,
  RuntimeResponse,
  Settings,
  SummarizeResult,
  SummaryRecord
} from "../lib/types";

type SidePanelApi = {
  open: (options: { windowId: number }) => Promise<void>;
  setPanelBehavior?: (options: { openPanelOnActionClick: boolean }) => Promise<void>;
};

const sidePanelApi = (chrome as unknown as { sidePanel?: SidePanelApi }).sidePanel;

chrome.runtime.onInstalled.addListener(() => {
  if (!sidePanelApi?.setPanelBehavior) {
    return;
  }

  void sidePanelApi.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

chrome.action.onClicked.addListener((tab) => {
  if (typeof tab.windowId !== "number") {
    return;
  }

  void openSidePanel(tab.windowId);
});

chrome.runtime.onMessage.addListener(
  (
    message: RuntimeMessage,
    _sender,
    sendResponse: (response: RuntimeResponse<FetchModelsResult | SummarizeResult | null>) => void
  ) => {
    void handleMessage(message)
      .then((data) => {
        sendResponse({ ok: true, data });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: toUserMessage(error) });
      });

    return true;
  }
);

async function handleMessage(
  message: RuntimeMessage
): Promise<FetchModelsResult | SummarizeResult | null> {
  switch (message.type) {
    case "OPEN_SIDE_PANEL": {
      const tab = await getActiveTab();
      if (typeof tab.windowId !== "number") {
        throw new AppError("无法定位当前窗口。", { code: "RUNTIME" });
      }

      await openSidePanel(tab.windowId);
      return null;
    }
    case "FETCH_MODELS": {
      const models = await fetchModels(message.payload);
      return { models };
    }
    case "SUMMARIZE_ACTIVE_TAB": {
      return summarizeActiveTab(message.payload.settings);
    }
    default: {
      throw new AppError("未知消息类型。", { code: "RUNTIME" });
    }
  }
}

async function summarizeActiveTab(settings: Settings): Promise<SummarizeResult> {
  const tab = await getActiveTab();
  const tabId = tab.id;
  const url = tab.url ?? "";

  if (typeof tabId !== "number") {
    throw new AppError("未找到当前标签页。", { code: "RUNTIME" });
  }

  if (isRestrictedUrl(url)) {
    throw new AppError("当前页面不支持总结（例如 chrome:// 页面）。", {
      code: "VALIDATION"
    });
  }

  const pageContent = await extractPageContent(tabId);
  if (pageContent.text.trim().length < 80) {
    throw new AppError("页面正文过少，无法生成可靠总结。", { code: "VALIDATION" });
  }

  const summary = await summarizePage({
    settings,
    pageContent
  });
  const effectiveTemplateId = resolveEffectiveTemplateId(settings);

  const record: SummaryRecord = {
    id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}`,
    title: pageContent.title,
    url: pageContent.url,
    summary,
    model: settings.model,
    templateId: effectiveTemplateId,
    createdAt: new Date().toISOString()
  };

  await addSummaryRecord(record);

  return {
    pageContent,
    summary,
    record
  };
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new AppError("查询当前标签页失败。", { code: "RUNTIME" }));
        return;
      }

      const tab = tabs[0];
      if (!tab) {
        reject(new AppError("未找到当前活动标签页。", { code: "RUNTIME" }));
        return;
      }

      resolve(tab);
    });
  });
}

async function extractPageContent(tabId: number): Promise<PageContent> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PAGE_CONTENT" }, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(
          new AppError("无法读取当前页面内容，请确认页面允许脚本运行。", { code: "RUNTIME" })
        );
        return;
      }

      if (!response || response.ok !== true) {
        reject(
          new AppError(
            typeof response?.error === "string" ? response.error : "正文提取失败。",
            { code: "RUNTIME" }
          )
        );
        return;
      }

      resolve(response.data as PageContent);
    });
  });
}

async function openSidePanel(windowId: number): Promise<void> {
  if (!sidePanelApi?.open) {
    throw new AppError("当前浏览器版本不支持 Side Panel。", { code: "RUNTIME" });
  }

  await sidePanelApi.open({ windowId });
}

function isRestrictedUrl(url: string): boolean {
  return /^(chrome|chrome-extension|devtools|about):/i.test(url);
}
