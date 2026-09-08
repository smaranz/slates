"use client";

import { useMobileRuntime } from "./MobileRuntime";

export default function NotificationSettingsCard() {
  const runtime = useMobileRuntime();

  let status = "Available in the installed mobile app";
  if (runtime.permission === "checking") status = "Checking iPhone permission…";
  if (runtime.permission === "prompt" || runtime.permission === "prompt-with-rationale") {
    status = "Not enabled";
  }
  if (runtime.permission === "denied") status = "Blocked in system settings";
  if (runtime.permission === "granted") {
    status = runtime.remindersWanted
      ? `${runtime.scheduledCount} upcoming reminder${runtime.scheduledCount === 1 ? "" : "s"}`
      : "Allowed, but turned off in Slates";
  }

  return (
    <div className="card notification-settings-card" style={{ padding: "20px 22px" }}>
      <div className="notification-settings-head">
        <span className="card-title">Assignment reminders</span>
        <span className={`notification-permission notification-permission--${runtime.permission}`}>
          {status}
        </span>
      </div>
      <p className="notification-settings-copy">
        One local alert, one hour before upcoming assignments that have an exact due time. Date-only,
        completed, submitted, and archived work is skipped.
      </p>
      <p className="notification-settings-note">
        Slates refreshes the schedule when the app opens or syncs. It does not sync Schoology in the
        background and does not use remote push notifications.
      </p>

      <div className="notification-settings-actions">
        {!runtime.native && <span className="notification-unavailable">Open Slates on iPhone or Android to enable alerts.</span>}
        {runtime.native && runtime.permission !== "granted" && runtime.permission !== "denied" && (
          <button className="btn btn--primary" onClick={() => void runtime.enableReminders()} disabled={runtime.busy}>
            Enable reminders
          </button>
        )}
        {runtime.native && runtime.permission === "granted" && !runtime.remindersWanted && (
          <button className="btn btn--primary" onClick={() => void runtime.enableReminders()} disabled={runtime.busy}>
            Turn on reminders
          </button>
        )}
        {runtime.native && runtime.permission === "granted" && runtime.remindersWanted && (
          <button className="btn" onClick={() => void runtime.disableReminders()} disabled={runtime.busy}>
            Turn off reminders
          </button>
        )}
        {runtime.native && runtime.permission === "denied" && runtime.platform === "ios" && (
          <button className="btn btn--primary" onClick={() => void runtime.openSystemSettings()} disabled={runtime.busy}>
            Open iPhone Settings
          </button>
        )}
        {runtime.native && runtime.permission === "denied" && (
          <button className="btn" onClick={() => void runtime.checkAgain()} disabled={runtime.busy}>
            Check again
          </button>
        )}
      </div>
      {runtime.error && <p className="notification-settings-error">{runtime.error}</p>}
    </div>
  );
}
