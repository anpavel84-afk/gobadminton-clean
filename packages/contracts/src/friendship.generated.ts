// Generated from openapi.json by scripts/generate-friendship-types.mjs. Do not edit.
export type PlayerAvatar = { "uploadedUrl": string | null; "providerUrl": string | null };
export type FriendshipView = { "friendshipId": string | null; "relationship": "none" | "outgoing_pending" | "incoming_pending" | "friends" | "unavailable"; "version": string | null; "request": { "id": string; "expiresAt": string } | null; "peer": { "publicPlayerId": string; "displayName": string; "avatar": PlayerAvatar } | null; "capabilities": { "canRequest": boolean; "canAccept": boolean; "canDecline": boolean; "canCancel": boolean; "canRemove": boolean } };
export type FriendshipReceipt = { "friendshipId": string; "requestId": string; "version": string; "outcome": "pending" | "accepted" | "declined" | "cancelled" | "removed" };
export type FriendshipCreateRequest = { "targetPublicPlayerId": string };
export type FriendshipDecisionRequest = { "expectedVersion": string };
export type FriendshipList = { "items": Array<FriendshipView>; "nextCursor": string | null; "asOf": string };
export type FriendshipStates = { "items": Array<FriendshipView> };
export type SocialCapabilities = { "friends": boolean; "gameRecommendations": boolean; "gameAttention": boolean; "socialPush": boolean };
export type PlayInterestView = { "interestId": string | null; "relationship": "none" | "outgoing" | "mutual" | "unavailable"; "version": string | null; "capabilities": { "canSend": boolean; "canWithdraw": boolean } };
export type PlayInterestReceipt = { "interestId": string; "version": string; "outcome": "outgoing" | "mutual" | "withdrawn" };
export type PlayInterestCreateRequest = { "targetPublicPlayerId": string };
export type PlayInterestWithdrawRequest = { "expectedVersion": string };
export type PlayInterestStates = { "items": Array<PlayInterestView> };
