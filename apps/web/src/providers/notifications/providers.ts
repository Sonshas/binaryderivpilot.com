import { DEMO_ACCOUNT_ID, DEMO_USER_ID } from "@/domain/account";
import { createId, nowIso } from "@/lib/ids";
import { loadDemoState, mutateDemoState } from "@/lib/demo-store";
import { reportBackendIssue } from "@/services/system-issues";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { REAL_INTEGRATION } from "@/providers/config";
import { okDemo, okReal, notConnected } from "@/providers/results";
import {
  demoAccountShort,
  demoAccountUpper,
  realAccountShort,
} from "@/lib/branding";
import type {
  AccountMode,
  Notification,
  NotificationKind,
  ProviderResult,
  SupportTicket,
  SupportTicketStatus,
} from "@/types";

export interface NotificationProvider {
  readonly id: string;
  list(kind?: AccountMode): Promise<ProviderResult<Notification[]>>;
}

export interface SupportProvider {
  readonly id: string;
  listTickets(kind?: AccountMode): Promise<ProviderResult<SupportTicket[]>>;
  createTicket(input: {
    subject: string;
    message: string;
    kind?: AccountMode;
  }): Promise<ProviderResult<SupportTicket | null>>;
  markRepliesRead(kind?: AccountMode): Promise<ProviderResult<boolean>>;
}

function mapNotificationKind(value: string): NotificationKind {
  const allowed: NotificationKind[] = [
    "system",
    "trading",
    "wallet",
    "security",
  ];
  if ((allowed as string[]).includes(value)) return value as NotificationKind;
  return "system";
}

export const demoNotificationProvider: NotificationProvider = {
  id: "demo-local",
  async list(kind = "demo") {
    if (kind !== "demo") {
      return notConnected(
        [],
        `${demoAccountShort()} notifications are isolated from real.`,
        "CROSS_MODE_FORBIDDEN",
      );
    }
    return okDemo(
      loadDemoState().notifications,
      `${demoAccountUpper()} notifications.`,
    );
  },
};

export const realNotificationProvider: NotificationProvider = {
  id: "real-backend",
  async list() {
    if (!REAL_INTEGRATION.backendConfigured || !isSupabaseConfigured) {
      return notConnected(
        [],
        "Notifications are temporarily unavailable. Please try again shortly.",
      );
    }
    const client = getSupabase()!;
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.user) {
      return notConnected(
        [],
        `Sign in to load ${realAccountShort()} notifications.`,
      );
    }

    const { data, error } = await client
      .from("notifications")
      .select(
        "id, user_id, account_id, account_mode, kind, title, body, read, is_simulated, created_at, updated_at",
      )
      .eq("user_id", session.user.id)
      .eq("is_simulated", false)
      .order("created_at", { ascending: false });

    if (error) {
      reportBackendIssue("notifications", "notifications.read", error);
      return notConnected(
        [],
        `${realAccountShort()} notifications read failed. Please try again later.`,
      );
    }

    const rows: Notification[] = (data ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id ?? "",
      accountMode: (row.account_mode === "demo"
        ? "demo"
        : "real") as AccountMode,
      kind: mapNotificationKind(row.kind),
      title: row.title,
      body: row.body,
      read: Boolean(row.read),
      isSimulated: false,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return okReal(
      rows,
      rows.length
        ? `${realAccountShort()} notifications loaded.`
        : `No ${realAccountShort()} notifications yet.`,
    );
  },
};

export const demoSupportProvider: SupportProvider = {
  id: "demo-local",
  async listTickets(kind = "demo") {
    if (kind !== "demo") {
      return notConnected(
        [],
        `${demoAccountShort()} support is isolated from real.`,
        "CROSS_MODE_FORBIDDEN",
      );
    }
    return okDemo(
      loadDemoState().tickets,
      `${demoAccountUpper()} support tickets.`,
    );
  },
  async createTicket(input) {
    if (input.kind && input.kind !== "demo") {
      return notConnected(
        null,
        `${demoAccountShort()} support is isolated from real.`,
        "CROSS_MODE_FORBIDDEN",
      );
    }
    const now = Date.now();
    const createdAt = nowIso(now);
    const ticket: SupportTicket = {
      id: createId("tkt"),
      userId: DEMO_USER_ID,
      accountId: DEMO_ACCOUNT_ID,
      accountMode: "demo",
      subject: input.subject,
      message: input.message,
      status: "open",
      createdAt,
      updatedAt: createdAt,
    };
    mutateDemoState((state) => ({
      ...state,
      tickets: [ticket, ...state.tickets],
    }));
    return okDemo(ticket, "Support ticket saved.");
  },
  async markRepliesRead(kind = "demo") {
    if (kind !== "demo") {
      return notConnected(
        false,
        `${demoAccountShort()} support is isolated from real.`,
        "CROSS_MODE_FORBIDDEN",
      );
    }
    mutateDemoState((state) => ({
      ...state,
      tickets: state.tickets.map((ticket) =>
        ticket.reply && ticket.replyRead !== true
          ? { ...ticket, replyRead: true }
          : ticket,
      ),
      notifications: state.notifications.map((item) =>
        item.title === "New support reply" && !item.read
          ? { ...item, read: true, updatedAt: nowIso() }
          : item,
      ),
    }));
    return okDemo(true, "Support replies marked read.");
  },
};

type SupportTicketRpcRow = {
  id: string;
  user_id: string;
  account_id: string | null;
  account_mode: string | null;
  subject: string;
  message: string;
  status: string;
  created_at: string;
  updated_at: string;
};

function mapSupportTicketRow(
  row: SupportTicketRpcRow,
  reply?: { message: string; createdAt: string; read: boolean } | null,
): SupportTicket {
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id ?? "",
    accountMode: (row.account_mode === "demo" ? "demo" : "real") as AccountMode,
    subject: row.subject,
    message: row.message,
    status: (row.status === "closed"
      ? "closed"
      : "open") as SupportTicketStatus,
    reply: reply?.message ?? null,
    replyAt: reply?.createdAt ?? null,
    replyRead: reply ? reply.read : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const realSupportProvider: SupportProvider = {
  id: "real-backend",
  async listTickets() {
    if (!REAL_INTEGRATION.backendConfigured || !isSupabaseConfigured) {
      return notConnected(
        [],
        "Support is temporarily unavailable. Please try again shortly.",
      );
    }
    const client = getSupabase()!;
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.user) {
      return notConnected(
        [],
        `Sign in to load ${realAccountShort()} support tickets.`,
      );
    }

    const { data, error } = await client
      .from("support_tickets")
      .select(
        "id, user_id, account_id, account_mode, subject, message, status, created_at, updated_at",
      )
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      reportBackendIssue("support", "support_tickets.read", error);
      return notConnected(
        [],
        "Support tickets could not be loaded. Please try again later.",
      );
    }

    const tickets = data ?? [];
    const ticketIds = tickets.map((row) => row.id);
    const replyByTicket = new Map<
      string,
      { message: string; createdAt: string; read: boolean }
    >();

    if (ticketIds.length) {
      const { data: messages, error: messagesError } = await client
        .from("support_messages")
        .select("ticket_id, message, sender_role, read_at, created_at")
        .in("ticket_id", ticketIds)
        .eq("sender_role", "admin")
        .order("created_at", { ascending: false });

      if (messagesError) {
        reportBackendIssue("support", "support_messages.read", messagesError);
      } else {
        for (const msg of messages ?? []) {
          const tid = String(msg.ticket_id);
          if (replyByTicket.has(tid)) continue;
          replyByTicket.set(tid, {
            message: msg.message,
            createdAt: msg.created_at,
            read: Boolean(msg.read_at),
          });
        }
      }
    }

    const rows: SupportTicket[] = tickets.map((row) =>
      mapSupportTicketRow(row, replyByTicket.get(row.id) ?? null),
    );

    return okReal(
      rows,
      rows.length
        ? `${realAccountShort()} support tickets loaded.`
        : `No ${realAccountShort()} support tickets yet.`,
    );
  },

  async createTicket(input) {
    if (!REAL_INTEGRATION.backendConfigured || !isSupabaseConfigured) {
      return notConnected(
        null,
        "Support is temporarily unavailable. Please try again shortly.",
      );
    }
    const subject = input.subject.trim();
    const message = input.message.trim();
    if (subject.length < 3 || message.length < 3) {
      return notConnected(
        null,
        "Subject and message are required.",
        "VALIDATION",
      );
    }

    const client = getSupabase()!;
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.user) {
      return notConnected(
        null,
        `Sign in to create a ${realAccountShort()} support ticket.`,
      );
    }

    const { data, error } = await client.rpc("create_support_ticket", {
      p_subject: subject,
      p_message: message,
    });

    if (error || !data) {
      if (error) reportBackendIssue("support", "support_tickets.create", error);
      return notConnected(
        null,
        "Your ticket could not be sent. Please try again later.",
        "NOT_CONNECTED",
      );
    }

    const row = data as SupportTicketRpcRow;
    return okReal(mapSupportTicketRow(row), "Support ticket created.");
  },

  async markRepliesRead() {
    if (!REAL_INTEGRATION.backendConfigured || !isSupabaseConfigured) {
      return notConnected(
        false,
        "Support is temporarily unavailable. Please try again shortly.",
      );
    }
    const client = getSupabase()!;
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.user) {
      return notConnected(
        false,
        `Sign in to update ${realAccountShort()} support replies.`,
      );
    }

    const { error } = await client.rpc("mark_support_replies_read");
    if (error) {
      reportBackendIssue("support", "support_messages.mark_read", error);
      return notConnected(
        false,
        "Could not mark support replies as read. Please try again later.",
      );
    }
    return okReal(true, "Support replies marked read.");
  },
};
