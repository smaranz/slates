import { categoryPct } from "./normalize";
import type { CustomScore, GradeCategory } from "./types";

export interface ProjectedCategory {
  name: string;
  weight: number;
  earned: number;
  possible: number;
  custom?: boolean;
  /** A what-if score was folded in here, so the points no longer match Schoology's. */
  touched?: boolean;
  /**
   * Points Schoology holds in this category but isn't counting yet. Kept aside
   * rather than dropped so a what-if can bring the whole category into play.
   */
  held?: number;
}

export interface Projection {
  cats: ProjectedCategory[];
  /** null when nothing in the course is graded — which is not the same as 0%. */
  pct: number | null;
}

/**
 * Which categories Schoology is actually counting toward the course grade.
 *
 * When a gradebook publishes per-category percentages, an omitted one is
 * meaningful: that category is not in the grade yet, even though it holds real
 * points. A physics gradebook showing "Quizzes and Tests: 5/7" with no
 * percentage is exactly that — Schoology reports the course as 93.3%, which is
 * the Assignments category alone. Counting those 5/7 anyway dragged the
 * recomputed grade fourteen points below the reported one, and the what-if
 * projection then amplified that gap into an impossible 114%.
 *
 * Plenty of gradebooks publish no category percentages at all, and there the
 * points are all there is — hence a fallback rather than a flat rule.
 *
 * Exported so every screen agrees: a category the headline ignores must not
 * look counted in the list underneath it.
 */
export function countsTowardGrade(categories: GradeCategory[]): (c: GradeCategory) => boolean {
  const publishesPercentages = categories.some((c) => c.pct != null);
  return (c) => (publishesPercentages ? c.pct != null : c.possible > 0);
}

/**
 * Weighted category average. `extra` folds hypothetical or manually-entered
 * scores into their matching category, or appends a new weighted category.
 *
 * Every number here traces back to points Schoology published or a score you
 * typed in yourself. A category graded in letters alone contributes nothing:
 * there is no honest way to fold "A−" into an average, and pretending there is
 * moved the projected grade by whatever the guess happened to be.
 */
export function gradeFor(
  categories: GradeCategory[] = [],
  extra: Array<Pick<CustomScore, "cat" | "weight" | "earned" | "possible">> = []
): Projection {
  const counted = countsTowardGrade(categories);

  const cats: ProjectedCategory[] = categories.map((c) => {
    if (!counted(c)) {
      // Not counted yet. The points are set aside rather than dropped, so a
      // what-if typed here can bring the category in — see `held` below.
      return { name: c.cat, weight: c.weight, earned: 0, possible: 0, held: c.possible };
    }

    /*
     * Schoology's own percentage outranks the points whenever it publishes
     * one. The two disagree more often than you would expect — dropped
     * scores, excused items, weighting inside a category — and this gradebook
     * is a live example: Assignments sums to 267.2/270, which is 98.96%, while
     * Schoology reports that category as 93.3%. Trusting the points made every
     * recomputed grade quietly wrong.
     *
     * The published standing is re-expressed on the category's own point scale
     * so a what-if, which arrives in points, still folds into the same units.
     */
    if (c.pct != null && c.possible > 0) {
      return {
        name: c.cat,
        weight: c.weight,
        earned: (c.pct / 100) * c.possible,
        possible: c.possible,
      };
    }
    if (c.possible > 0) {
      return { name: c.cat, weight: c.weight, earned: c.earned, possible: c.possible };
    }
    // Graded with a percentage and no points at all. Express it out of 100 so
    // hypotheticals still fold in.
    const standing = categoryPct(c).pct;
    return {
      name: c.cat,
      weight: c.weight,
      earned: standing ?? 0,
      possible: standing === null ? 0 : 100,
    };
  });

  for (const w of extra) {
    const hit = cats.find((c) => c.name === w.cat);
    if (hit) {
      /*
       * A what-if in a category Schoology isn't counting yet brings that
       * category into the grade — which is precisely the question being asked.
       * Whatever it was already holding comes in at the same moment, so the
       * answer reflects the category rather than the one hypothetical row.
       */
      if (hit.possible === 0 && hit.held) {
        const source = categories.find((c) => c.cat === hit.name);
        hit.earned = source?.earned ?? 0;
        hit.possible = hit.held;
        hit.held = undefined;
      }
      hit.earned += w.earned;
      hit.possible += w.possible;
      hit.touched = true;
    } else {
      cats.push({
        name: w.cat,
        weight: w.weight,
        earned: w.earned,
        possible: w.possible,
        custom: true,
      });
    }
  }

  const scored = cats.filter((c) => c.possible > 0);
  if (!scored.length) return { cats, pct: null };

  const totalWeight = scored.reduce((a, c) => a + c.weight, 0);
  if (totalWeight > 0) {
    const pct =
      (scored.reduce((a, c) => a + c.weight * (c.earned / c.possible), 0) / totalWeight) * 100;
    return { cats, pct };
  }

  // Unweighted gradebook: total points, not an even average of the categories.
  const possible = scored.reduce((a, c) => a + c.possible, 0);
  const earned = scored.reduce((a, c) => a + c.earned, 0);
  return { cats, pct: (earned / possible) * 100 };
}

export function letterFor(p: number): string {
  if (p >= 93) return "A";
  if (p >= 90) return "A-";
  if (p >= 87) return "B+";
  if (p >= 83) return "B";
  if (p >= 80) return "B-";
  if (p >= 77) return "C+";
  if (p >= 73) return "C";
  if (p >= 70) return "C-";
  if (p >= 67) return "D+";
  if (p >= 60) return "D";
  return "F";
}

/** Score needed on a final worth `weight`% to land at `target`%. */
export function neededOnFinal(
  current: number,
  weight: number,
  target: number
): number {
  if (weight <= 0) return 0;
  return (target - current * (1 - weight / 100)) / (weight / 100);
}

export function scoreColor(pct: number): string {
  if (pct >= 90) return "var(--good)";
  if (pct >= 80) return "var(--text)";
  return "var(--warn)";
}
