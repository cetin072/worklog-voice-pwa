import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

import { createDurableStorage } from './durable-storage';

const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** Single owner for encrypted session and device-state keys in this JS runtime. */
export const secureSessionStorage = createDurableStorage({
  store: {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value, STORE_OPTIONS),
    removeItem: (key) => SecureStore.deleteItemAsync(key),
  },
  newGenerationId: () => Crypto.randomUUID().replace(/-/g, ''),
  digest: (value) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
});
