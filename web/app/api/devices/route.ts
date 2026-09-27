import { originOf } from "@/lib/device-gate";
import { DEVICE_COOKIE, forgetDevice, listDevices, mintKey, verifyKey } from "@/lib/devices";

const cookieOf = (header: string | null) => {
  const value = header?.split(/;\s*/).find((part) => part.startsWith(`${DEVICE_COOKIE}=`))?.slice(DEVICE_COOKIE.length + 1);
  return value ? decodeURIComponent(value) : null;
};

/**
 * The devices paired with this Slates: list them, forget one, or issue a key
 * for a script. The proxy has already turned away anything unpaired.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return Response.json({
    devices: listDevices().sort((a, b) => b.lastSeen - a.lastSeen),
    current: verifyKey(cookieOf(request.headers.get("cookie")))?.id ?? null,
    local: originOf(request.headers).kind === "local",
  });
}

export async function POST(request: Request) {
  // Keys only for callers on the host or the tailnet: a stolen device key can't mint itself more.
  if (originOf(request.headers).kind === "outside") {
    return Response.json({ error: "New keys can only be made from the host or over Tailscale." }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  const { key, device } = mintKey(typeof body.name === "string" ? body.name : "Script");
  return Response.json({ key, id: device.id, name: device.name });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[a-f0-9]{16}$/.test(id) || !forgetDevice(id)) return Response.json({ error: "No such device." }, { status: 404 });
  return Response.json({ ok: true });
}
