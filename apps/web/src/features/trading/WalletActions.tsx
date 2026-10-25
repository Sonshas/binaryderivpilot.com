import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui";
import { useAccountMode } from "@/hooks/useAccountMode";
import { useAuthSession } from "@/hooks/useAuth";
import { replenishDemoBalance } from "@/lib/demo-store";
import { RealDepositPanel } from "@/features/wallet/RealDepositPanel";
import { RealWithdrawPanel } from "@/features/wallet/RealWithdrawPanel";
import type { AccountMode } from "@/types";
import { demoAccountShort, realAccountName } from "@/lib/branding";

export function WalletActions({
  kind,
  className,
}: {
  kind: AccountMode;
  className?: string;
}) {
  const navigate = useNavigate();
  const { setKind } = useAccountMode();
  const { isSignedIn } = useAuthSession();
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const isDemo = kind === "demo";

  useEffect(() => {
    if (!depositOpen && !withdrawOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDepositOpen(false);
        setWithdrawOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [depositOpen, withdrawOpen]);

  function deposit() {
    if (!isSignedIn) {
      navigate("/login");
      return;
    }
    if (isDemo) setKind("real");
    setDepositOpen(true);
  }

  function withdraw() {
    if (isDemo) setKind("real");
    if (!isSignedIn) navigate("/login");
    else setWithdrawOpen(true);
  }

  return (
    <div className={className}>
      <div
        className="flex flex-wrap items-center justify-end gap-2"
        data-testid="wallet-actions"
        data-kind={kind}
      >
        {isDemo ? (
          <Button
            size="sm"
            variant="secondary"
            className="h-8 px-3"
            onClick={() => replenishDemoBalance()}
            data-testid="desk-replenish"
          >
            Replenish
          </Button>
        ) : null}
        <Button
          size="sm"
          className="h-8 px-3"
          onClick={deposit}
          data-testid="desk-deposit"
        >
          Deposit
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="h-8 gap-1 px-3"
          onClick={withdraw}
          title={
            isDemo
              ? `${demoAccountShort()} funds cannot be withdrawn — switches to your ${realAccountName()}`
              : "Withdraw to M-Pesa"
          }
          data-testid="desk-withdraw"
        >
          Withdraw
        </Button>
      </div>

      {depositOpen && !isDemo ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
          role="presentation"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close deposit"
            onClick={() => setDepositOpen(false)}
          />
          <div
            className="relative z-10 max-h-[90svh] w-full max-w-md overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-label="Deposit with M-Pesa"
          >
            <RealDepositPanel
              className="shadow-2xl"
              onClose={() => setDepositOpen(false)}
            />
          </div>
        </div>
      ) : null}

      {withdrawOpen && !isDemo ? (
        <RealWithdrawPanel
          className="shadow-2xl"
          onClose={() => setWithdrawOpen(false)}
        />
      ) : null}
    </div>
  );
}
