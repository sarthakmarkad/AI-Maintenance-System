"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./landing-video.module.css";

export function LandingVideo() {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      const player = video.current;
      if (!player) return;
      if (preference.matches) player.pause();
      else
        void player.play().catch((error: unknown) => {
          if (
            !preference.matches &&
            !(error instanceof DOMException && error.name === "AbortError")
          )
            setFailed(true);
        });
    };
    sync();
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);

  return (
    <figure className={styles.panel} aria-labelledby="landing-video-title">
      <div className={styles.heading}>
        <span className={styles.eyebrow}>THE PLATFORM IN MOTION</span>
        <span className={styles.duration}>PRODUCT TOUR</span>
      </div>
      <div className={styles.screen}>
        <video
          ref={video}
          className={styles.video}
          width="1280"
          height="720"
          muted
          loop
          playsInline
          preload="metadata"
          poster="/landing-video/poster.jpg"
          src="/landing-video/maintenance-demo.mp4"
          aria-label="Illustrative maintenance platform product tour"
          aria-describedby="landing-video-description"
          onError={() => setFailed(true)}
        />
      </div>
      <figcaption className={styles.caption}>
        <div className={styles.titleRow}>
          <h2 id="landing-video-title">Maintenance, connected.</h2>
        </div>
        <p id="landing-video-description">
          AI-assisted illustrative tour · Sample records · No audio
        </p>
        {failed && (
          <p role="status">Video unavailable. Explore the walkthrough below.</p>
        )}
        <details className={styles.transcript}>
          <summary>Read the walkthrough</summary>
          <p>
            Explore machine records, production and process trends, work orders,
            planned maintenance, notifications, reports, approved manuals and
            SOPs, and AI-assisted guidance and RCA drafting. People review
            findings and make maintenance decisions.
          </p>
        </details>
      </figcaption>
    </figure>
  );
}
