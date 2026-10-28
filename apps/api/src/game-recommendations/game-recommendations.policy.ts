import { z } from "zod";
import { conflict, unprocessable } from "../auth/problem";
import { unavailable } from "../friendships/friendships.policy";
export const uuid = z.string().uuid().transform(value => value.toLowerCase());
export const sendRequest = z.object({friendshipId:uuid}).strict();
export const decisionRequest = z.object({expectedVersion:z.number().int().min(1).max(2147483647)}).strict();
export const listQuery = z.object({view:z.enum(["received","sent"]),
  limit:z.coerce.number().int().min(1).max(20).default(20),cursor:z.string().min(1).max(2048).optional()}).strict();
export function parse<T>(schema:z.ZodType<T>,input:unknown):T {
  const result=schema.safeParse(input);
  if (!result.success) throw unprocessable("GAME_RECOMMENDATION_INPUT_INVALID","Некорректный запрос");
  return result.data;
}
export type Action = "hide"|"withdraw";
export type RecommendationRow = {
  id:string;friendship_id:string;friendship_generation:string;game_id:string;
  sender_user_id:string;recipient_user_id:string;sender_epoch:string;recipient_epoch:string;
  state:"active"|"withdrawn";recipient_hidden:boolean;version:number;created_at:Date;expires_at:Date;
};
export type Receipt = {id:string;version:number;outcome:"sent"|"hidden"|"withdrawn"};
export function assertRole(row:RecommendationRow,actor:string,action:Action) {
  if ((action==="hide" ? row.recipient_user_id : row.sender_user_id)!==actor) unavailable();
}
export function assertDecision(row:RecommendationRow,actor:string,action:Action,version:number) {
  assertRole(row,actor,action);
  if (row.version!==version || row.version===2147483647 || row.state!=="active"
    || (action==="hide" && row.recipient_hidden)) stale();
}
export function stale():never {throw conflict("GAME_RECOMMENDATION_STALE","Состояние изменилось");}
