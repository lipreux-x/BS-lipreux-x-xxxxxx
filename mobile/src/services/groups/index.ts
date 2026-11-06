/*
 * Group flows on top of the API, the crypto module and the vault (SPEC §4.3–4.4).
 * Split across this folder; this barrel keeps `@/services/groups` as the single
 * import surface. See core.ts for the overview of what protects a group.
 */
export * from './core';
export * from './profiles';
export * from './verify';
export * from './list';
export * from './membership';
export * from './messages';
export * from './attachments';
export * from './unlock';
export * from './sync';
export * from './admin';
