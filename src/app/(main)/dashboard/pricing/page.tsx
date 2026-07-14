import { getIntervalFromPriceId } from "@/lib/billing/plans";
import { api } from "@/trpc/server";

import { PricingCards } from "./_components/pricing-cards";

export const dynamic = "force-dynamic";

async function PricingPage() {
  const subscriptions = await api.subscriptions.get.query();
  const currentInterval = getIntervalFromPriceId(subscriptions.subscriptions?.stripePriceId);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PricingCards currentPlan={subscriptions.plan} currentInterval={currentInterval} />
    </div>
  );
}

export default PricingPage;
