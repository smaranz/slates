import { Skeleton } from "@whirl/components/ui/skeleton";

/* First-ever-visit bones for the store's shelves: a section title bar over
   silhouettes of the flat directory rows, twice — the first two category
   sections. Later visits paint real cached rows instead. */
export function StoreSkeleton() {
  return (
    <div>
      {[4, 6].map((rows, section) => (
        <div key={section} className={section > 0 ? "mt-7" : undefined}>
          <Skeleton className="mb-2.5 ml-1 h-4 w-24" />
          <div className="grid gap-x-4 gap-y-1 md:grid-cols-2">
            {Array.from({ length: rows }, (_, index) => (
              <div key={index} className="flex items-center gap-3 px-3 py-2.5">
                <Skeleton className="size-11 rounded-[10px]" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3 w-40 max-w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
