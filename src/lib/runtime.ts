import type { RuntimeMessage, RuntimeResponse } from "./types";

export function sendRuntimeMessage<T>(message: RuntimeMessage): Promise<RuntimeResponse<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: RuntimeResponse<T> | undefined) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        resolve({
          ok: false,
          error: "扩展通信失败，请刷新页面后重试。"
        });
        return;
      }

      if (!response) {
        resolve({
          ok: false,
          error: "扩展未返回有效结果，请重试。"
        });
        return;
      }

      resolve(response);
    });
  });
}
