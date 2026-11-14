import { apiFetch } from "./api-client";
export function nativeBridgeCommand<T>(transactionId: string, action: "bind" | "complete" | "cancel", csrfToken?: string) {
  return apiFetch<T>(`/v1/auth/native/transactions/${encodeURIComponent(transactionId)}/${action}`, {
    method: "POST", headers: { "X-Native-Auth": "1" }, body: "{}", csrfToken,
  });
}
