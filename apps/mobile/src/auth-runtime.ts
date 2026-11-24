import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Linking, Platform } from 'react-native';
import { AuthCoordinator } from './auth-coordinator.ts';
import { createExpoReinstallGuard } from './ios-reinstall.ts';
import { createNativeApi } from './native-api.ts';
import { SECURE_AUTH_KEY, base64Url } from './native-auth-protocol.ts';

// iOS Keychain outlives app deletion; clear a reinstalled app's stale session before the first read or write.
const iosReinstallGuard = Platform.OS === 'ios'
  ? createExpoReinstallGuard(Platform.OS, () => SecureStore.deleteItemAsync(SECURE_AUTH_KEY))
  : null;

// One coordinator for root provider, initial verified link and warm Linking delivery.
export const nativeAuth = new AuthCoordinator({
  api: createNativeApi(),
  store: iosReinstallGuard ? {
    getItem: async key => { await iosReinstallGuard(); return SecureStore.getItemAsync(key); },
    setItem: async (key, value) => { await iosReinstallGuard();
      return SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }); },
  } : {
    getItem: key => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  },
  random: () => base64Url(Crypto.getRandomBytes(32)),
  challenge: async verifier => (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  // Immediate static Linking invocation — no async gap after private-contact admission.
  openExternalUrl: url => Promise.resolve(Linking.openURL(url)).then(() => undefined),
});
