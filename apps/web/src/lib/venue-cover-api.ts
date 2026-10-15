import type { VenueCoverReceipt, VenueCoverAccess } from "@gobadminton/contracts";
export async function venueCoverRequest<T>(venueId: string, method: "GET" | "PUT" | "DELETE", signal: AbortSignal,
  receipt?: VenueCoverAccess, blob?: Blob): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(venueId)) throw new Error("Площадка не найдена");
  const headers = new Headers({Accept:"application/json"});
  let body: BodyInit | undefined;
  if (method === "GET") { body=undefined; }
  else {
    if (!receipt) throw new Error("Обновите данные");
    headers.set("X-CSRF-Token",receipt.csrfToken); headers.set("Idempotency-Key",crypto.randomUUID());
    if (blob) { headers.set("Content-Type",blob.type);headers.set("X-Venue-Version",String(receipt.version));body=blob; }
    else { headers.set("Content-Type","application/json");body=JSON.stringify({expectedVersion:receipt.version}); }
  }
  const response=await fetch(`/v1/admin/venues/${venueId}/cover${method === "GET" ? "/access" : ""}`,{
    method,headers,body,credentials:"include",cache:"no-store",signal});
  if (!response.ok) throw new VenueCoverError(response.status);
  return await response.json() as T;
}
export class VenueCoverError extends Error { constructor(public readonly status:number) {super("Не удалось сохранить обложку. Обновите данные и проверьте разрешение на редактирование.");} }
export type { VenueCoverReceipt, VenueCoverAccess };
