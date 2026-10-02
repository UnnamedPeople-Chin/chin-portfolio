import { useEffect, useRef } from "react";
import "./EntranceReveal.css";

export function EntranceReveal() {
  const revealRef = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (hasAnimated.current || !revealRef.current) return;
    hasAnimated.current = true;

    const reveal = revealRef.current;
    
    requestAnimationFrame(() => {
      reveal.classList.add("is-active");
    });

    // Total: 3.5s (burst 0.6s + reveal 1.2s + expand 1.2s + fade 0.5s)
    setTimeout(() => {
      reveal.classList.add("is-done");
      setTimeout(() => {
        reveal.style.display = "none";
      }, 500);
    }, 3500);
  }, []);

  return (
    <div className="entrance-reveal" ref={revealRef} aria-hidden="true">
      {/* Particle burst */}
      <div className="particle-burst">
        {[...Array(12)].map((_, i) => (
          <div key={i} className="particle" style={{"--i": i} as any}></div>
        ))}
      </div>

      {/* Main content with circular mask reveal */}
      <div className="reveal-mask">
        <img
          className="reveal-bg"
          src="/chin-portfolio/bloom.png"
          alt=""
          aria-hidden="true"
        />

        <div className="reveal-content">
          <h1 className="reveal-title">
            The <em>ai</em><br />Edition
          </h1>
          
          <div className="reveal-details">
            <p>A new world of commerce</p>
            <p>150+ product updates</p>
            <div className="reveal-tags">
              <span>Sidekick</span>
              <span>Agenttic</span>
              <span>Giants</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
