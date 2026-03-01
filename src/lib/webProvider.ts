import type { WebProviderType } from "./types";

export type WebProvider = WebProviderType;

export function isWebProvider(provider: string): provider is WebProvider {
  return provider === "kimi_web" || provider === "qwen_web";
}

export function getWebProviderLabel(provider: WebProvider): string {
  return provider === "kimi_web" ? "Kimi（免 Key）" : "Qwen 国际版（免 Key）";
}

export function getWebProviderName(provider: WebProvider): string {
  return provider === "kimi_web" ? "Kimi" : "Qwen";
}

export function getAuthInvalidMessage(provider: WebProvider): string {
  return `登录状态失效，请重新连接 ${getWebProviderName(provider)}`;
}
