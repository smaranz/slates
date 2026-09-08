"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

interface AITextLoadingProps {
  texts?: string[];
  interval?: number;
  size?: number;
  style?: CSSProperties;
}

/**
 * The shimmering, cycling-phrase loading treatment tutors expect from a
 * modern AI chat — sweeps a highlight through the current phrase's text
 * itself rather than showing a separate spinner next to it.
 */
export default function AITextLoading({
  texts = ["Thinking...", "Reading...", "Considering...", "Working it out...", "Almost..."],
  interval = 1500,
  size = 14,
  style,
}: AITextLoadingProps) {
  const [currentTextIndex, setCurrentTextIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTextIndex((prevIndex) => (prevIndex + 1) % texts.length);
    }, interval);
    return () => clearInterval(timer);
  }, [interval, texts.length]);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={currentTextIndex}
        initial={{ opacity: 0, y: 6 }}
        animate={{
          opacity: 1,
          y: 0,
          backgroundPosition: ["200% center", "-200% center"],
        }}
        exit={{ opacity: 0, y: -6 }}
        transition={{
          opacity: { duration: 0.25 },
          y: { duration: 0.25 },
          backgroundPosition: {
            duration: 2.2,
            ease: "linear",
            repeat: Number.POSITIVE_INFINITY,
          },
        }}
        style={{
          display: "inline-block",
          whiteSpace: "nowrap",
          fontSize: size,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          backgroundImage: "linear-gradient(90deg, var(--muted), var(--text), var(--muted))",
          backgroundSize: "200% 100%",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          ...style,
        }}
      >
        {texts[currentTextIndex]}
      </motion.div>
    </AnimatePresence>
  );
}
