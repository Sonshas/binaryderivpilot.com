import {
  DEFAULT_REAL_STAKE_BOUNDS,
  evaluateAutoStop,
  nextAutoStake,
  resolveAutoStake,
  validateAutoSettings,
  type AutoAccount,
  type AutoTradeSettings,
  type RealStakeBounds,
} from "@/domain/auto-trade";
import { botProgress, type BotProgress } from "@/domain/bot-strategies";
import type { DigitContractKind } from "@/domain/digit-contracts";
import {
  orderFromPrediction,
  validatePrediction,
  type LoadedPrediction,
} from "@/domain/prediction";
import { settledResult, type SettledResult } from "@/domain/trade-result";
import { getActiveAccountMode } from "@/lib/active-account-mode";
import { reportBackendIssue } from "@/services/system-issues";
import { createId, nowIso } from "@/lib/ids";
import { predictionStore } from "@/lib/prediction-store";
import {
  getLastReceivedAt,
  getLatestBufferedTick,
  getLiveTickSource,
} from "@/providers/market-data/tick-buffer";
import { newIdempotencyKey } from "@/providers/trading/real-trading-provider";
import {
  ACCOUNT_EXECUTORS,
  executeTrade,
  executorFor,
  type Executors,
} from "@/providers/bots/auto-trade-executors";
import type { Trade } from "@/types";
import { realAccountShort, demoAccountShort } from "@/lib/branding";

export const PREDICTION_CHANGED_STOP = "Stopped: the loaded prediction changed";

function autoAccountLabel(account: AutoAccount): string {
  return account === "REAL" ? realAccountShort() : demoAccountShort();
}

export type AutoPhase =
  | "checking"
  | "picking"
  | "submitting"
  | "waiting"
  | "stopped";

export interface AutoCurrentTrade {
  symbol: string;
  contract: DigitContractKind;
  target: number | null;
  prediction: string;
  stake: number;
  value: number | null;
  tradeId: string | null;
}

export interface AutoTradeSession {
  id: string;
  account: AutoAccount;
  status: "running" | "stopped";
  phase: AutoPhase;
  settings: AutoTradeSettings;
  realStakeBounds: RealStakeBounds;
  prediction: LoadedPrediction;
  startedAt: string;
  stoppedAt: string | null;
  stopReason: string | null;
  current: AutoCurrentTrade | null;
  trades: Trade[];
  lastResult: {
    prediction: string;
    digit: number | null;
    result: SettledResult;
  } | null;
  balance: number | null;
  statusText: string;
}

export interface AutoTradeSnapshot {
  session: AutoTradeSession | null;
  progress: BotProgress;
  nextStake: number | null;
}

export interface AutoTradeEngineDeps {
  executors: Executors;
  currentPrediction: () => LoadedPrediction | null;
  currentMode: () => AutoAccount;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  quote: (symbol: string) => number | null;
  ensureFeed: (symbol: string) => void;
  lastTickAt: (symbol: string) => number;
  newKey: () => string;
  pollMs: number;
  retryMs: number;
  maxRetries: number;
  settleTimeoutMs: number;
}

export const FEED_STALE_MS = 30_000;
const EMPTY_PROGRESS: BotProgress = {
  tradesPlaced: 0,
  openTrades: 0,
  wins: 0,
  losses: 0,
  realizedPnl: 0,
  lossStreak: 0,
};

function lastSettled(trades: Trade[]): Trade | null {
  let latest: Trade | null = null;
  for (const trade of trades) {
    if (trade.status === "open") continue;
    const at = new Date(trade.resolvedAt ?? trade.updatedAt).getTime();
    if (
      !latest ||
      at >= new Date(latest.resolvedAt ?? latest.updatedAt).getTime()
    )
      latest = trade;
  }
  return latest;
}

function martingaleStake(session: AutoTradeSession): number {
  const last = lastSettled(session.trades);
  return nextAutoStake(
    last?.stake ?? session.settings.baseStake,
    last ? (last.status as Exclude<Trade["status"], "open">) : null,
    session.settings,
  );
}

export function createAutoTradeEngine(
  overrides: Partial<AutoTradeEngineDeps> = {},
) {
  const deps: AutoTradeEngineDeps = {
    executors: ACCOUNT_EXECUTORS,
    currentPrediction: () => predictionStore.getLoaded(),
    currentMode: () => (getActiveAccountMode() === "real" ? "REAL" : "DEMO"),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    quote: (symbol) => getLatestBufferedTick(symbol)?.price ?? null,
    ensureFeed: (symbol) => getLiveTickSource()?.ensureSubscribed(symbol),
    lastTickAt: getLastReceivedAt,
    newKey: newIdempotencyKey,
    pollMs: 1_000,
    retryMs: 1_000,
    maxRetries: 20,
    settleTimeoutMs: 11 * 60_000,
    ...overrides,
  };
  let session: AutoTradeSession | null = null;
  const listeners = new Set<() => void>();

  function emit(): void {
    listeners.forEach((listener) => listener());
  }

  function update(id: string, patch: Partial<AutoTradeSession>): boolean {
    if (!session || session.id !== id) return false;
    session = { ...session, ...patch };
    emit();
    return true;
  }

  function isRunning(id: string): boolean {
    return session?.id === id && session.status === "running";
  }

  function upsertTrade(id: string, trade: Trade): void {
    if (!session || session.id !== id) return;
    const exists = session.trades.some((item) => item.id === trade.id);
    const trades = exists
      ? session.trades.map((item) => (item.id === trade.id ? trade : item))
      : [...session.trades, trade];
    update(id, { trades });
  }

  function stop(reason = "Stopped by you"): void {
    if (!session || session.status !== "running") return;
    session = {
      ...session,
      status: "stopped",
      phase: "stopped",
      stoppedAt: nowIso(deps.now()),
      stopReason: reason,
      statusText: reason,
    };
    emit();
  }

  async function awaitSettlement(
    id: string,
    account: AutoAccount,
    trade: Trade,
  ): Promise<Trade | null> {
    const executor = executorFor(account, deps.executors);
    const deadline = deps.now() + deps.settleTimeoutMs;
    for (;;) {
      if (session?.id !== id) return null;
      const latest = await executor.getTrade(trade.id);
      if (latest && latest.status !== "open") {
        upsertTrade(id, latest);
        return latest;
      }
      if (deps.now() > deadline) return null;
      await deps.sleep(deps.pollMs);
    }
  }

  function runGuard(id: string): string | null {
    if (!session || session.id !== id) return "Stopped";
    if (deps.currentPrediction()?.id !== session.prediction.id)
      return PREDICTION_CHANGED_STOP;
    if (deps.currentMode() !== session.account)
      return `Switched to ${autoAccountLabel(deps.currentMode())}`;
    return null;
  }

  async function loop(id: string): Promise<void> {
    while (isRunning(id)) {
      const current = session!;
      const { settings, account } = current;
      const guard = runGuard(id);
      if (guard) {
        stop(guard);
        return;
      }

      update(id, {
        phase: "checking",
        statusText: `Loading ${autoAccountLabel(account)} balance…`,
      });
      const executor = executorFor(account, deps.executors);
      const balance = await executor.getBalance();
      if (!isRunning(id)) return;
      if (balance == null) {
        stop(
          account === "REAL"
            ? `${realAccountShort()} balance unavailable — the live trading connection is not active`
            : `${demoAccountShort()} balance unavailable`,
        );
        return;
      }
      const progress = botProgress(session!.trades);
      const stake = resolveAutoStake(
        martingaleStake(session!),
        balance,
        settings,
      );
      const reason = evaluateAutoStop(
        progress,
        stake,
        balance,
        settings,
        session!.realStakeBounds,
      );
      update(id, { balance });
      if (reason) {
        stop(reason);
        return;
      }

      const pick = orderFromPrediction(current.prediction);
      deps.ensureFeed(pick.symbol);
      update(id, {
        phase: "picking",
        current: {
          ...pick,
          stake,
          value: deps.quote(pick.symbol),
          tradeId: null,
        },
        statusText: `Next: ${pick.prediction} on ${pick.symbol} for $${stake.toFixed(2)}`,
      });

      const order = {
        account,
        symbol: pick.symbol,
        selection: pick.selection,
        stake,
        durationTicks: settings.durationTicks,
        runId: id,
        idempotencyKey: deps.newKey(),
      };
      let placed: Trade | null = null;
      for (let attempt = 0; isRunning(id); attempt += 1) {
        update(id, {
          phase: "submitting",
          statusText: `Placing ${pick.prediction} on ${pick.symbol}…`,
        });
        const orderGuard = runGuard(id);
        if (orderGuard) {
          stop(orderGuard);
          return;
        }
        const feedStalled =
          deps.now() - deps.lastTickAt(pick.symbol) > FEED_STALE_MS;
        const result = feedStalled
          ? ({
              ok: false,
              code: "RETRY",
              message: "Live price feed stalled",
            } as const)
          : await executeTrade(session!.account, deps.executors, order);
        if (result.ok) {
          placed = result.trade;
          break;
        }
        if (result.code === "RETRY" && attempt < deps.maxRetries) {
          update(id, {
            current: { ...session!.current!, value: deps.quote(pick.symbol) },
            statusText: `Waiting for a live price on ${pick.symbol}…`,
          });
          await deps.sleep(deps.retryMs);
          continue;
        }
        if (!isRunning(id)) return;
        if (result.code === "RETRY")
          stop(`Live price feed stopped on ${pick.symbol}`);
        else if (result.code === "INSUFFICIENT_FUNDS")
          stop(`Insufficient ${autoAccountLabel(account)} balance`);
        else stop(result.message);
        return;
      }
      if (!placed) return;
      upsertTrade(id, placed);
      update(id, {
        phase: "waiting",
        current: {
          ...session!.current!,
          tradeId: placed.id,
          value: placed.entryPrice ?? session!.current!.value,
        },
        statusText: `Open: ${pick.prediction} on ${pick.symbol} — waiting for the settled result`,
      });

      const settled = await awaitSettlement(id, account, placed);
      if (!settled) {
        if (isRunning(id)) stop("The trade result was not confirmed in time");
        return;
      }
      const result = settledResult(settled);
      update(id, {
        lastResult: {
          prediction: pick.prediction,
          digit: settled.exitDigit ?? null,
          result,
        },
        statusText: `${pick.prediction} → ${result}${settled.exitDigit != null ? ` on digit ${settled.exitDigit}` : ""}`,
      });
    }
  }

  return {
    getSnapshot(): AutoTradeSnapshot {
      if (!session)
        return { session: null, progress: EMPTY_PROGRESS, nextStake: null };
      return {
        session,
        progress: botProgress(session.trades),
        nextStake:
          session.status === "running" ? martingaleStake(session) : null,
      };
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start(
      settings: AutoTradeSettings,
      mode: AutoAccount,
      options: {
        realConfirmed?: boolean;
        prediction?: LoadedPrediction | null;
        realStakeBounds?: RealStakeBounds;
      } = {},
    ): { ok: true; session: AutoTradeSession } | { ok: false; error: string } {
      const prediction = options.prediction ?? null;
      const predictionError = validatePrediction(prediction, mode);
      if (!prediction || predictionError)
        return { ok: false, error: predictionError! };
      if (deps.currentPrediction()?.id !== prediction.id)
        return { ok: false, error: PREDICTION_CHANGED_STOP };
      if (deps.currentMode() !== mode) {
        return {
          ok: false,
          error: `Blocked: ${autoAccountLabel(deps.currentMode())} is selected, not ${autoAccountLabel(mode)}.`,
        };
      }
      if (settings.account !== mode) {
        return {
          ok: false,
          error: `Blocked: settings are for ${autoAccountLabel(settings.account)} but ${autoAccountLabel(mode)} is selected.`,
        };
      }
      if (mode === "REAL" && options.realConfirmed !== true) {
        return {
          ok: false,
          error: `Confirm that Auto Trade will place ${realAccountShort()} trades before starting.`,
        };
      }
      if (session?.status === "running")
        return { ok: false, error: "Auto Trade is already running." };
      const realStakeBounds =
        options.realStakeBounds ?? DEFAULT_REAL_STAKE_BOUNDS;
      const invalid = validateAutoSettings(settings, realStakeBounds);
      if (invalid) return { ok: false, error: invalid };
      const id = createId("auto");
      session = {
        id,
        account: mode,
        status: "running",
        phase: "checking",
        settings: { ...settings },
        realStakeBounds,
        prediction: Object.freeze({ ...prediction }),
        startedAt: nowIso(deps.now()),
        stoppedAt: null,
        stopReason: null,
        current: null,
        trades: [],
        lastResult: null,
        balance: null,
        statusText: "Starting…",
      };
      emit();
      void loop(id).catch((error: unknown) => {
        reportBackendIssue("auto_trade", "loop", error);
        if (isRunning(id))
          stop("Auto Trade stopped unexpectedly. Please try again.");
      });
      return { ok: true, session };
    },
    stop,
    stopIfNotMode(mode: AutoAccount, reason: string): void {
      if (session?.status === "running" && session.account !== mode)
        stop(reason);
    },
    dismiss(): void {
      if (session?.status === "running") return;
      session = null;
      emit();
    },
    resetForTests(): void {
      session = null;
      listeners.clear();
    },
  };
}

export type AutoTradeEngine = ReturnType<typeof createAutoTradeEngine>;

export const autoTradeEngine = createAutoTradeEngine();

export function getAutoTradeSnapshot(): AutoTradeSnapshot {
  return autoTradeEngine.getSnapshot();
}

export function subscribeAutoTrade(listener: () => void): () => void {
  return autoTradeEngine.subscribe(listener);
}

export function stopAutoTrade(reason?: string): void {
  autoTradeEngine.stop(reason);
}

export function dismissAutoTrade(): void {
  autoTradeEngine.dismiss();
}
