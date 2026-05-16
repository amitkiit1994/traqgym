/**
 * Service-layer error types.
 * Use these instead of generic Error so callers can branch on type.
 */

export class ConfigurationError extends Error {
  constructor(public readonly setting: string, message?: string) {
    super(message ?? `Required configuration missing: ${setting}`);
    this.name = "ConfigurationError";
  }
}

export class NotEnabledError extends Error {
  constructor(public readonly feature: string, message?: string) {
    super(message ?? `Feature not enabled for this gym: ${feature}`);
    this.name = "NotEnabledError";
  }
}
