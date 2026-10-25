import { describe, expect, it } from "vitest";
import webSource from "./digit-contracts.ts?raw";
import denoSource from "../../../../supabase/functions/_shared/digit-contracts.ts?raw";
import {
  DIGIT_CONTRACT_OPTIONS,
  MAX_PAYOUT_RATE,
  REAL_STAKE_MAX,
  REAL_STAKE_MIN,
  TRADE_DURATIONS,
  calculateTradeResult,
  contractCanWin,
  digitPayoutRate,
  extractLastDigit,
  lastDigitOfPrice,
  normalizePipSize,
  payoutFor,
  selectExitTick,
  settleDigitContract,
  validateContractSelection,
  validateRealStake,
  validateRealTradeRequest,
  winProbability,
  type DigitContractOption,
  type DigitContractSelection,
  type DigitContractType,
} from "@/domain/digit-contracts";
import { DURATIONS } from "@/lib/constants";

function settle(
  type: DigitContractType,
  option: DigitContractOption,
  digit: number,
  extra: { selectedDigit?: number; barrier?: number } = {},
) {
  return settleDigitContract({
    contractType: type,
    contractOption: option,
    selectedDigit: extra.selectedDigit ?? null,
    barrier: extra.barrier ?? null,
    exitPrice: 0,
    exitDigit: digit,
  });
}

describe("calculateTradeResult / settleDigitContract (admin 90% account rule)", () => {
  it("wins on 0–8 and loses on 9 for EVEN / ODD", () => {
    for (const d of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(calculateTradeResult("EVEN", null, d)).toBe("WIN");
      expect(calculateTradeResult("ODD", null, d)).toBe("WIN");
      expect(settle("EVEN_ODD", "even", d)).toBe("won");
      expect(settle("EVEN_ODD", "odd", d)).toBe("won");
    }
    expect(calculateTradeResult("EVEN", null, 9)).toBe("LOSS");
    expect(calculateTradeResult("ODD", null, 9)).toBe("LOSS");
    expect(settle("EVEN_ODD", "even", 9)).toBe("lost");
    expect(settle("EVEN_ODD", "odd", 9)).toBe("lost");
  });

  it("MATCH / DIFFER follow the same 90% digit rule", () => {
    expect(calculateTradeResult("MATCH", 7, 7)).toBe("WIN");
    expect(calculateTradeResult("MATCH", 7, 6)).toBe("WIN");
    expect(calculateTradeResult("MATCH", 7, 9)).toBe("LOSS");
    expect(calculateTradeResult("DIFFER", 7, 7)).toBe("WIN");
    expect(calculateTradeResult("DIFFER", 7, 9)).toBe("LOSS");
    expect(settle("MATCH_DIFFER", "match", 7, { selectedDigit: 7 })).toBe(
      "won",
    );
    expect(settle("MATCH_DIFFER", "differ", 6, { selectedDigit: 7 })).toBe(
      "won",
    );
  });

  it("OVER / UNDER follow the same 90% digit rule", () => {
    expect(calculateTradeResult("OVER", 5, 6)).toBe("WIN");
    expect(calculateTradeResult("OVER", 5, 9)).toBe("LOSS");
    expect(calculateTradeResult("OVER", 5, 5)).toBe("WIN");
    expect(calculateTradeResult("OVER", 5, 4)).toBe("WIN");
    expect(calculateTradeResult("UNDER", 5, 4)).toBe("WIN");
    expect(calculateTradeResult("UNDER", 5, 9)).toBe("LOSS");
  });

  it("falls back to the price string when no valid exit digit is given", () => {
    expect(
      settleDigitContract({
        contractType: "EVEN_ODD",
        contractOption: "odd",
        selectedDigit: null,
        barrier: null,
        exitPrice: 1234.57,
      }),
    ).toBe("won");
    expect(
      settleDigitContract({
        contractType: "EVEN_ODD",
        contractOption: "even",
        selectedDigit: null,
        barrier: null,
        exitPrice: 1234.57,
      }),
    ).toBe("won");
  });
});

function selection(
  contractType: DigitContractType,
  contractOption: DigitContractOption,
  digit: number | null = null,
): DigitContractSelection {
  return {
    contractType,
    contractOption,
    selectedDigit: contractType === "MATCH_DIFFER" ? digit : null,
    barrier: contractType === "OVER_UNDER" ? digit : null,
  };
}

describe("digitPayoutRate (flat 0.9522 profit)", () => {
  it("pays 0.9522 on every contract that can win", () => {
    expect(winProbability(selection("EVEN_ODD", "even"))).toBe(0.5);
    expect(digitPayoutRate(selection("EVEN_ODD", "even"))).toBe(0.9522);
    expect(digitPayoutRate(selection("MATCH_DIFFER", "match", 7))).toBe(0.9522);
    expect(digitPayoutRate(selection("MATCH_DIFFER", "differ", 7))).toBe(
      0.9522,
    );
    expect(digitPayoutRate(selection("OVER_UNDER", "over", 4))).toBe(0.9522);
    expect(contractCanWin(selection("OVER_UNDER", "over", 9))).toBe(false);
    expect(digitPayoutRate(selection("OVER_UNDER", "over", 9))).toBe(0);
  });

  it("never exceeds MAX_PAYOUT_RATE and is never negative", () => {
    for (const [contractType, options] of Object.entries(
      DIGIT_CONTRACT_OPTIONS,
    ) as Array<[DigitContractType, DigitContractOption[]]>) {
      for (const contractOption of options) {
        for (let d = 0; d <= 9; d += 1) {
          const rate = digitPayoutRate(
            selection(contractType, contractOption, d),
          );
          expect(rate).toBeGreaterThanOrEqual(0);
          expect(rate).toBeLessThanOrEqual(MAX_PAYOUT_RATE);
        }
      }
    }
  });
});

describe("payoutFor", () => {
  it.each([
    [10, 0.9, 19],
    [10, 0.0555, 10.55],
    [1, 0.0555, 1.05],
  ])(
    "stake %f at rate %f returns %f (rounded down to the cent)",
    (stake, rate, expected) => {
      expect(payoutFor(stake, rate, "won")).toBe(expected);
    },
  );

  it("returns the stake on tie / refund and nothing on loss", () => {
    expect(payoutFor(5, 0.9, "tie")).toBe(5);
    expect(payoutFor(5, 0.9, "cancelled")).toBe(5);
    expect(payoutFor(5, 0.9, "lost")).toBe(0);
  });
});

describe("selectExitTick", () => {
  const expiry = 1_000_000;
  it("picks the first tick at or after expiry regardless of order", () => {
    const ticks = [
      { epochMs: expiry + 2000, price: 3 },
      { epochMs: expiry - 1000, price: 1 },
      { epochMs: expiry, price: 2 },
    ];
    expect(selectExitTick(ticks, expiry)?.price).toBe(2);
  });

  it("never uses a tick before expiry", () => {
    expect(
      selectExitTick([{ epochMs: expiry - 1, price: 1 }], expiry),
    ).toBeNull();
    expect(selectExitTick([], expiry)).toBeNull();
  });

  it("skips invalid ticks", () => {
    expect(
      selectExitTick(
        [
          { epochMs: expiry + 1, price: Number.NaN },
          { epochMs: expiry + 2, price: 9 },
        ],
        expiry,
      )?.price,
    ).toBe(9);
  });
});

describe("pip-size digit extraction", () => {
  it("normalizes decimal-place pip sizes", () => {
    expect(normalizePipSize(2)).toBeCloseTo(0.01);
    expect(normalizePipSize(4)).toBeCloseTo(0.0001);
    expect(normalizePipSize(0.001)).toBe(0.001);
    expect(normalizePipSize(0)).toBe(0.01);
  });

  it("keeps trailing zeros that the JSON number dropped", () => {
    expect(extractLastDigit(44662.425, 4)).toBe(0);
    expect(extractLastDigit(660.7, 2)).toBe(0);
    expect(extractLastDigit(660.73, 2)).toBe(3);
    expect(extractLastDigit(1022.02, 0.01)).toBe(2);
    expect(extractLastDigit(9876.123, 3)).toBe(3);
  });

  it("rejects invalid input", () => {
    expect(extractLastDigit(Number.NaN, 2)).toBeNull();
    expect(extractLastDigit(1, -1)).toBeNull();
  });

  it("lastDigitOfPrice parses the price string", () => {
    expect(lastDigitOfPrice(123.45)).toBe(5);
    expect(lastDigitOfPrice(120)).toBe(2);
  });
});

describe("validation", () => {
  it("validates contract selections", () => {
    expect(
      validateContractSelection({
        contractType: "EVEN_ODD",
        contractOption: "even",
      }),
    ).toBeNull();
    expect(
      validateContractSelection({
        contractType: "EVEN_ODD",
        contractOption: "over",
      }),
    ).toMatch(/contract type/);
    expect(
      validateContractSelection({
        contractType: "MATCH_DIFFER",
        contractOption: "match",
        selectedDigit: 10,
      }),
    ).toMatch(/digit/);
    expect(
      validateContractSelection({
        contractType: "MATCH_DIFFER",
        contractOption: "differ",
        selectedDigit: 0,
      }),
    ).toBeNull();
    expect(
      validateContractSelection({
        contractType: "OVER_UNDER",
        contractOption: "under",
        barrier: 2.5,
      }),
    ).toMatch(/barrier/);
    expect(
      validateContractSelection({
        contractType: "OVER_UNDER",
        contractOption: "under",
        barrier: 9,
      }),
    ).toBeNull();
    expect(
      validateContractSelection({
        contractType: "OVER_UNDER",
        contractOption: "over",
        barrier: 9,
      }),
    ).toMatch(/cannot win/);
    expect(
      validateContractSelection({
        contractType: "OVER_UNDER",
        contractOption: "under",
        barrier: 0,
      }),
    ).toMatch(/cannot win/);
  });

  it("enforces the $1 – $500 REAL stake limits and balance", () => {
    expect(REAL_STAKE_MIN).toBe(1);
    expect(REAL_STAKE_MAX).toBe(500);
    expect(validateRealStake(0.99)).toMatch(/Minimum/);
    expect(validateRealStake(1)).toBeNull();
    expect(validateRealStake(500.01)).toMatch(/Maximum/);
    expect(validateRealStake(5, 3.85)).toMatch(/Insufficient/);
  });

  const base = {
    account_mode: "REAL",
    symbol: "R_100",
    contract_type: "MATCH_DIFFER",
    contract_option: "match",
    selected_digit: 3,
    barrier: 7,
    stake: 2,
    duration: 15_000,
    idempotency_key: "abc12345-def6",
  };

  it("accepts a valid REAL request and drops fields that do not apply", () => {
    const result = validateRealTradeRequest(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.selectedDigit).toBe(3);
      expect(result.value.barrier).toBeNull();
    }
  });

  it.each([
    [{ symbol: "BTCUSDT" }, /market/],
    [{ account_mode: "DEMO" }, /Real account/],
  ])("rejects %o", (patch, message) => {
    const result = validateRealTradeRequest({ ...base, ...patch });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });

  it("DEMO and REAL share the same duration list", () => {
    expect(DURATIONS).toBe(TRADE_DURATIONS);
  });
});

describe("Edge Function copy", () => {
  it("supabase/functions/_shared/digit-contracts.ts is identical to src/domain/digit-contracts.ts", () => {
    expect(denoSource.length).toBeGreaterThan(1000);
    expect(denoSource.replace(/\r\n/g, "\n")).toBe(
      webSource.replace(/\r\n/g, "\n"),
    );
  });
});
