import { isSonshasEmail } from "@/domain/admin-earnings";

/** sessionStorage key — unlock clears when the tab/session ends. */
export const SUPERADMIN_UNLOCK_STORAGE_KEY = "sbb_superadmin_unlock";

/** Client gate only; never show this string in UI copy. */
const SUPERADMIN_UNLOCK_PASSWORD = "Evansmachika1613";

/** Only Sonshas may attempt the superadmin password unlock. */
export function canAttemptSuperadminUnlock(email: string | null | undefined): boolean {
  return isSonshasEmail(email);
}

/** Compare the typed password to the gate constant. */
export function verifySuperadminUnlockPassword(password: string): boolean {
  return String(password ?? "") === SUPERADMIN_UNLOCK_PASSWORD;
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null;
  }
}

/** Read whether this browser tab already unlocked superadmin. */
export function readSuperadminUnlock(): boolean {
  const store = storage();
  if (!store) return false;
  return store.getItem(SUPERADMIN_UNLOCK_STORAGE_KEY) === "1";
}

/** Persist or clear the unlock flag for this tab. */
export function writeSuperadminUnlock(unlocked: boolean): void {
  const store = storage();
  if (!store) return;
  if (unlocked) store.setItem(SUPERADMIN_UNLOCK_STORAGE_KEY, "1");
  else store.removeItem(SUPERADMIN_UNLOCK_STORAGE_KEY);
}

type Listener = () => void;

let memoryUnlocked = readSuperadminUnlock();
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to unlock changes (for useSyncExternalStore). */
export function subscribeSuperadminUnlock(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Current unlock flag for this tab (memory + sessionStorage). */
export function getSuperadminUnlockSnapshot(): boolean {
  return memoryUnlocked;
}

/** Set unlock and notify all hook subscribers. */
export function setSuperadminUnlock(unlocked: boolean): void {
  memoryUnlocked = unlocked;
  writeSuperadminUnlock(unlocked);
  emit();
}

/** Re-read sessionStorage (e.g. after another tab change is not needed; same-tab sync). */
export function syncSuperadminUnlockFromStorage(): void {
  const next = readSuperadminUnlock();
  if (next === memoryUnlocked) return;
  memoryUnlocked = next;
  emit();
}
