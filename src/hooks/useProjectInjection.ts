import { useEffect } from "react";
import projectsData from "../data/projects.json";

export function useProjectInjection(frameRef: React.RefObject<HTMLIFrameElement>) {
  useEffect(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!doc) return;

    const injectionScript = doc.createElement("script");
    injectionScript.textContent = `
(function() {
  const projectsData = ${JSON.stringify(projectsData)};

  // Intercept plate clicks to send to React
  document.addEventListener('click', function(e) {
    const plate = e.target.closest('.plate');
    if (!plate) return;

    const tag = plate.querySelector('.plate-tag')?.textContent?.trim();
    if (!tag) return;

    e.preventDefault();
    e.stopPropagation();

    window.parent.postMessage({
      type: 'PROJECT_TAG_CLICK',
      tag: tag
    }, '*');
  }, true);

  // Dynamic tag generation from JSON
  const plateList = document.getElementById('plateList');
  if (plateList && projectsData) {
    // Clear hardcoded tags
    plateList.innerHTML = '';

    // Generate positions
    function generateScatteredPositions(count) {
      const defaultZones = [
        { x: 16, y: 15, side: 'right', rot: -1.2 },
        { x: 50, y: 13, side: 'right', rot: 1.5 },
        { x: 84, y: 16, side: 'left', rot: -1.8 },
        { x: 30, y: 32, side: 'right', rot: 0.8 },
        { x: 70, y: 33, side: 'left', rot: -1.0 },
        { x: 13, y: 49, side: 'right', rot: 1.2 },
        { x: 87, y: 48, side: 'left', rot: 0.5 },
        { x: 48, y: 52, side: 'right', rot: -1.4 },
        { x: 22, y: 69, side: 'right', rot: 1.0 },
        { x: 76, y: 68, side: 'left', rot: -1.2 },
        { x: 42, y: 84, side: 'right', rot: 0.6 },
        { x: 82, y: 84, side: 'left', rot: -0.8 }
      ];

      const positions = [];
      const minDistance = 16;

      for (let i = 0; i < count; i++) {
        if (i < defaultZones.length) {
          positions.push({...defaultZones[i]});
        } else {
          let best = { x: 50, y: 50, side: 'right', rot: 0 };
          let maxDist = -1;
          for (let attempt = 0; attempt < 50; attempt++) {
            const cx = Math.round(12 + Math.random() * 76);
            const cy = Math.round(14 + Math.random() * 72);
            let closest = Infinity;
            for (const p of positions) {
              const d = Math.hypot((cx - p.x) * 1.25, cy - p.y);
              if (d < closest) closest = d;
            }
            if (closest >= minDistance) {
              best = {
                x: cx,
                y: cy,
                side: cx > 50 ? 'left' : 'right',
                rot: Number(((Math.random() * 3.2) - 1.6).toFixed(1))
              };
              break;
            }
            if (closest > maxDist) {
              maxDist = closest;
              best = {
                x: cx,
                y: cy,
                side: cx > 50 ? 'left' : 'right',
                rot: Number(((Math.random() * 3.2) - 1.6).toFixed(1))
              };
            }
          }
          positions.push(best);
        }
      }
      return positions;
    }

    const allTags = projectsData.skills || [];
    const tagPositions = generateScatteredPositions(allTags.length);

    allTags.forEach((tag, i) => {
      const pos = tagPositions[i] || { x: 50, y: 50, side: 'right', rot: 0 };
      const li = document.createElement('li');
      li.className = 'plate-cloud-item';
      li.style.setProperty('--x', pos.x + '%');
      li.style.setProperty('--y', pos.y + '%');
      li.style.setProperty('--rot', pos.rot + 'deg');
      li.setAttribute('data-side', pos.side);

      const wrap = document.createElement('div');
      wrap.className = 'plate-float-wrap';

      const btn = document.createElement('button');
      btn.className = 'plate';
      btn.type = 'button';

      const tagEl = document.createElement('span');
      tagEl.className = 'plate-tag';

      const slashEl = document.createElement('span');
      slashEl.className = 'plate-tag-slash';
      slashEl.textContent = '/';

      tagEl.appendChild(slashEl);
      tagEl.appendChild(document.createTextNode(tag.replace('/', '')));
      btn.appendChild(tagEl);

      wrap.appendChild(btn);
      li.appendChild(wrap);
      plateList.appendChild(li);
    });
  }
})();
    `;

    doc.body.appendChild(injectionScript);

    return () => {
      injectionScript.remove();
    };
  }, [frameRef]);
}
