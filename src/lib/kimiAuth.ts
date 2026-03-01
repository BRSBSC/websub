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

function readTabRefreshToken(tabId: number): Promise<{ refreshToken: string; accessToken: string }> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        world: "MAIN",
        func: () => {
          try {
            const token = window.localStorage.getItem("refresh_token");
            const accessToken = window.localStorage.getItem("access_token");
            return {
              refreshToken: typeof token === "string" ? token : "",
              accessToken: typeof accessToken === "string" ? accessToken : ""
            };
          } catch {
            return {
              refreshToken: "",
              accessToken: ""
            };
          }
        }
      },
      (results) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new AppError("读取 Kimi 登录状态失败，请重试。", { code: "RUNTIME" }));
          return;
        }

        const raw = results?.[0]?.result as
          | { refreshToken?: string; accessToken?: string }
          | undefined;
        resolve({
          refreshToken: typeof raw?.refreshToken === "string" ? raw.refreshToken.trim() : "",
          accessToken: typeof raw?.accessToken === "string" ? raw.accessToken.trim() : ""
        });
      }
    );
  });
}

async function pollRefreshToken(tabId: number, timeoutMs: number): Promise<{
  refreshToken: string;
  accessToken: string;
}> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const tokens = await readTabRefreshToken(tabId);
      if (tokens.refreshToken) {
        return tokens;
      }
    } catch {
      // Page may not be ready yet; continue polling until timeout.
    }

    await wait(POLL_INTERVAL_MS);
  }

  return {
    refreshToken: "",
    accessToken: ""
  };
}

async function persistRefreshToken(refreshToken: string, accessToken?: string): Promise<KimiTokens> {
  return saveKimiTokens({
    refreshToken,
    accessToken
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
    const tokens = await pollRefreshToken(hiddenTab.id as number, AUTO_CONNECT_TIMEOUT_MS);
    if (!tokens.refreshToken) {
      throw new AppError("未检测到 Kimi 登录状态，请先连接 Kimi。", { code: "AUTH" });
    }

    return persistRefreshToken(tokens.refreshToken, tokens.accessToken);
  } finally {
    await closeTab(hiddenTab.id as number).catch(() => undefined);
  }
}

export async function connectKimiInteractive(): Promise<KimiAuthStatus> {
  const tab = await createTab({
    url: KIMI_HOME_URL,
    active: true
  });

  const tokens = await pollRefreshToken(tab.id as number, INTERACTIVE_CONNECT_TIMEOUT_MS);
  if (!tokens.refreshToken) {
    throw new AppError("未检测到 Kimi 登录状态，请在打开的 Kimi 页面完成登录后重试。", {
      code: "AUTH"
    });
  }

  await persistRefreshToken(tokens.refreshToken, tokens.accessToken);
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
