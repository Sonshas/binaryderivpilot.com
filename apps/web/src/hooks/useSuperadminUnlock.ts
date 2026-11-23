import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  canAttemptSuperadminUnlock,
  getSuperadminUnlockSnapshot,
  setSuperadminUnlock,
  subscribeSuperadminUnlock,
  verifySuperadminUnlockPassword,
} from "@/domain/superadmin-unlock";
import { useAuthSession } from "@/hooks/useAuth";

export interface SuperadminUnlockApi {
  /** True only for Sonshas after a successful password unlock this session. */
  unlocked: boolean;
  /** Whether the signed-in account may attempt unlock (Sonshas only). */
  canAttempt: boolean;
  /** Accept password; returns false on wrong password or non-Sonshas. */
  unlock: (password: string) => boolean;
  /** Clear unlock for this tab. */
  lock: () => void;
}

/**
 * Client-side superadmin unlock for Sonshas. Rulli always gets unlocked=false.
 * Stored in sessionStorage so closing the tab locks again. Shared across admin pages
 * in the same tab via a small external store.
 */
export function useSuperadminUnlock(): SuperadminUnlockApi {
  const { user } = useAuthSession();
  const canAttempt = canAttemptSuperadminUnlock(user?.email);
  const storedUnlocked = useSyncExternalStore(
    subscribeSuperadminUnlock,
    getSuperadminUnlockSnapshot,
    () => false,
  );

  useEffect(() => {
    if (!canAttempt && storedUnlocked) {
      setSuperadminUnlock(false);
    }
  }, [canAttempt, storedUnlocked]);

  const unlock = useCallback(
    (password: string) => {
      if (!canAttempt || !verifySuperadminUnlockPassword(password)) return false;
      setSuperadminUnlock(true);
      return true;
    },
    [canAttempt],
  );

  const lock = useCallback(() => {
    setSuperadminUnlock(false);
  }, []);

  return {
    unlocked: canAttempt && storedUnlocked,
    canAttempt,
    unlock,
    lock,
  };
}
