/**
 * usePaperSound.ts
 *
 * Hook React untuk memicu sound effect balikan kertas.
 * Cache `playPaperFlipSound` lewat useCallback supaya handler-nya stabil
 * lintas render — aman dipakai di event drag, onClick tombol next/prev buku,
 * atau apa pun yang dipanggil berulang dan cepat.
 */

import { useCallback } from "react";
import { playPaperFlipSound, disposePaperSound } from "../lib/paperSound";

export function usePaperSound() {
  /** Mainkan satu balikan kertas. `intensity` 0–1, default 0.5. */
  const play = useCallback((intensity?: number) => {
    playPaperFlipSound(intensity);
  }, []);

  /** Versi debounce tipis untuk event drag/scroll yang membara banyak event. */
  const playThrottled = useCallback(
    (() => {
      let lastTime = 0;
      const minGap = 110; // ms — jaga agar tidak menumpuk suara saat drag cepat
      return (intensity?: number) => {
        const now =
          (typeof performance !== "undefined" ? performance.now() : Date.now());
        if (now - lastTime < minGap) return;
        lastTime = now;
        playPaperFlipSound(intensity);
      };
    })(),
    []
  );

  return { play, playThrottled, dispose: disposePaperSound };
}
