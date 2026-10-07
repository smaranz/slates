/* Whirl reported product analytics to PostHog. Slates keeps nothing about
   how it's used, so every event is named and then dropped. */

export const analyticsEnabled = false;

export const ANALYTICS_EVENTS = {
  messageSent: "messageSent",
  messageSendFailed: "messageSendFailed",
  messageQueued: "messageQueued",
  messageDequeued: "messageDequeued",
  generationRetried: "generationRetried",
  generationStopped: "generationStopped",
  messageEdited: "messageEdited",
  messageQuoted: "messageQuoted",
  threadBranched: "threadBranched",
  threadRolledBack: "threadRolledBack",
  threadRenamed: "threadRenamed",
  threadTitleRegenerated: "threadTitleRegenerated",
  threadDeleted: "threadDeleted",
  threadPinToggled: "threadPinToggled",
  threadFolderChanged: "threadFolderChanged",
  threadShared: "threadShared",
  threadShareRevoked: "threadShareRevoked",
  threadLocked: "threadLocked",
  threadUnlocked: "threadUnlocked",
  threadUnlockFailed: "threadUnlockFailed",
  threadLockPasswordChanged: "threadLockPasswordChanged",
  threadLockRemoved: "threadLockRemoved",
  lockedTurnSent: "lockedTurnSent",
  lockedTurnFailed: "lockedTurnFailed",
  folderCreated: "folderCreated",
  folderRenamed: "folderRenamed",
  folderDeleted: "folderDeleted",
  integrationSuggestionShown: "integrationSuggestionShown",
  integrationSuggestionClicked: "integrationSuggestionClicked",
  frontendPerformance: "frontendPerformance",
  supportOpened: "supportOpened",
  visitorLanded: "visitorLanded",
  signupStarted: "signupStarted",
  signupCompleted: "signupCompleted",
  paywallViewed: "paywallViewed",
  checkoutStarted: "checkoutStarted",
} as const;

export type AnalyticsEvent = string;

export function initializePostHog() {}

export function captureEvent(_event: AnalyticsEvent, _properties?: Record<string, unknown>) {}

export function captureEventOnce(_event: AnalyticsEvent, _properties?: Record<string, unknown>) {}
