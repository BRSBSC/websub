import { AppError } from "./errors";
import { KIMI_AUTH_ERROR_MESSAGE } from "./kimi";
import { clearKimiTokens, getKimiAuthStatus, getKimiTokens, saveKimiTokens } from "./storage";
import type { KimiAuthStatus, KimiTokens } from "./types";

const KIMI_HOME_URL = "https://www.kimi.com/";
const AUTO_CONNECT_TIMEOUT_MS = 10_000;
const INTERACTIVE_CONNECT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTab(options: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(options, (tab) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new AppError("无法打开 Kimi 页面，请重试。", { code: "RUNTIME" }));
        return;
      }

      if (!tab?.id) {
        reject(new AppError("无法创建 Kimi 标签页，请重试。", { code: "RUNTIME" }));
        return;
      }

      resolve(tab);
    });
  });
}

function closeTab(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.remove(tabId, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new AppError("无法关闭临时标签页，请重试。", { code: "RUNTIME" }));
        return;
      }

      resolve();
    });
  });
}

function readTabRefreshToken(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        world: "MAIN",
        func: () => {
          try {
            const token = window.localStorage.getItem("refresh_token");
            return typeof token === "string" ? token : "";
          } catch {
            return "";
          }
        }
      },
      (results) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new AppError("读取 Kimi 登录状态失败，请重试。", { code: "RUNTIME" }));
          return;
        }

        const resultToken = results?.[0]?.result;
        resolve(typeof resultToken === "string" ? resultToken.trim() : "");
      }
    );
  });
}

async function pollRefreshToken(tabId: number, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const token = await readTabRefreshToken(tabId);
      if (token) {
        return token;
      }
    } catch {
      // Page may not be ready yet; continue polling until timeout.
    }

    await wait(POLL_INTERVAL_MS);
  }

  return "";
}

async function persistRefreshToken(refreshToken: string): Promise<KimiTokens> {
  return saveKimiTokens({
    refreshToken
  });
}

export async function ensureKimiRefreshToken(): Promise<KimiTokens> {
  const localTokens = await getKimiTokens();
  if (localTokens?.refreshToken) {
    return localTokens;
  }

  const hiddenTab = await createTab({
    url: KIMI_HOME_URL,
    active: false
  });

  try {
    const refreshToken = await pollRefreshToken(hiddenTab.id as number, AUTO_CONNECT_TIMEOUT_MS);
    if (!refreshToken) {
      throw new AppError("未检测到 Kimi 登录状态，请先连接 Kimi。", { code: "AUTH" });
    }

    return persistRefreshToken(refreshToken);
  } finally {
    await closeTab(hiddenTab.id as number).catch(() => undefined);
  }
}

export async function connectKimiInteractive(): Promise<KimiAuthStatus> {
  const tab = await createTab({
    url: KIMI_HOME_URL,
    active: true
  });

  const refreshToken = await pollRefreshToken(tab.id as number, INTERACTIVE_CONNECT_TIMEOUT_MS);
  if (!refreshToken) {
    throw new AppError("未检测到 Kimi 登录状态，请在打开的 Kimi 页面完成登录后重试。", {
      code: "AUTH"
    });
  }

  await persistRefreshToken(refreshToken);
  return getKimiAuthStatus();
}

export async function invalidateKimiTokens(): Promise<void> {
  await clearKimiTokens();
}

export function assertKimiAuthorized(tokens: KimiTokens | null): KimiTokens {
  if (!tokens?.refreshToken) {
    throw new AppError(KIMI_AUTH_ERROR_MESSAGE, { code: "AUTH" });
  }
  return tokens;
}
