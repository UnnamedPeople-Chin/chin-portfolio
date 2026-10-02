import { useEffect, useRef, useState, type CSSProperties } from "react";

import {
  applyPageCustomization,
  postPageCustomization,
  type LandingPageCustomization,
} from "./pageTypography";

export type LandingPageFrameProps = {
  backgroundCanvasSelector?: string;
  backgroundVisualSelector?: string;
  className?: string;
  sourceUrl: string;
  srcDoc?: string;
  style?: CSSProperties;
  title: string;
  customization?: LandingPageCustomization;
  applyScene?: (frame: HTMLIFrameElement) => void;
};

export type LandingPageProps = Omit<
  LandingPageFrameProps,
  "sourceUrl" | "title" | "customization" | "backgroundCanvasSelector" | "backgroundVisualSelector"
>;

const URL_FRAME_SANDBOX = "allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts";
const SRCDOC_FRAME_SANDBOX = "allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts";

const BACKGROUND_PRESENTATION_STYLE_ID = "threeui-background-presentation";

export function applyBackgroundPresentation(
  frame: HTMLIFrameElement | null,
  backgroundCanvasSelector?: string,
  backgroundVisualSelector?: string,
) {
  const document = frame?.contentDocument;
  if (!document) return;

  document.getElementById(BACKGROUND_PRESENTATION_STYLE_ID)?.remove();
  document.querySelectorAll("[data-threeui-background-layer]").forEach((element) => {
    element.removeAttribute("data-threeui-background-layer");
    element.removeAttribute("data-threeui-background-fill");
  });

  if (!backgroundCanvasSelector) {
    document.documentElement.removeAttribute("data-threeui-presentation");
    return;
  }

  const canvas = document.querySelector<HTMLElement>(backgroundCanvasSelector);
  if (!canvas) return;

  canvas.setAttribute("data-threeui-background-layer", "");
  canvas.setAttribute("data-threeui-background-fill", "");
  if (backgroundVisualSelector) {
    document.querySelectorAll<HTMLElement>(backgroundVisualSelector).forEach((element) => {
      element.setAttribute("data-threeui-background-layer", "");
    });
  }

  document.documentElement.setAttribute("data-threeui-presentation", "background");
  const presentationStyle = document.createElement("style");
  presentationStyle.id = BACKGROUND_PRESENTATION_STYLE_ID;
  presentationStyle.textContent = `
    html[data-threeui-presentation="background"],
    html[data-threeui-presentation="background"] body {
      width: 100% !important;
      height: 100% !important;
      min-height: 100% !important;
      overflow: hidden !important;
    }
    html[data-threeui-presentation="background"] body * {
      visibility: hidden !important;
      pointer-events: none !important;
    }
    html[data-threeui-presentation="background"] [data-threeui-background-layer],
    html[data-threeui-presentation="background"] [data-threeui-background-layer] * {
      visibility: visible !important;
    }
    html[data-threeui-presentation="background"] [data-threeui-background-fill] {
      position: fixed !important;
      inset: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      transform: none !important;
    }
  `;
  document.head.appendChild(presentationStyle);

  frame.contentWindow?.requestAnimationFrame(() => {
    frame.contentWindow?.dispatchEvent(new Event("resize"));
  });
}

export function LandingPageFrame({
  applyScene,
  backgroundCanvasSelector,
  backgroundVisualSelector,
  className = "",
  customization,
  sourceUrl,
  srcDoc,
  style,
  title,
}: LandingPageFrameProps) {
  const [ready, setReady] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    applyPageCustomization(frameRef.current, customization);
    postPageCustomization(frameRef.current, customization);
    applyBackgroundPresentation(frameRef.current, backgroundCanvasSelector, backgroundVisualSelector);
    if (frameRef.current) applyScene?.(frameRef.current);
  }, [applyScene, backgroundCanvasSelector, backgroundVisualSelector, customization]);

  return (
    <div
      className={`threeui-background landing-page-frame${className ? ` ${className}` : ""}`}
      data-state={ready ? "ready" : "loading"}
      style={{ position: "relative", overflow: "hidden", background: "#ece7dc", pointerEvents: "auto", ...style }}
    >
      <iframe
        ref={frameRef}
        title={title}
        {...(srcDoc ? { srcDoc } : { src: sourceUrl })}
        sandbox={srcDoc ? SRCDOC_FRAME_SANDBOX : URL_FRAME_SANDBOX}
        loading="eager"
        onLoad={(event) => {
          applyPageCustomization(event.currentTarget, customization);
          postPageCustomization(event.currentTarget, customization);
          applyBackgroundPresentation(event.currentTarget, backgroundCanvasSelector, backgroundVisualSelector);
          applyScene?.(event.currentTarget);
          setReady(true);
        }}
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          width: "100%",
          height: "100%",
          border: 0,
          background: "#ece7dc",
          opacity: backgroundCanvasSelector && !ready ? 0 : 1,
          pointerEvents: backgroundCanvasSelector && !ready ? "none" : "auto",
        }}
      />
    </div>
  );
}
