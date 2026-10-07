import { cn } from "@whirl/lib/utils";

/* Transitions.dev page side-by-side (CSS in globals.css): two stacked
   pages that swap with a short blur-slide — page one exits left, page two
   exits right. Both stay mounted, so each side keeps its state across
   trips; the hidden side goes visibility-hidden once its fade ends, which
   drops it out of the tab order. The container needs a size of its own
   (the pages are absolute); give `pageClassName` whatever layout the
   contents expect from their parent. */
export function PageSlide({
  page,
  one,
  two,
  className,
  pageClassName,
}: {
  page: 1 | 2;
  one: React.ReactNode;
  two: React.ReactNode;
  className?: string;
  pageClassName?: string;
}) {
  return (
    <div data-page={page} className={cn("t-page-slide", className)}>
      <section data-page-id="1" className={cn("t-page", pageClassName)}>
        {one}
      </section>
      <section data-page-id="2" className={cn("t-page", pageClassName)}>
        {two}
      </section>
    </div>
  );
}
