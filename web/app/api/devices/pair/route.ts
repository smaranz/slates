import { NextResponse } from "next/server";

import { DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS, redeemPairingCode } from "@/lib/devices";

/**
 * The "not paired" page's form (lib/device-gate.ts): a code from a paired
 * device's Settings pairs this one. Open to anyone, since the code is the
 * credential and lib/devices.ts limits the guesses. It answers with a
 * redirect either way, so the page comes back as Slates, or as itself with
 * the reason.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const result = redeemPairingCode(String(form?.get("code") ?? ""), request.headers.get("user-agent") ?? "");
  const response = new NextResponse(null, { status: 303, headers: { location: "error" in result ? `/?pairing=${result.error}` : "/" } });
  if (!("error" in result)) response.cookies.set(DEVICE_COOKIE, result.key, DEVICE_COOKIE_OPTIONS);
  return response;
}
