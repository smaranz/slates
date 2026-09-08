"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";

import { BAND_META, BAND_ORDER, computeChance, effectiveSat } from "@/lib/counselor/chances";
import { COLLEGES } from "@/lib/counselor/colleges";
import { useCounselor } from "@/lib/counselor/store";
import { profileReady } from "@/lib/counselor/state";
import type { ChanceBand, College } from "@/lib/counselor/types";
import { Icon, ICON } from "../ui";

/**
 * Every school, sorted by what this student's odds at it actually are.
 *
 * The bands come from the same engine the counselor's tools use, so a number
 * here and a number it says in conversation can never disagree. Odds are shown
 * as a range because the model behind them is coarse — a single percentage
 * would be a precision the data does not have, and precision is what makes a
 * student cut a school they should have applied to.
 */

type Round = "ED" | "EA" | "RD";

export default function CollegesView() {
  const c = useCounselor();
  const [query, setQuery] = useState("");
  const [band, setBand] = useState<ChanceBand | "all">("all");
  const [round, setRound] = useState<Round>("RD");
  const [onlyList, setOnlyList] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const ready = profileReady(c.profile);
  const listed = useMemo(() => new Map(c.list.map((e) => [e.collegeId, e.round])), [c.list]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return COLLEGES.map((college) => ({
      college,
      chance: computeChance(c.profile, college, listed.get(college.id) ?? round),
      listedRound: listed.get(college.id),
    }))
      .filter(({ college, chance, listedRound }) => {
        if (onlyList && !listedRound) return false;
        if (band !== "all" && chance.band !== band) return false;
        if (!q) return true;
        return (
          college.name.toLowerCase().includes(q) ||
          college.state.toLowerCase() === q ||
          college.topMajors.some((m) => m.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => b.chance.high - a.chance.high);
  }, [c.profile, listed, band, round, query, onlyList]);

  const counts = useMemo(() => {
    const out: Record<ChanceBand, number> = { safety: 0, match: 0, reach: 0, "hard-reach": 0 };
    for (const entry of c.list) {
      const college = COLLEGES.find((x) => x.id === entry.collegeId);
      if (college) out[computeChance(c.profile, college, entry.round).band] += 1;
    }
    return out;
  }, [c.list, c.profile]);

  return (
    <div className="counselor-page">
      <div className="counselor-page-inner">
        {!ready && (
          <div className="counselor-warn">
            These odds are guesses until your profile has a GPA in it.
            <button type="button" className="btn btn--quiet" onClick={() => c.setView("profile")}>
              Fill it in
            </button>
          </div>
        )}

        <div className="counselor-balance">
          {BAND_ORDER.map((b) => (
            <div key={b} className="counselor-balance-cell">
              <span className="counselor-balance-n" style={{ color: BAND_META[b].color }}>
                {counts[b]}
              </span>
              <span className="counselor-balance-l">{BAND_META[b].label}</span>
            </div>
          ))}
          <div className="counselor-balance-cell">
            <span className="counselor-balance-n">{effectiveSat(c.profile) ?? "—"}</span>
            <span className="counselor-balance-l">Your SAT-eq.</span>
          </div>
        </div>

        <div className="counselor-filters">
          <div className="counselor-search">
            <Icon path={ICON.search} size={13} />
            <input
              className="bare-field"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search schools, majors, or a state code"
              aria-label="Search schools"
            />
          </div>
          <div className="counselor-chips">
            {(["all", ...BAND_ORDER] as const).map((b) => (
              <button
                key={b}
                type="button"
                className={`counselor-chip${band === b ? " is-on" : ""}`}
                onClick={() => setBand(b)}
              >
                {b === "all" ? "All" : BAND_META[b].label}
              </button>
            ))}
            <span className="counselor-chip-sep" />
            {(["RD", "EA", "ED"] as Round[]).map((r) => (
              <button
                key={r}
                type="button"
                className={`counselor-chip${round === r ? " is-on" : ""}`}
                onClick={() => setRound(r)}
                title="Round used for schools not yet on your list"
              >
                {r}
              </button>
            ))}
            <span className="counselor-chip-sep" />
            <button
              type="button"
              className={`counselor-chip${onlyList ? " is-on" : ""}`}
              onClick={() => setOnlyList((v) => !v)}
            >
              My list
            </button>
          </div>
        </div>

        <div className="counselor-colleges">
          {rows.length === 0 && <p className="counselor-empty-note">Nothing matches.</p>}
          {rows.map(({ college, chance, listedRound }) => {
            const expanded = openId === college.id;
            return (
              <div key={college.id} className={`counselor-college${listedRound ? " is-listed" : ""}`}>
                <button
                  type="button"
                  className="counselor-college-head"
                  onClick={() => setOpenId(expanded ? null : college.id)}
                  aria-expanded={expanded}
                >
                  <span className="counselor-band" style={{ background: BAND_META[chance.band].color }} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="counselor-college-name truncate">{college.name}</span>
                    <span className="counselor-college-sub">
                      {college.city}, {college.state} · {college.sat25}–{college.sat75} · $
                      {(college.costPerYear / 1000).toFixed(0)}k/yr
                    </span>
                  </span>
                  <span className="counselor-odds">
                    <span className="counselor-odds-n">
                      {chance.low}–{chance.high}%
                    </span>
                    <span className="counselor-odds-b" style={{ color: BAND_META[chance.band].color }}>
                      {BAND_META[chance.band].label}
                    </span>
                  </span>
                  <Icon
                    path={ICON.chevronDown}
                    size={13}
                    style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform .18s" }}
                  />
                </button>

                {expanded && (
                  <motion.div
                    className="counselor-college-body"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <p className="counselor-college-summary">{chance.summary}</p>
                    <div className="counselor-factors">
                      {chance.factors.map((f) => (
                        <div key={f.label} className={`counselor-factor is-${f.status}`}>
                          <span className="counselor-factor-label">{f.label}</span>
                          <span className="counselor-factor-detail">{f.detail}</span>
                        </div>
                      ))}
                    </div>
                    <div className="counselor-college-foot">
                      <span className="counselor-majors">{college.topMajors.join(" · ")}</span>
                      <ListButtons college={college} current={listedRound} />
                    </div>
                  </motion.div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ListButtons({ college, current }: { college: College; current?: Round }) {
  const c = useCounselor();
  return (
    <span className="counselor-round-picker">
      {(["ED", "EA", "RD"] as Round[]).map((r) => (
        <button
          key={r}
          type="button"
          className={`counselor-chip${current === r ? " is-on" : ""}`}
          onClick={() => c.toggleList(college.id, r)}
          title={current === r ? `Remove ${college.name} from your list` : `Add ${college.name} as ${r}`}
        >
          {r}
        </button>
      ))}
    </span>
  );
}
