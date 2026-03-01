import { AppError } from "./errors";
import { QWEN_AUTH_ERROR_MESSAGE } from "./qwen";
import {
  clearQwenTokens,
  getQwenAuthStatus,
  getQwenTokens,
  saveQwenTokens
} from "./storage";
import type { QwenTokens, WebProviderAuthStatus } from "./types";

const QWEN_HOME_URL = "https://chat.qwen.ai/";
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
        reject(new AppError("无法打开 Qwen 页面，请重试。", { code: "RUNTIME" }));
        return;
      }

      if (!tab?.id) {
        reject(new AppError("无法创建 Qwen 标签页，请重试。", { code: "RUNTIME" }));
        return;
      }

      resolve(tab);
    });
  });
}

function readTabToken(tabId: number): Promise<{ token: string }> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        world: "MAIN",
        func: () => {
          try {
            const token = window.localStorage.getItem("token");
            return {
              token: typeof token === "string" ? token : ""
            };
          } catch {
            return {
              token: ""
            };
          }
        }
      },
      (results) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new AppError("读取 Qwen 登录状态失败，请重试。", { code: "RUNTIME" }));
          return;
        }

        const raw = results?.[0]?.result as { token?: string } | undefined;
        resolve({
          token: typeof raw?.token === "string" ? raw.token.trim() : ""
        });
      }
    );
  });
}

async function pollToken(tabId: number, timeoutMs: number): Promise<{ token: string }> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const next = await readTabToken(tabId);
      if (next.token) {
        return next;
      }
    } catch {
      // Page may not be ready yet; continue polling until timeout.
    }

    await wait(POLL_INTERVAL_MS);
  }

  return { token: "" };
}

async function persistToken(token: string): Promise<QwenTokens> {
  return saveQwenTokens({ token });
}

export async function ensureQwenToken(): Promise<QwenTokens> {
  const localTokens = await getQwenTokens();
  if (!localTokens?.token) {
    throw new AppError("未检测到 Qwen 登录状态，请先连接 Qwen。", { code: "AUTH" });
  }

  return localTokens;
}

export async function connectQwenInteractive(): Promise<WebProviderAuthStatus> {
  const tab = await createTab({
    url: QWEN_HOME_URL,
    active: true
  });

  const tokens = await pollToken(tab.id as number, INTERACTIVE_CONNECT_TIMEOUT_MS);
  if (!tokens.token) {
    throw new AppError("未检测到 Qwen 登录状态，请在打开的 Qwen 页面完成登录后重试。", {
      code: "AUTH"
    });
  }

  await persistToken(tokens.token);
  return getQwenAuthStatus();
}

export async function invalidateQwenTokens(): Promise<void> {
  await clearQwenTokens();
}

export function assertQwenAuthorized(tokens: QwenTokens | null): QwenTokens {
  if (!tokens?.token) {
    throw new AppError(QWEN_AUTH_ERROR_MESSAGE, { code: "AUTH" });
  }
  return tokens;
}
