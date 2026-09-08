"use client";

import { App } from "@capacitor/app";
import { AppLauncher } from "@capacitor/app-launcher";
import { Capacitor, type PermissionState, type PluginListenerHandle } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Network } from "@capacitor/network";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  REMINDER_VERSION,
  planAssignmentReminders,
  type ReminderCandidate,
} from "@/lib/notification-plan";
import { useStore } from "@/lib/store";

const PREFERENCE_KEY = "slates.local-reminders.v1";

type RuntimePermission = PermissionState | "checking" | "unavailable";

interface MobileRuntimeValue {
  native: boolean;
  platform: string;
  remindersWanted: boolean;
  permission: RuntimePermission;
  scheduledCount: number;
  busy: boolean;
  error: string | null;
  enableReminders: () => Promise<void>;
  disableReminders: () => Promise<void>;
  checkAgain: () => Promise<void>;
  openSystemSettings: () => Promise<void>;
}

const RuntimeContext = createContext<MobileRuntimeValue | null>(null);

function storedPreference(): boolean {
  try {
    return window.localStorage.getItem(PREFERENCE_KEY) === "1";
  } catch {
    return false;
  }
}

function savePreference(value: boolean) {
  try {
    window.localStorage.setItem(PREFERENCE_KEY, value ? "1" : "0");
  } catch {
    // A blocked storage write should not prevent the current native session.
  }
}

function isManaged(extra: unknown): extra is { slatesManaged: true; slatesSignature?: string } {
  return Boolean(extra && typeof extra === "object" && (extra as { slatesManaged?: unknown }).slatesManaged === true);
}

export function useMobileRuntime(): MobileRuntimeValue {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error("useMobileRuntime must be used inside <MobileRuntimeProvider>");
  return value;
}

export default function MobileRuntimeProvider({ children }: { children: ReactNode }) {
  const s = useStore();
  const native = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();
  const [ready, setReady] = useState(false);
  const [remindersWanted, setRemindersWanted] = useState(false);
  const [permission, setPermission] = useState<RuntimePermission>(native ? "checking" : "unavailable");
  const [scheduledCount, setScheduledCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const storeRef = useRef(s);
  const { snapshot, courseById, statusOf, archived, submittedAt, demoMode } = s;

  useEffect(() => {
    storeRef.current = s;
  }, [s]);

  const candidates = useMemo<ReminderCandidate[]>(
    () =>
      snapshot.assignments.map((assignment) => ({
        assignment,
        courseName: courseById(assignment.courseId)?.short ?? "",
        status: statusOf(assignment),
        archived: assignment.id in archived,
        submitted: Boolean(assignment.submittedAt || submittedAt[assignment.id]),
      })),
    [snapshot.assignments, archived, submittedAt, courseById, statusOf]
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setRemindersWanted(storedPreference());
      setReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const reconcile = useCallback(
    async (wanted = remindersWanted) => {
      if (!native) return;
      setError(null);
      const checked = await LocalNotifications.checkPermissions();
      setPermission(checked.display);

      const pending = await LocalNotifications.getPending();
      const managed = pending.notifications.filter((item) => isManaged(item.extra));
      const plan = wanted && checked.display === "granted" && !demoMode
        ? planAssignmentReminders(candidates)
        : [];
      const desired = new Map(plan.map((item) => [item.id, item]));

      const cancel = managed.filter((item) => {
        const next = desired.get(item.id);
        return !next || item.extra?.slatesSignature !== next.signature;
      });
      if (cancel.length) {
        await LocalNotifications.cancel({ notifications: cancel.map(({ id }) => ({ id })) });
      }

      const matching = new Set(
        managed
          .filter((item) => desired.get(item.id)?.signature === item.extra?.slatesSignature)
          .map((item) => item.id)
      );
      const schedule = plan.filter((item) => !matching.has(item.id));
      if (schedule.length) {
        // schedule() can prompt in Capacitor 8.3+, so this call remains behind
        // the explicit granted check above. Merely opening Slates never asks.
        await LocalNotifications.schedule({
          notifications: schedule.map((item) => ({
            id: item.id,
            title: item.title,
            body: item.body,
            schedule: { at: item.at, isExactNotification: false },
            extra: {
              slatesManaged: true,
              slatesReminderVersion: REMINDER_VERSION,
              slatesSignature: item.signature,
              assignmentId: item.assignmentId,
              destination: "assignments",
            },
          })),
        });
      }
      setScheduledCount(plan.length);
    },
    [candidates, native, remindersWanted, demoMode]
  );

  const queueRef = useRef(Promise.resolve());
  const reconcileRef = useRef(reconcile);
  useEffect(() => {
    reconcileRef.current = reconcile;
  }, [reconcile]);
  const queueReconcile = useCallback((wanted?: boolean) => {
    queueRef.current = queueRef.current
      .then(() => reconcileRef.current(wanted))
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not update reminders.");
      });
    return queueRef.current;
  }, []);

  useEffect(() => {
    if (!ready || !native) return;
    void queueReconcile();
  }, [ready, native, candidates, demoMode, remindersWanted, queueReconcile]);

  useEffect(() => {
    const handles: PluginListenerHandle[] = [];
    if (!native) return;

    void LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
      const assignmentId = action.notification.extra?.assignmentId;
      const current = storeRef.current;
      current.setNav("Assignments", "board");
      if (
        typeof assignmentId === "string" &&
        current.snapshot.assignments.some((assignment) => assignment.id === assignmentId)
      ) {
        current.openAssignment(assignmentId);
      }
    }).then((handle) => handles.push(handle));

    void App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void queueReconcile();
    }).then((handle) => handles.push(handle));

    void Keyboard.addListener("keyboardWillShow", () => {
      document.documentElement.dataset.keyboardOpen = "1";
    }).then((handle) => handles.push(handle));
    void Keyboard.addListener("keyboardWillHide", () => {
      delete document.documentElement.dataset.keyboardOpen;
    }).then((handle) => handles.push(handle));

    return () => {
      delete document.documentElement.dataset.keyboardOpen;
      for (const handle of handles) void handle.remove();
    };
  }, [native, queueReconcile]);

  useEffect(() => {
    const handles: PluginListenerHandle[] = [];
    const update = (connected: boolean) => setOnline(connected);
    if (native) {
      void Network.getStatus().then((status) => update(status.connected));
      void Network.addListener("networkStatusChange", (status) => update(status.connected)).then((handle) =>
        handles.push(handle)
      );
    } else {
      update(window.navigator.onLine);
      const onlineHandler = () => update(true);
      const offlineHandler = () => update(false);
      window.addEventListener("online", onlineHandler);
      window.addEventListener("offline", offlineHandler);
      return () => {
        window.removeEventListener("online", onlineHandler);
        window.removeEventListener("offline", offlineHandler);
      };
    }
    return () => {
      for (const handle of handles) void handle.remove();
    };
  }, [native]);

  const enableReminders = useCallback(async () => {
    if (!native) return;
    setBusy(true);
    setError(null);
    setRemindersWanted(true);
    savePreference(true);
    try {
      const result = await LocalNotifications.requestPermissions();
      setPermission(result.display);
      await queueReconcile(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not request notification access.");
    } finally {
      setBusy(false);
    }
  }, [native, queueReconcile]);

  const disableReminders = useCallback(async () => {
    setRemindersWanted(false);
    savePreference(false);
    setBusy(true);
    try {
      await queueReconcile(false);
    } finally {
      setBusy(false);
    }
  }, [queueReconcile]);

  const checkAgain = useCallback(async () => {
    setBusy(true);
    try {
      await queueReconcile();
    } finally {
      setBusy(false);
    }
  }, [queueReconcile]);

  const openSystemSettings = useCallback(async () => {
    if (platform !== "ios") return;
    setError(null);
    try {
      await AppLauncher.openUrl({ url: "app-settings:" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open iPhone Settings.");
    }
  }, [platform]);

  const value = useMemo<MobileRuntimeValue>(
    () => ({
      native,
      platform,
      remindersWanted,
      permission,
      scheduledCount,
      busy,
      error,
      enableReminders,
      disableReminders,
      checkAgain,
      openSystemSettings,
    }),
    [
      native,
      platform,
      remindersWanted,
      permission,
      scheduledCount,
      busy,
      error,
      enableReminders,
      disableReminders,
      checkAgain,
      openSystemSettings,
    ]
  );

  return (
    <RuntimeContext.Provider value={value}>
      {online === false && (
        <div className="mobile-network-banner" role="status">
          Offline — cached work stays available; sync and server actions will wait.
        </div>
      )}
      {children}
    </RuntimeContext.Provider>
  );
}
