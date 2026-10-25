import type { Session, User as AuthUser } from "@supabase/supabase-js";
import {
  clearDemoSession,
  findDemoCredential,
  findDemoCredentialByPhone,
  getDemoSessionUser,
  loadDemoSession,
  saveDemoProfile,
  saveDemoSession,
  subscribeDemoSession,
  updateDemoCredentialPassword,
} from "@/lib/demo-session";
import { rekeyAccountEmail } from "@/lib/account-access";
import { moveStoredDemoState } from "@/lib/demo-store";
import {
  rekeyExternalEmail,
  syncUserWithdrawStepsFromServer,
  syncWithdrawGatesClearedFromServer,
} from "@/lib/external-payments";
import { platformSettingsService } from "@/services/platform-settings";
import { isValidEmail } from "@/lib/format";
import { normalizeEmail, normalizePhone, parseLoginId } from "@/lib/identity";
import { rekeyKycEmail } from "@/lib/kyc";
import { moveRealBook } from "@/lib/real-books";
import { rekeyScannerEmail } from "@/lib/scanner-access";
import {
  authLinkHasAction,
  clearAuthCallbackFromLocation,
  currentAuthLink,
  NO_EMAIL_LINK_MESSAGE,
  plainAuthMessage,
  type AuthLinkPurpose,
  type EmailOtpTypeName,
  type ParsedAuthLink,
} from "@/lib/auth-link";
import {
  confirmEmailRedirectUrl,
  resetPasswordRedirectUrl,
} from "@/lib/auth-redirect";
import { reportBackendIssue } from "@/services/system-issues";
import { accountEnabled } from "@/lib/account-access";
import { roleWithAdminList } from "@/lib/admin-emails";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { notConnected, okReal } from "@/providers/results";
import type {
  AccountStatus,
  KycStatus,
  ProviderResult,
  User,
  UserRole,
} from "@/types";
import { demoAccountShort } from "@/lib/branding";

export const e2eAuthBypassEnabled =
  import.meta.env.DEV && import.meta.env.VITE_E2E_AUTH_BYPASS === "true";

const LOCAL_RECOVERY_KEY = "sbb.auth.recovery";
const LOCAL_RECOVERY_MS = 15 * 60 * 1000;

function recoveryStorage(): Storage | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null;
  }
}

function readLocalRecovery(): string | null {
  const storage = recoveryStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(LOCAL_RECOVERY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { email?: string; expires?: number };
    if (!parsed.email || !parsed.expires || parsed.expires < Date.now()) {
      storage.removeItem(LOCAL_RECOVERY_KEY);
      return null;
    }
    return parsed.email;
  } catch {
    return null;
  }
}

function writeLocalRecovery(email: string): void {
  recoveryStorage()?.setItem(
    LOCAL_RECOVERY_KEY,
    JSON.stringify({ email, expires: Date.now() + LOCAL_RECOVERY_MS }),
  );
}

function clearLocalRecovery(): void {
  recoveryStorage()?.removeItem(LOCAL_RECOVERY_KEY);
}

function noEmailLink(): ProviderResult<{
  purpose: AuthLinkPurpose;
  hasSession: boolean;
} | null> {
  return {
    status: "empty",
    connected: false,
    message: NO_EMAIL_LINK_MESSAGE,
    data: null,
    code: "VALIDATION",
    accountMode: "real",
    isSimulated: false,
  };
}

export type AuthProfileExtras = {
  phone?: string;
  country?: string;
  displayName?: string;
};

type PublicUserRow = {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  account_status: string;
  kyc_status: string;
  created_at: string;
  updated_at: string;
  withdraw_verification_enabled?: boolean | null;
  withdraw_scanner_enabled?: boolean | null;
  withdraw_tax_enabled?: boolean | null;
  withdraw_gates_cleared?: boolean | null;
  is_vip?: boolean | null;
};

function authNotConfigured<T>(data: T, message?: string): ProviderResult<T> {
  return notConnected(
    data,
    message ?? "Sign-in is temporarily unavailable. Please try again later.",
    "NOT_CONNECTED",
    "real",
  );
}

function mapRole(role: string | undefined): UserRole {
  const allowed: UserRole[] = [
    "trader",
    "admin",
    "support",
    "finance",
    "compliance",
    "superadmin",
  ];
  if (role && (allowed as string[]).includes(role)) return role as UserRole;
  return "trader";
}

function mapAccountStatus(status: string | undefined): AccountStatus {
  if (status === "suspended" || status === "restricted" || status === "active")
    return status;
  return "active";
}

function mapKyc(status: string | undefined): KycStatus {
  const allowed: KycStatus[] = [
    "not_started",
    "pending",
    "under_review",
    "approved",
    "rejected",
  ];
  if (status && (allowed as string[]).includes(status))
    return status as KycStatus;
  return "not_started";
}

function userFromAuthOnly(authUser: AuthUser): User {
  const meta = authUser.user_metadata ?? {};
  const name =
    (typeof meta.name === "string" && meta.name) ||
    (typeof meta.full_name === "string" && meta.full_name) ||
    authUser.email?.split("@")[0] ||
    "Trader";
  const stamp = authUser.created_at ?? new Date().toISOString();
  return {
    id: authUser.id,
    email: authUser.email ?? "",
    name,
    role: roleWithAdminList(authUser.email, "trader"),
    accountStatus: "active",
    kycStatus: "not_started",
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function userFromPublicRow(row: PublicUserRow, fallbackEmail: string): User {
  return {
    id: row.id,
    email: row.email ?? fallbackEmail,
    name: row.name ?? fallbackEmail.split("@")[0] ?? "Trader",
    role: mapRole(row.role),
    accountStatus: mapAccountStatus(row.account_status),
    kycStatus: mapKyc(row.kyc_status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function hydrateUser(authUser: AuthUser): Promise<User> {
  const client = getSupabase();
  if (!client) return userFromAuthOnly(authUser);

  const { data, error } = await client
    .from("users")
    .select(
      "id, email, name, role, account_status, kyc_status, created_at, updated_at, withdraw_verification_enabled, withdraw_scanner_enabled, withdraw_tax_enabled, withdraw_gates_cleared, is_vip",
    )
    .eq("id", authUser.id)
    .maybeSingle();

  if (error) reportBackendIssue("auth", "users.profile", error);
  if (error || !data) {
    return userFromAuthOnly(authUser);
  }
  const row = data as PublicUserRow;
  const mapped = userFromPublicRow(row, authUser.email ?? "");
  syncUserWithdrawStepsFromServer(mapped.email, {
    verification: row.withdraw_verification_enabled,
    scanner: row.withdraw_scanner_enabled,
    tax: row.withdraw_tax_enabled,
  });
  syncWithdrawGatesClearedFromServer(mapped.email, row.withdraw_gates_cleared === true);
  void platformSettingsService.load(mapped.email);
  return mapped;
}

async function resolveSessionUser(
  session: Session | null,
): Promise<User | null> {
  if (!session?.user) return null;
  return hydrateUser(session.user);
}

function emailLinkKey(link: ParsedAuthLink): string {
  if (!authLinkHasAction(link)) return "empty";
  return [
    link.tokenHash,
    link.code,
    link.errorCode,
    link.errorDescription,
    link.otpType,
    link.hasImplicitGrant ? "implicit" : "",
  ].join("|");
}

function linkFailure(
  message: string,
): ProviderResult<{ purpose: AuthLinkPurpose; hasSession: boolean } | null> {
  return notConnected(null, plainAuthMessage(message), "VALIDATION", "real");
}

function linkSuccess(
  purpose: AuthLinkPurpose,
  hasSession: boolean,
): ProviderResult<{ purpose: AuthLinkPurpose; hasSession: boolean } | null> {
  clearAuthCallbackFromLocation();
  const message =
    purpose === "recovery"
      ? "Reset link verified. Choose a new password."
      : hasSession
        ? "Email confirmed. You are signed in."
        : "Email confirmed. You can sign in.";
  return okReal({ purpose, hasSession }, message);
}

const emailLinkResults = new Map<
  string,
  Promise<
    ProviderResult<{ purpose: AuthLinkPurpose; hasSession: boolean } | null>
  >
>();

async function exchangeEmailLink(
  link: ParsedAuthLink,
): Promise<
  ProviderResult<{ purpose: AuthLinkPurpose; hasSession: boolean } | null>
> {
  if (!authLinkHasAction(link)) {
    return {
      status: "empty",
      connected: false,
      message: NO_EMAIL_LINK_MESSAGE,
      data: null,
      code: "VALIDATION",
      accountMode: "real",
      isSimulated: false,
    };
  }
  if (link.error || link.errorCode || link.errorDescription) {
    return linkFailure(
      link.errorDescription || link.error || link.errorCode || "Auth error",
    );
  }

  const client = getSupabase()!;
  const purpose: AuthLinkPurpose =
    link.purpose === "recovery" ? "recovery" : "confirm";

  if (link.tokenHash) {
    const otpType: EmailOtpTypeName | null = link.otpType;
    if (!otpType) {
      return linkFailure(
        "This link is missing or has expired. Request a new one.",
      );
    }
    const { data, error } = await client.auth.verifyOtp({
      token_hash: link.tokenHash,
      type: otpType,
    });
    if (error) return linkFailure(error.message);
    return linkSuccess(purpose, Boolean(data.session));
  }

  if (link.code) {
    const codeStillInUrl =
      typeof window !== "undefined" &&
      new URL(window.location.href).searchParams.has("code");
    if (!codeStillInUrl) {
      const existing = await client.auth.getSession();
      if (existing.error) return linkFailure(existing.error.message);
      if (existing.data.session) {
        return linkSuccess(purpose, true);
      }
    }
    const { data, error } = await client.auth.exchangeCodeForSession(link.code);
    if (error) return linkFailure(error.message);
    return linkSuccess(purpose, Boolean(data.session));
  }

  if (link.hasImplicitGrant) {
    const { data, error } = await client.auth.getSession();
    if (error) return linkFailure(error.message);
    if (!data.session) {
      return linkFailure(
        "This link has expired or was already used. Request a new one.",
      );
    }
    return linkSuccess(purpose, true);
  }

  return linkFailure("This link is missing or has expired. Request a new one.");
}

function profileErrorMessage(raw: string): string {
  const text = raw.toLowerCase();
  if (text.includes("email_taken") || text.includes("users_email_lower_uniq")) {
    return "Another account already uses that email.";
  }
  if (text.includes("phone_taken") || text.includes("profiles_phone_uniq")) {
    return "Another account already uses that phone number.";
  }
  if (text.includes("duplicate") && text.includes("phone")) {
    return "Another account already uses that phone number.";
  }
  if (text.includes("duplicate") && text.includes("email")) {
    return "Another account already uses that email.";
  }
  if (text.includes("duplicate")) {
    return "Another account already uses that email or phone number.";
  }
  if (text.includes("name_required")) return "Enter your name.";
  if (text.includes("email_invalid")) return "Enter a valid email.";
  if (text.includes("phone_required")) return "Enter a phone number.";
  if (text.includes("country_required")) return "Select a country.";
  if (text.includes("not_signed_in")) return "Sign in to update your profile.";
  return plainAuthMessage(raw);
}

function validateProfile(input: {
  name: string;
  email: string;
  phone: string;
  country: string;
}): string | null {
  if (input.name.trim().length < 2) return "Enter your name.";
  if (!isValidEmail(input.email)) return "Enter a valid email.";
  if (normalizePhone(input.phone).length < 6) return "Enter a phone number.";
  if (!input.country.trim()) return "Select a country.";
  return null;
}

async function phoneTakenOnServer(
  phone: string,
  exceptUserId?: string,
): Promise<boolean | null> {
  const client = getSupabase();
  if (!client || typeof client.rpc !== "function") return null;
  const { data, error } = await client.rpc("profile_phone_taken", {
    p_phone: normalizePhone(phone),
    p_except: exceptUserId ?? null,
  });
  if (error) return null;
  return data === true;
}

async function emailForPhone(phone: string): Promise<string | null> {
  const client = getSupabase();
  if (!client || typeof client.rpc !== "function") return null;
  const { data, error } = await client.rpc("email_for_phone", {
    p_phone: phone,
  });
  if (error || typeof data !== "string" || !data.includes("@")) return null;
  return normalizeEmail(data);
}

export const authService = {
  async signIn(input: {
    email: string;
    password: string;
  }): Promise<ProviderResult<User | null>> {
    const loginId = parseLoginId(input.email);
    if (!loginId || input.password.length < 8) {
      return notConnected(
        null,
        "Enter your email or phone number and a password of at least 8 characters.",
        "VALIDATION",
        "real",
      );
    }
    if (e2eAuthBypassEnabled) {
      const stored =
        "email" in loginId
          ? findDemoCredential(loginId.email)
          : findDemoCredentialByPhone(loginId.phone);
      if (!stored || !stored.password || stored.password !== input.password) {
        return notConnected(
          null,
          "Email, phone, or password is incorrect.",
          "VALIDATION",
          "real",
        );
      }
      if (!accountEnabled(stored.email)) {
        return notConnected(
          null,
          "This account is disabled.",
          "VALIDATION",
          "real",
        );
      }
      clearLocalRecovery();
      saveDemoSession({
        email: stored.email,
        name: stored.name,
        password: stored.password,
        phone: stored.phone,
        country: stored.country,
      });
      return okReal(getDemoSessionUser(), `Signed in as ${stored.email}.`);
    }
    if (!isSupabaseConfigured) return authNotConfigured(null);
    const client = getSupabase()!;
    const email =
      "email" in loginId ? loginId.email : await emailForPhone(loginId.phone);
    if (!email) {
      return notConnected(
        null,
        "Email, phone, or password is incorrect.",
        "VALIDATION",
        "real",
      );
    }
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password: input.password,
    });
    if (error) {
      return notConnected(
        null,
        "Email, phone, or password is incorrect.",
        "VALIDATION",
        "real",
      );
    }
    const user = await resolveSessionUser(data.session);
    if (user?.accountStatus === "suspended") {
      await client.auth.signOut();
      return notConnected(
        null,
        "This account is disabled. Contact support for assistance.",
        "VALIDATION",
        "real",
      );
    }
    return okReal(user, `Signed in as ${user?.email ?? email}.`);
  },

  async signUp(input: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    country?: string;
  }): Promise<ProviderResult<User | null>> {
    if (e2eAuthBypassEnabled) {
      if (
        input.name.trim().length < 2 ||
        !input.email.trim() ||
        input.password.length < 8
      ) {
        return notConnected(
          null,
          "Name, email, and an 8+ character password are required.",
          "VALIDATION",
          "real",
        );
      }
      if (normalizePhone(input.phone ?? "").length < 6) {
        return notConnected(
          null,
          "Enter a phone number.",
          "VALIDATION",
          "real",
        );
      }
      const existing = findDemoCredential(input.email);
      if (existing) {
        return notConnected(
          null,
          "An account with this email already exists. Log in instead.",
          "VALIDATION",
          "real",
        );
      }
      const phoneOwner = findDemoCredentialByPhone(input.phone ?? "");
      if (phoneOwner) {
        return notConnected(
          null,
          "An account with this phone number already exists.",
          "VALIDATION",
          "real",
        );
      }
      saveDemoSession({
        email: input.email,
        name: input.name,
        password: input.password,
        phone: input.phone,
        country: input.country,
      });
      return okReal(
        getDemoSessionUser(),
        `Account created for ${input.email.trim().toLowerCase()}.`,
      );
    }
    if (!isSupabaseConfigured) return authNotConfigured(null);
    if (
      input.name.trim().length < 2 ||
      !input.email.trim() ||
      input.password.length < 8
    ) {
      return notConnected(
        null,
        "Name, email, and an 8+ character password are required.",
        "VALIDATION",
        "real",
      );
    }
    const client = getSupabase()!;
    const phoneTaken = await phoneTakenOnServer(input.phone ?? "");
    if (phoneTaken) {
      return notConnected(
        null,
        "An account with this phone number already exists.",
        "VALIDATION",
        "real",
      );
    }
    const email = input.email.trim();
    const { data, error } = await client.auth.signUp({
      email,
      password: input.password,
      options: {
        data: {
          name: input.name.trim(),
          phone: normalizePhone(input.phone ?? "") || undefined,
          country: input.country?.trim() || undefined,
        },
      },
    });
    if (error) {
      return notConnected(
        null,
        profileErrorMessage(error.message),
        "VALIDATION",
        "real",
      );
    }
    let session = data.session;
    if (!session) {
      // Email confirmation disabled — sign in immediately after create.
      const signedIn = await client.auth.signInWithPassword({
        email,
        password: input.password,
      });
      if (signedIn.error || !signedIn.data.session) {
        return notConnected(
          null,
          "Account created. Log in with your email and password.",
          "VALIDATION",
          "real",
        );
      }
      session = signedIn.data.session;
    }
    const user = await resolveSessionUser(session);
    return okReal(
      user,
      `Account created for ${user?.email ?? email}. You are signed in.`,
    );
  },

  async requestPasswordReset(email: string): Promise<ProviderResult<null>> {
    if (e2eAuthBypassEnabled) {
      if (!email.trim()) {
        return notConnected(null, "Enter a valid email.", "VALIDATION", "real");
      }
      const stored = findDemoCredential(email);
      if (!stored) {
        return notConnected(
          null,
          "No account uses that email.",
          "VALIDATION",
          "real",
        );
      }
      writeLocalRecovery(stored.email);
      return okReal(null, "Choose a new password for this account.");
    }
    if (!isSupabaseConfigured) return authNotConfigured(null);
    if (!email.trim()) {
      return notConnected(null, "Enter a valid email.", "VALIDATION", "real");
    }
    const client = getSupabase()!;
    const redirectTo =
      typeof window !== "undefined"
        ? resetPasswordRedirectUrl(window.location.origin)
        : undefined;
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    });
    if (error) {
      return notConnected(
        null,
        plainAuthMessage(error.message),
        "VALIDATION",
        "real",
      );
    }
    return okReal(
      null,
      "If an account exists for that email, a password reset link has been sent.",
    );
  },

  async consumeEmailLink(): Promise<
    ProviderResult<{ purpose: AuthLinkPurpose; hasSession: boolean } | null>
  > {
    if (e2eAuthBypassEnabled) {
      const email = readLocalRecovery();
      if (!email) return noEmailLink();
      return okReal(
        { purpose: "recovery", hasSession: Boolean(loadDemoSession()) },
        "Choose a new password.",
      );
    }
    if (!isSupabaseConfigured) return authNotConfigured(null);
    const href = typeof window !== "undefined" ? window.location.href : null;
    const link = currentAuthLink(href);
    const key = emailLinkKey(link);
    const cached = emailLinkResults.get(key);
    if (cached) return cached;
    const pending = exchangeEmailLink(link);
    if (key !== "empty") emailLinkResults.set(key, pending);
    return pending;
  },

  async updatePassword(
    password: string,
    source: "session" | "recovery" = "session",
  ): Promise<ProviderResult<null>> {
    if (e2eAuthBypassEnabled) {
      if (password.length < 8) {
        return notConnected(
          null,
          "Password must be at least 8 characters.",
          "VALIDATION",
          "real",
        );
      }
      const email =
        source === "recovery"
          ? (readLocalRecovery() ?? loadDemoSession()?.email ?? "")
          : (loadDemoSession()?.email ?? "");
      if (!email || !updateDemoCredentialPassword(email, password)) {
        return notConnected(
          null,
          "Request a password reset, or sign in to change your password.",
          "VALIDATION",
          "real",
        );
      }
      clearLocalRecovery();
      return okReal(
        null,
        "Password updated. You can sign in with the new password.",
      );
    }
    if (!isSupabaseConfigured) return authNotConfigured(null);
    if (password.length < 8) {
      return notConnected(
        null,
        "Password must be at least 8 characters.",
        "VALIDATION",
        "real",
      );
    }
    const client = getSupabase()!;
    const { error } = await client.auth.updateUser({ password });
    if (error) {
      return notConnected(
        null,
        plainAuthMessage(error.message),
        "VALIDATION",
        "real",
      );
    }
    return okReal(
      null,
      "Password updated. You can sign in with the new password.",
    );
  },

  async resendVerification(email: string): Promise<ProviderResult<null>> {
    if (e2eAuthBypassEnabled) {
      if (!email.trim()) {
        return notConnected(null, "Enter a valid email.", "VALIDATION", "real");
      }
      const stored = findDemoCredential(email);
      if (!stored) {
        return notConnected(
          null,
          "No account uses that email.",
          "VALIDATION",
          "real",
        );
      }
      return okReal(
        null,
        "This account is already active. Log in to continue.",
      );
    }
    if (!isSupabaseConfigured) return authNotConfigured(null);
    if (!email.trim()) {
      return notConnected(null, "Enter a valid email.", "VALIDATION", "real");
    }
    const client = getSupabase()!;
    const emailRedirectTo =
      typeof window !== "undefined"
        ? confirmEmailRedirectUrl(window.location.origin)
        : undefined;
    const { error } = await client.auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo },
    });
    if (error) {
      return notConnected(
        null,
        plainAuthMessage(error.message),
        "VALIDATION",
        "real",
      );
    }
    return okReal(
      null,
      "Verification email resent if the address is pending confirmation.",
    );
  },

  async getSession(): Promise<ProviderResult<User | null>> {
    if (e2eAuthBypassEnabled) {
      const user = getDemoSessionUser();
      if (!user) {
        return {
          status: "empty",
          connected: false,
          message: "No E2E session.",
          data: null,
          accountMode: "real",
          isSimulated: false,
        };
      }
      return okReal(user, `Signed in as ${user.email}.`);
    }
    if (!isSupabaseConfigured) return authNotConfigured(null);
    const client = getSupabase()!;
    const { data, error } = await client.auth.getSession();
    if (error) {
      return notConnected(
        null,
        plainAuthMessage(error.message),
        "NOT_CONNECTED",
        "real",
      );
    }
    const user = await resolveSessionUser(data.session);
    if (!user) {
      return {
        status: "empty",
        connected: false,
        message: "No active session. Sign in to continue.",
        data: null,
        accountMode: "real",
        isSimulated: false,
      };
    }
    return okReal(user, `Session active for ${user.email}.`);
  },

  async signOut(): Promise<ProviderResult<null>> {
    if (e2eAuthBypassEnabled) {
      clearDemoSession();
      return okReal(null, "Signed out.");
    }
    if (!isSupabaseConfigured) return authNotConfigured(null);
    const client = getSupabase()!;
    const { error } = await client.auth.signOut();
    if (error) {
      return notConnected(
        null,
        plainAuthMessage(error.message),
        "NOT_CONNECTED",
        "real",
      );
    }
    return okReal(
      null,
      `Signed out. ${demoAccountShort().toUpperCase()} local real data is unchanged.`,
    );
  },

  async updateProfile(input: {
    name: string;
    email: string;
    phone: string;
    country: string;
  }): Promise<ProviderResult<User | null>> {
    const invalid = validateProfile(input);
    if (invalid) return notConnected(null, invalid, "VALIDATION", "real");
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);
    if (e2eAuthBypassEnabled) {
      const current = loadDemoSession();
      if (!current)
        return notConnected(
          null,
          "Sign in to update your profile.",
          "VALIDATION",
          "real",
        );
      const emailOwner = findDemoCredential(email);
      if (emailOwner && emailOwner.email !== current.email) {
        return notConnected(
          null,
          "Another account already uses that email.",
          "VALIDATION",
          "real",
        );
      }
      if (findDemoCredentialByPhone(phone, current.email)) {
        return notConnected(
          null,
          "Another account already uses that phone number.",
          "VALIDATION",
          "real",
        );
      }
      if (email !== current.email) {
        moveStoredDemoState(current.email, email);
        moveRealBook(current.email, email, input.name.trim());
        rekeyKycEmail(current.email, email);
        rekeyAccountEmail(current.email, email);
        rekeyScannerEmail(current.email, email);
        rekeyExternalEmail(current.email, email);
      }
      const saved = saveDemoProfile({
        previousEmail: current.email,
        email,
        name: input.name,
        phone,
        country: input.country,
      });
      if (!saved)
        return notConnected(
          null,
          "Sign in to update your profile.",
          "VALIDATION",
          "real",
        );
      return okReal(getDemoSessionUser(), "Profile saved.");
    }
    if (!isSupabaseConfigured) return authNotConfigured(null);
    const client = getSupabase()!;
    const { data: sessionData } = await client.auth.getSession();
    const authUser = sessionData.session?.user;
    if (!authUser)
      return notConnected(
        null,
        "Sign in to update your profile.",
        "VALIDATION",
        "real",
      );
    const { error } = await client.rpc("update_own_profile", {
      p_name: input.name.trim(),
      p_email: email,
      p_phone: phone,
      p_country: input.country.trim(),
    });
    if (error)
      return notConnected(
        null,
        profileErrorMessage(error.message),
        "VALIDATION",
        "real",
      );
    await client.auth.refreshSession();
    const next = await client.auth.getSession();
    const user = await resolveSessionUser(next.data.session);
    return okReal(user, "Profile saved.");
  },

  async getProfileExtras(): Promise<AuthProfileExtras> {
    if (e2eAuthBypassEnabled) {
      const session = loadDemoSession();
      return {
        phone: session?.phone,
        country: session?.country,
        displayName: session?.name,
      };
    }
    const client = getSupabase();
    if (!client) return {};
    const { data: sessionData } = await client.auth.getSession();
    const authUser = sessionData.session?.user;
    if (!authUser) return {};
    const meta = authUser.user_metadata ?? {};
    const extras: AuthProfileExtras = {
      phone: typeof meta.phone === "string" ? meta.phone : undefined,
      country: typeof meta.country === "string" ? meta.country : undefined,
      displayName: typeof meta.name === "string" ? meta.name : undefined,
    };
    const { data: profile } = await client
      .from("profiles")
      .select("display_name, phone, country")
      .eq("user_id", authUser.id)
      .maybeSingle();
    if (profile) {
      extras.displayName = profile.display_name ?? extras.displayName;
      if (profile.phone) extras.phone = profile.phone;
      if (profile.country) extras.country = profile.country;
    }
    return extras;
  },

  onAuthStateChange(callback: (user: User | null) => void): () => void {
    if (e2eAuthBypassEnabled) {
      const emit = () => callback(getDemoSessionUser());
      emit();
      return subscribeDemoSession(emit);
    }
    const client = getSupabase();
    if (!client) {
      callback(null);
      return () => undefined;
    }
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      void resolveSessionUser(session).then(callback);
    });
    return () => data.subscription.unsubscribe();
  },
};
