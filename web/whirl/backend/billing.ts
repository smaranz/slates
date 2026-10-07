"use client";

/* Whirl's billing ran on Autumn. Slates has nothing to sell: the models are
   the ones already signed in on the host, so every reader of the customer
   sees a settled answer with no plan and no metered features, and
   features.get says billing is off — Whirl's own "no billing" path. */

const CUSTOMER = {
  id: "slates-student",
  products: [] as { id: string; status?: string; name?: string }[],
  features: {} as Record<string, { balance?: number; usage?: number; included_usage?: number; unlimited?: boolean }>,
};

export function useCustomer() {
  return {
    customer: CUSTOMER,
    isLoading: false,
    error: null,
    refetch: async () => CUSTOMER,
    openBillingPortal: async () => {},
    cancel: async () => {},
    checkout: async () => {},
    attach: async () => {},
    track: async () => {},
  };
}
