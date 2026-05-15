import CryptoJS from 'crypto-js';
import { config } from '../config';

const ENCRYPTION_KEY = config.encryption.key;

export const encrypt = (text: string): string => {
  if (!text) return '';
  try {
    const encrypted = CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
    return encrypted;
  } catch (error) {
    throw new Error(`Encryption failed: ${error}`);
  }
};

export const decrypt = (encryptedText: string): string => {
  if (!encryptedText) return '';
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedText, ENCRYPTION_KEY);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    if (!decrypted) {
      throw new Error('Decryption resulted in empty string');
    }
    return decrypted;
  } catch (error) {
    throw new Error(`Decryption failed: ${error}`);
  }
};

export const hashValue = (value: string): string => {
  return CryptoJS.SHA256(value).toString();
};

export const generateSecureToken = (length: number = 32): string => {
  const words = CryptoJS.lib.WordArray.random(length);
  return words.toString(CryptoJS.enc.Hex);
};

export default { encrypt, decrypt, hashValue, generateSecureToken };
