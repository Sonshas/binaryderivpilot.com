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
import { abortSignalAfter, raceWithTimeout } from "@/lib/abort-timeout";
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
import {
  clearStoredAuthSession,
  dataApiFetch,
  getSupabase,
  isSupabaseConfigured,
  peekStoredAuthUser,
} from "@/lib/supabase";
import { notConnected, okReal } from "@/providers/results";
import type {
  AccountStatus,
  KycStatus,
  ProviderResult,
  User,
  UserRole,
} from "@/types";
import { demoAccountShort } from "@/lib/branding";

const SESSION_READ_MS = 2_500;
const SIGN_IN_MS = 9_000;
const PHONE_LOOKUP_MS = 2_500;

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

const PROFILE_HYDRATE_MS = 2_500;

async function hydrateUser(authUser: AuthUser): Promise<User> {
  const client = getSupabase();
  if (!client) return userFromAuthOnly(authUser);

  try {
    const { data, error } = await raceWithTimeout(
      Promise.resolve(
        client
          .from("users")
          .select(
            "id, email, name, role, account_status, kyc_status, created_at, updated_at, withdraw_verification_enabled, withdraw_scanner_enabled, withdraw_tax_enabled, withdraw_gates_cleared, is_vip",
          )
          .eq("id", authUser.id)
          .abortSignal(abortSignalAfter(PROFILE_HYDRATE_MS))
          .maybeSingle(),
      ),
      PROFILE_HYDRATE_MS,
      "Profile hydrate timed out",
    );

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
    syncWithdrawGatesClearedFromServer(
      mapped.email,
      row.withdraw_gates_cleared === true,
    );
    void platformSettingsService.load(mapped.email);
    return mapped;
  } catch {
    return userFromAuthOnly(authUser);
  }
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
  try {
    const { data, error } = await raceWithTimeout(
      Promise.resolve(
        client.rpc("email_for_phone", {
          p_phone: phone,
        }),
      ),
      PHONE_LOOKUP_MS,
      "Phone lookup timed out",
    );
    if (error || typeof data !== "string" || !data.includes("@")) return null;
    return normalizeEmail(data);
  } catch {
    return null;
  }
}

/**
 * Direct password grant bypasses GoTrueClient's navigator lock. When Auth is
 * slow, signInWithPassword can wait forever behind a hung getSession/refresh.
 */
async function passwordGrantDirect(
  email: string,
  password: string,
): Promise<{ session: Session; user: AuthUser } | { error: string }> {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || "";
  const publishableKey =
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() || "";
  const anonKey =
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || "";
  const supabaseKey =
    (anonKey.startsWith("eyJ") ? anonKey : "") || publishableKey || anonKey;
  if (!supabaseUrl || !supabaseKey) {
    return { error: "Sign-in is temporarily unavailable." };
  }
  let response: Response;
  try {
    response = await raceWithTimeout(
      dataApiFetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      }),
      SIGN_IN_MS,
      "Sign-in timed out",
    );
  } catch {
    return { error: "Sign-in is taking too long. Please try again." };
  }
  let body: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    expires_at?: number;
    token_type?: string;
    user?: AuthUser;
    msg?: string;
    error_description?: string;
    error?: string;
  };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return { error: "Sign-in is temporarily unavailable." };
  }
  if (!response.ok || !body.access_token || !body.refresh_token || !body.user) {
    return {
      error:
        body.error_description ||
        body.msg ||
        body.error ||
        "Email, phone, or password is incorrect.",
    };
  }
  const expiresAt =
    typeof body.expires_at === "number"
      ? body.expires_at
      : Math.floor(Date.now() / 1000) + (Number(body.expires_in) || 3600);
  const session = {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_in: Number(body.expires_in) || 3600,
    expires_at: expiresAt,
    token_type: body.token_type ?? "bearer",
    user: body.user,
  } as Session;
  return { session, user: body.user };
}

/** Persist tokens when setSession hangs behind the Auth lock. */
function persistGrantedSession(session: Session): void {
  const supabaseUrl =
    (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || "";
  if (!supabaseUrl) return;
  try {
    const host = new URL(supabaseUrl).hostname;
    const ref = host.split(".")[0];
    if (!ref) return;
    localStorage.setItem(
      `sb-${ref}-auth-token`,
      JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        expires_in: session.expires_in,
        token_type: session.token_type,
        user: session.user,
      }),
    );
  } catch {
    /* private mode / storage blocked */
  }
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
    // Prefer a direct password grant so a hung GoTrueClient lock cannot freeze login.
    const granted = await passwordGrantDirect(email, input.password);
    if (!("error" in granted)) {
      // Write local storage first so RequireAuth/peekSession never wait on Auth locks.
      persistGrantedSession(granted.session);
      try {
        await raceWithTimeout(
          client.auth.setSession({
            access_token: granted.session.access_token,
            refresh_token: granted.session.refresh_token,
          }),
          3_000,
          "Session write timed out",
        );
      } catch {
        /* already persisted above */
      }
      const authUser = granted.user;
      const user = userFromAuthOnly(authUser);
      void hydrateUser(authUser);
      return okReal(user, `Signed in as ${user.email ?? email}.`);
    }

    const directMessage = granted.error;
    const directTimedOut = /timed out|taking too long|unavailable/i.test(directMessage);
    // Fall back to the SDK path for unit mocks / missing browser env keys.
    try {
      const { data, error } = await raceWithTimeout(
        client.auth.signInWithPassword({
          email,
          password: input.password,
        }),
        SIGN_IN_MS,
        "Sign-in timed out",
      );
      if (!error && data.session?.user) {
        const authUser = data.session.user;
        const user = userFromAuthOnly(authUser);
        void hydrateUser(authUser);
        return okReal(user, `Signed in as ${user.email ?? email}.`);
      }
      if (error && !directTimedOut) {
        return notConnected(
          null,
          "Email, phone, or password is incorrect.",
          "VALIDATION",
          "real",
        );
      }
    } catch {
      /* use direct-path message below */
    }
    return notConnected(
      null,
      directTimedOut ? directMessage : "Email, phone, or password is incorrect.",
      directTimedOut ? "NOT_CONNECTED" : "VALIDATION",
      "real",
    );
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
    const emailRedirectTo =
      typeof window !== "undefined"
        ? confirmEmailRedirectUrl(window.location.origin)
        : undefined;
    const { data, error } = await client.auth.signUp({
      email,
      password: input.password,
      options: {
        emailRedirectTo,
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

  /** Sync session from localStorage so the shell can paint before Auth API responds. */
  peekSession(): User | null {
    if (e2eAuthBypassEnabled) return getDemoSessionUser();
    const stored = peekStoredAuthUser();
    if (!stored?.id) return null;
    return userFromAuthOnly({
      id: stored.id,
      email: stored.email,
      created_at: stored.created_at,
      user_metadata: stored.user_metadata ?? {},
    } as AuthUser);
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
    let data: { session: Session | null };
    try {
      const result = await raceWithTimeout(
        client.auth.getSession(),
        SESSION_READ_MS,
        "Session read timed out",
      );
      if (result.error) {
        return notConnected(
          null,
          plainAuthMessage(result.error.message),
          "NOT_CONNECTED",
          "real",
        );
      }
      data = result.data;
    } catch {
      const peeked = this.peekSession();
      if (peeked) return okReal(peeked, `Session active for ${peeked.email}.`);
      return {
        status: "empty",
        connected: false,
        message: "No active session. Sign in to continue.",
        data: null,
        accountMode: "real",
        isSimulated: false,
      };
    }
    if (!data.session?.user) {
      return {
        status: "empty",
        connected: false,
        message: "No active session. Sign in to continue.",
        data: null,
        accountMode: "real",
        isSimulated: false,
      };
    }
    const authOnly = userFromAuthOnly(data.session.user);
    void hydrateUser(data.session.user);
    return okReal(authOnly, `Session active for ${authOnly.email}.`);
  },

  async signOut(): Promise<ProviderResult<null>> {
    if (e2eAuthBypassEnabled) {
      clearDemoSession();
      return okReal(null, "Signed out.");
    }
    if (!isSupabaseConfigured) return authNotConfigured(null);
    const client = getSupabase()!;
    // Always clear local session first so RequireStaff / logout never stick
    // on "Signing out" when GoTrue is frozen.
    clearStoredAuthSession();
    clearDemoSession();
    try {
      await raceWithTimeout(
        client.auth.signOut({ scope: "local" }),
        2_500,
        "Sign-out timed out",
      );
    } catch {
      /* local storage already cleared */
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
    // External PostgREST often hangs; fail fast and keep auth metadata.
    try {
      const { data: profile } = await raceWithTimeout(
        Promise.resolve(
          client
            .from("profiles")
            .select("display_name, phone, country")
            .eq("user_id", authUser.id)
            .abortSignal(abortSignalAfter(3_000))
            .maybeSingle(),
        ),
        3_500,
        "Profile read timed out",
      );
      if (profile) {
        extras.displayName = profile.display_name ?? extras.displayName;
        if (profile.phone) extras.phone = profile.phone;
        if (profile.country) extras.country = profile.country;
      }
    } catch {
      /* metadata extras already set */
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
      if (!session?.user) {
        callback(null);
        return;
      }
      // Emit auth-only immediately so login never waits on a hung users-table read.
      callback(userFromAuthOnly(session.user));
      void hydrateUser(session.user).then(callback);
    });
    return () => data.subscription.unsubscribe();
  },
};
