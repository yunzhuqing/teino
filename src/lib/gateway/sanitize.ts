/**
 * 日志里的上游错误形如「<供应商名>: HTTP 500 <上游响应体>」，供应商名与上游响应体
 * （可能含上游账号 / 组织 id）都属于内部信息，对用户只保留状态码；网关自身的提示原样保留。
 */
export function sanitizeError(error: string, providerNames: readonly string[]): string {
  return error
    .split("\n")
    .map((line) => {
      const provider = providerNames.find((n) => line.startsWith(`${n}: `));
      if (!provider) return line;
      const http = /^HTTP (\d{3})/.exec(line.slice(provider.length + 2));
      return http ? `上游返回 HTTP ${http[1]}` : "上游调用失败";
    })
    .join("\n");
}
