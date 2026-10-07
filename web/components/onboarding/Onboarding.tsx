"use client";

import { AnimatePresence, MotionConfig, motion, type Variants } from "motion/react";
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";

import { Icon, ICON } from "@/components/ui";
import type { Mode } from "@/lib/mode";
import { EMPTY_ANSWERS, nextStep, PHASE_LABEL, previousStep, progressOf, stepsFor, type Path } from "@/lib/onboarding/flow";
import type { Answers, FinishHow, OnboardingEnv, StepId } from "@/lib/onboarding/types";

import styles from "./onboarding.module.css";
import { EASE, Reveal } from "./parts";
import type { AnswersPatch, Live, StepProps } from "./step";
import { Host, Pair, Prepare, Rooms, Schoology, Sync, Welcome, Where } from "./steps/connect";
import { Ai, Done, Notify, Profile } from "./steps/yours";
import Visual, { visualKind } from "./visuals";

const STEPS: Record<StepId, ComponentType<StepProps>> = {
  welcome: Welcome,
  rooms: Rooms,
  where: Where,
  prepare: Prepare,
  host: Host,
  pair: Pair,
  schoology: Schoology,
  sync: Sync,
  profile: Profile,
  ai: Ai,
  notify: Notify,
  done: Done,
};

const pathOf = (answers: Answers): Path => ({ runsOn: answers.runsOn, rooms: answers.rooms });

const STEP_MOTION: Variants = {
  enter: (direction: number) => ({ opacity: 0, x: 22 * direction }),
  center: { opacity: 1, x: 0, transition: { duration: 0.42, ease: EASE } },
  exit: (direction: number) => ({ opacity: 0, x: -14 * direction, transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } }),
};

export default function Onboarding({
  env,
  initialStep = "welcome",
  initialAnswers = EMPTY_ANSWERS,
  reducedMotion = false,
  onStep,
  onFinish,
}: {
  env: OnboardingEnv;
  initialStep?: StepId;
  initialAnswers?: Answers;
  reducedMotion?: boolean;
  onStep?: (step: StepId, answers: Answers) => void;
  onFinish?: (answers: Answers, how: FinishHow, open: Mode | null) => void;
}) {
  const [step, setStep] = useState<StepId>(initialStep);
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [live, setLive] = useState<Live>({});
  const [direction, setDirection] = useState<1 | -1>(1);
  const [overlay, setOverlay] = useState<HTMLElement | null>(null);
  const latest = useRef({ step: initialStep, answers: initialAnswers });
  const callbacks = useRef({ onStep, onFinish });

  useEffect(() => {
    callbacks.current = { onStep, onFinish };
  });

  useEffect(() => {
    callbacks.current.onStep?.(step, answers);
  }, [step, answers]);

  const update = useCallback((patch: AnswersPatch) => {
    const current = latest.current.answers;
    const merged = { ...current, ...(typeof patch === "function" ? patch(current) : patch) };
    latest.current.answers = merged;
    setAnswers(merged);
  }, []);

  const patchLive = useCallback((patch: Partial<Live>) => setLive((current) => ({ ...current, ...patch })), []);

  const show = useCallback((target: StepId, towards: 1 | -1) => {
    latest.current.step = target;
    setDirection(towards);
    setLive({});
    setStep(target);
  }, []);

  const next = useCallback(() => {
    const target = nextStep(latest.current.step, pathOf(latest.current.answers));
    if (target) show(target, 1);
  }, [show]);

  const back = useCallback(() => {
    const target = previousStep(latest.current.step, pathOf(latest.current.answers));
    if (target) show(target, -1);
  }, [show]);

  const goTo = useCallback(
    (target: StepId) => {
      const order = stepsFor(pathOf(latest.current.answers));
      show(target, order.indexOf(target) < order.indexOf(latest.current.step) ? -1 : 1);
    },
    [show]
  );

  const finish = useCallback(
    (how: FinishHow, open: Mode | null = null) => {
      env.finish(latest.current.answers, how, open);
      callbacks.current.onFinish?.(latest.current.answers, how, open);
    },
    [env]
  );

  const path: Path = {
    runsOn: step === "where" && live.chosen ? live.chosen : answers.runsOn,
    rooms: step === "rooms" && live.rooms ? live.rooms : answers.rooms,
  };
  const order = stepsFor(path);
  const at = order.indexOf(step);
  const progress = progressOf(step, path);
  const counted = order.filter((s) => progressOf(s, path));
  const phases = (["connect", "yours"] as const).map((phase) => counted.filter((s) => progressOf(s, path)?.phase === phase));
  const StepView = STEPS[step];

  return (
    <MotionConfig reducedMotion={reducedMotion ? "always" : "user"}>
      <div className={styles.root} data-reduced={reducedMotion || undefined}>
        <div className={styles.bar}>
          {step !== "welcome" && (
            <button type="button" className={styles.back} onClick={back} aria-label="Back">
              <Icon path={ICON.chevronLeft} size={18} />
            </button>
          )}
          {progress && (
            <div className={styles.progress} aria-hidden>
              <div className={styles.phases}>
                {phases.map((group, i) => (
                  <div key={i} className={styles.segments}>
                    {group.map((s) => (
                      <span key={s} className={styles.segment}>
                        <motion.span initial={false} animate={{ scaleX: order.indexOf(s) <= at ? 1 : 0 }} transition={{ duration: 0.5, ease: EASE }} />
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
          {step !== "welcome" && step !== "done" && (
            <button type="button" className={styles.later} onClick={() => finish("skipped", null)}>
              Finish later
            </button>
          )}
        </div>
        <p className={styles.srOnly} aria-live="polite">
          {progress ? `${PHASE_LABEL[progress.phase]}, step ${progress.index} of ${progress.total}` : ""}
        </p>
        <div className={styles.layout}>
          <main className={styles.content}>
            <AnimatePresence mode="wait" initial={false} custom={direction}>
              <motion.div key={step} className={styles.step} custom={direction} variants={STEP_MOTION} initial="enter" animate="center" exit="exit">
                {progress && (
                  <Reveal i={0}>
                    <p className={styles.kicker}>
                      {PHASE_LABEL[progress.phase]} · {progress.index} of {progress.total}
                    </p>
                  </Reveal>
                )}
                <StepView
                  env={env}
                  answers={answers}
                  update={update}
                  live={live}
                  patchLive={patchLive}
                  next={next}
                  goTo={goTo}
                  finish={finish}
                  overlay={overlay}
                />
              </motion.div>
            </AnimatePresence>
          </main>
          <aside className={styles.stage} aria-hidden>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={visualKind(step)}
                className={styles.visual}
                initial={{ opacity: 0, scale: 0.985 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.99 }}
                transition={{ duration: 0.45, ease: EASE }}
              >
                <Visual step={step} answers={answers} live={live} />
              </motion.div>
            </AnimatePresence>
          </aside>
        </div>
        <div ref={setOverlay} className={styles.overlay} />
      </div>
    </MotionConfig>
  );
}
