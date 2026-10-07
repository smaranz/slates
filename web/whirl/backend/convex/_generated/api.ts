/* Whirl calls its backend as `api.<module>.<function>`. In Slates those
   functions run in the Next server (lib/whirl-server), so a reference is
   nothing more than the function's name, and every one resolves. */

export type FunctionRef = { readonly __whirlFunction: string };

function moduleProxy(module: string): Record<string, FunctionRef> {
  return new Proxy({} as Record<string, FunctionRef>, {
    get: (_, fn) => (typeof fn === "string" ? { __whirlFunction: `${module}.${fn}` } : undefined),
  });
}

const modules = new Map<string, Record<string, FunctionRef>>();

// Typed loosely on purpose: Whirl reads return types off these with
// FunctionReturnType, and without Convex's codegen those are `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const api: any = new Proxy(
  {},
  {
    get: (_, module) => {
      if (typeof module !== "string") return undefined;
      let proxy = modules.get(module);
      if (!proxy) modules.set(module, (proxy = moduleProxy(module)));
      return proxy;
    },
  },
);

export const internal = api;

export function functionName(ref: unknown): string {
  const name = (ref as FunctionRef | undefined)?.__whirlFunction;
  if (!name) throw new Error("Not a Whirl function reference.");
  return name;
}
