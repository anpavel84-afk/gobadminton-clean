/** Native server foundation. Disabled by default; does not imply client/device acceptance. */
export type NativeTransactionRequest = { clientId:string; redirectUri:string; codeChallenge:string; codeChallengeMethod:"S256"; state:string; returnPath?:string };
export type NativeTransactionResponse = { transactionId:string; expiresAt:string; browserStartUrl:string };
export type NativeExchangeRequest = { clientId:string; redirectUri:string; code:string; verifier:string };
export type NativeCredentials = { accessToken:string;refreshToken:string;tokenType:"Bearer";expiresIn:600;refreshExpiresAt:string;refreshAbsoluteExpiresAt:string;sessionId:string };
export type NativeMe = { id:string;displayName:string;locale:string;linkedProviders:string[];session:{id:string;audience:"consumer_native";transport:"bearer"} };
