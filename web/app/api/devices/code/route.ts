import { createPairingCode } from "@/lib/devices";

/**
 * A one-time code that pairs a new device from its "not paired" page. The
 * proxy has let only the host, the tailnet and paired devices this far, and a
 * paired device may ask over Funnel too, so adding a device never needs
 * Tailscale. A device's key already reaches everything, the agents' shell
 * included, so a code gives it nothing new.
 */

export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json(createPairingCode());
}
