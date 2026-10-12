function decode(value: string): ArrayBuffer {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, c => c.charCodeAt(0)).buffer;
}
function encode(value: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
type DescriptorJSON = Omit<PublicKeyCredentialDescriptor, "id"> & { id: string };
type CreationJSON = Omit<PublicKeyCredentialCreationOptions, "challenge" | "user" | "excludeCredentials"> & {
  challenge: string; user: Omit<PublicKeyCredentialUserEntity, "id"> & { id: string }; excludeCredentials?: DescriptorJSON[];
};
type RequestJSON = Omit<PublicKeyCredentialRequestOptions, "challenge" | "allowCredentials"> & { challenge: string; allowCredentials?: DescriptorJSON[] };
export type OptionsJSON = CreationJSON | RequestJSON;
export function creationOptions(options: CreationJSON): PublicKeyCredentialCreationOptions {
  return { ...options, challenge: decode(options.challenge), user: { ...options.user, id: decode(options.user.id) },
    excludeCredentials: options.excludeCredentials?.map(item => ({ ...item, id: decode(item.id) })) };
}
export function requestOptions(options: RequestJSON): PublicKeyCredentialRequestOptions {
  return { ...options, challenge: decode(options.challenge), allowCredentials: options.allowCredentials?.map(item => ({ ...item, id: decode(item.id) })) };
}
export async function webauthn(options: OptionsJSON, enroll: boolean, signal: AbortSignal) {
  if (!window.isSecureContext || !navigator.credentials || typeof PublicKeyCredential === "undefined")
    throw new Error("WebAuthn unavailable");
  const credential = (enroll
    ? await navigator.credentials.create({ publicKey: creationOptions(options as CreationJSON), signal })
    : await navigator.credentials.get({ publicKey: requestOptions(options as RequestJSON), signal })) as PublicKeyCredential | null;
  if (!credential) throw new Error("No credential");
  const base = { id: credential.id, rawId: encode(credential.rawId), type: credential.type, clientExtensionResults: credential.getClientExtensionResults(), authenticatorAttachment: credential.authenticatorAttachment };
  if (enroll) {
    const response = credential.response as AuthenticatorAttestationResponse;
    return { ...base, response: { clientDataJSON: encode(response.clientDataJSON), attestationObject: encode(response.attestationObject), transports: response.getTransports() } };
  }
  const response = credential.response as AuthenticatorAssertionResponse;
  return { ...base, response: { clientDataJSON: encode(response.clientDataJSON), authenticatorData: encode(response.authenticatorData), signature: encode(response.signature), userHandle: response.userHandle ? encode(response.userHandle) : null } };
}
