/**
 * ScamShield — on-device, explainable scam-message detection for mobile-money
 * users, plus the phone-number encoding shared with the fraud-registry
 * contract. Browser-only, no dependencies, no network access.
 */
export {
  classifyMessage,
  FEATURES,
  BIAS,
  SCAM_THRESHOLD,
  SUSPICIOUS_THRESHOLD,
} from './classifier';
export type {
  ClassificationResult,
  ClassifyOptions,
  FeatureId,
  ScamLabel,
  ScamSignal,
} from './classifier';
export {
  normalizeKenyanMsisdn,
  extractPhoneNumbers,
  targetBytes,
  TARGET_BYTES_LENGTH,
} from './phone';
