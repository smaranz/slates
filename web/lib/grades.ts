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
}

export interface Projection {
  cats: ProjectedCategory[];
  /** null when nothing in the course is graded — which is not the same as 0%. */
  pct: number | null;
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
  const cats: ProjectedCategory[] = categories.map((c) => {
    if (c.possible > 0) {
      return { name: c.cat, weight: c.weight, earned: c.earned, possible: c.possible };
    }
    // Graded, but with a percentage instead of points (Schoology does this for
    // some categories). Express it out of 100 so hypotheticals still fold in.
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
