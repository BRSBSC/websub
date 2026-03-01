export type AppErrorCode =
  | "HTTP"
  | "AUTH"
  | "TIMEOUT"
  | "NETWORK"
  | "VALIDATION"
  | "RUNTIME"
  | "UNKNOWN";

export class AppError extends Error {
  public readonly code: AppErrorCode;
  public readonly status?: number;

  constructor(
    message: string,
    options?: {
      code?: AppErrorCode;
      status?: number;
    }
  ) {
    super(message);
    this.name = "AppError";
    this.code = options?.code ?? "UNKNOWN";
    this.status = options?.status;
  }
}

export function mapHttpStatusToMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "API Key 无效或无权限，请检查配置。";
  }

  if (status === 429) {
    return "请求过于频繁，请稍后重试。";
  }

  if (status >= 500) {
    return "模型服务暂时不可用，请稍后重试。";
  }

  return `请求失败（HTTP ${status}）。`;
}

export function createHttpError(status: number, detail?: string): AppError {
  const safeDetail = typeof detail === "string" ? detail.trim() : "";
  const baseMessage = mapHttpStatusToMessage(status);
  const message = safeDetail.length > 0 ? `${baseMessage} ${safeDetail}` : baseMessage;
  return new AppError(message, {
    code: "HTTP",
    status
  });
}

function defaultMessageForCode(code: AppErrorCode): string {
  switch (code) {
    case "AUTH":
      return "登录状态失效，请重新连接。";
    case "TIMEOUT":
      return "请求超时，请重试。";
    case "NETWORK":
      return "网络连接失败，请检查网络后重试。";
    case "VALIDATION":
      return "请求参数不完整，请检查后重试。";
    case "RUNTIME":
      return "扩展运行异常，请刷新页面后重试。";
    default:
      return "发生未知错误，请稍后重试。";
  }
}

export function toUserMessage(error: unknown): string {
  if (error instanceof AppError) {
    const directMessage = error.message.trim();
    return directMessage.length > 0 ? directMessage : defaultMessageForCode(error.code);
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return "请求超时，请重试。";
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "发生未知错误，请稍后重试。";
}
