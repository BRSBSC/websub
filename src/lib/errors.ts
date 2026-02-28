export type AppErrorCode =
  | "HTTP"
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

export function toUserMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return "请求超时，请重试。";
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "发生未知错误，请稍后重试。";
}
