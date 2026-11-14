import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { AuthCoordinator } from './auth-coordinator.ts';
import { createNativeApi } from './native-api.ts';
import { base64Url } from './native-auth-protocol.ts';

// One coordinator for root provider, initial verified link and warm Linking delivery.
export const nativeAuth = new AuthCoordinator({
  api: createNativeApi(),
  store: {
    getItem: key => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  },
  random: () => base64Url(Crypto.getRandomBytes(32)),
  challenge: async verifier => (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
});
