import type { GameCoverReceipt } from "@gobadminton/contracts";
export type { GameCoverReceipt };
export class GameCoverError extends Error { constructor(public readonly status:number){super("Не удалось сохранить фото игры");} }
export async function gameCoverRequest(id:string,method:"GET"|"PUT"|"DELETE",signal:AbortSignal,
  access?:{version:number;csrfToken:string},blob?:Blob):Promise<GameCoverReceipt> {
  if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error("Игра не найдена");
  const headers=new Headers({Accept:"application/json"});let body:BodyInit|undefined;
  if(method!=="GET"){
    if(!access)throw new Error("Обновите данные");
    headers.set("X-CSRF-Token",access.csrfToken);headers.set("Idempotency-Key",crypto.randomUUID());
    headers.set("X-Game-Version",String(access.version));
    headers.set("Content-Type",blob?blob.type:"application/json");
    body=blob??JSON.stringify({expectedVersion:access.version});
  }
  const response=await fetch(`/v1/games/${id}/cover`,{method,headers,body,credentials:"include",cache:"no-store",signal});
  if(!response.ok)throw new GameCoverError(response.status);
  return await response.json() as GameCoverReceipt;
}
