"use client";

import css from "@/components/SchoologySignIn.module.css";
import { Icon, ICON } from "@/components/ui";
import type { SignInSurfaceProps } from "@/lib/onboarding/types";

import s from "./simulator.module.css";

export default function SignInSurface({ domain, hostName, onCancel }: SignInSurfaceProps) {
  return (
    <div className={`${css.overlay} ${s.surface}`} role="dialog" aria-modal="true" aria-label="Sign in to Schoology">
      <header className={`${css.bar} schoology-viewer-bar`} style={{ paddingLeft: 64 }}>
        <div className={css.heading}>
          <h2 className={css.title}>
            <i aria-hidden="true" />
            Sign in to Schoology
          </h2>
          <p className={css.sub}>
            {domain}, open in the browser Slates syncs with{hostName ? ` on ${hostName}` : ""}. What you type goes to that browser and on to Schoology;
            Slates doesn&apos;t keep it.
          </p>
        </div>
        <button type="button" className={`icon-btn ${css.icon}`} aria-label="Back" disabled>
          <Icon path={ICON.chevronLeft} size={16} />
        </button>
        <button type="button" className={`icon-btn ${css.icon}`} aria-label="Start over" disabled>
          <Icon path={ICON.retry} size={15} />
        </button>
        <button type="button" className="btn btn--quiet" onClick={onCancel}>
          Cancel
        </button>
      </header>
      <div className={css.stage}>
        <div className={s.remote}>
          <div className={s.remoteHeader}>
            <span className={s.remoteWordmark}>schoology</span>
          </div>
          <div className={s.remoteBody}>
            <div className={s.remoteCard}>
              <span className={s.remoteLine} style={{ width: "46%" }} />
              <span className={s.remoteGoogle}>Continue with Google</span>
              <span className={s.remoteField} />
              <span className={s.remoteField} />
              <span className={s.remoteButton} />
            </div>
          </div>
        </div>
      </div>
      <p className={css.hint}>The simulator signs in by itself after a few seconds. In the app this is the sync browser&apos;s own page, streamed live.</p>
    </div>
  );
}
