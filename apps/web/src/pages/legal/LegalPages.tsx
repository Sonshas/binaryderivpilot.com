import { PageHeader } from "@/components/ui";
import {
  demoAccountName,
  demoAccountShort,
  realAccountName,
} from "@/lib/branding";
import { RISK_DISCLAIMER } from "@/lib/constants";

export function DisclosurePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <PageHeader
        title="Disclosure"
        subtitle="Risk, terms, and privacy for this site."
      />
      <div className="space-y-8 text-sm leading-relaxed text-mist">
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold text-paper">
            Risk
          </h2>
          <p>{RISK_DISCLAIMER}</p>
          <p>
            Trading can lose the stake. Past ticks do not predict the next
            digit. No profit is guaranteed.
          </p>
        </section>
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold text-paper">
            Terms
          </h2>
          <p>
            You use a {demoAccountName().toLowerCase()} balance and, when it is
            funded, a separate {realAccountName().toLowerCase()} balance.{" "}
            {demoAccountShort()} results are virtual funds only.
          </p>
          <p>
            A {realAccountName().toLowerCase()} trade uses the live exit digit
            of the contract you choose. Access can be turned off for an account.
          </p>
        </section>
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold text-paper">
            Privacy
          </h2>
          <p>
            The site stores your account details, balances, and trade history so
            the account can run. Payment details are handled by the active
            payment partner. Do not share your password, including with support.
          </p>
        </section>
      </div>
    </main>
  );
}
