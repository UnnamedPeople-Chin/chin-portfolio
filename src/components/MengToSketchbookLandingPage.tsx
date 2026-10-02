import { useRef } from "react";
import { splitTypographyProps, usePageTypography, type PageTypographyProps } from "./pageTypography";
import { LandingPageFrame, type LandingPageProps } from "./LandingPageFrame";
import { MENG_TO_SKETCHBOOK_TYPOGRAPHY } from "./pageRecipes";
import { ProjectModal } from "./ProjectModal";
import { useProjectModal } from "../hooks/useProjectModal";
import { useProjectInjection } from "../hooks/useProjectInjection";

export function MengToSketchbookLandingPage(props: LandingPageProps & PageTypographyProps) {
  const [type, frame] = splitTypographyProps(props);
  const customization = usePageTypography(MENG_TO_SKETCHBOOK_TYPOGRAPHY, type);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const { selectedProject, closeModal } = useProjectModal(frameRef);

  useProjectInjection(frameRef);

  return (
    <>
      <LandingPageFrame
        {...frame}
        customization={customization}
        title="Chin Portfolio · Jizdan YR"
        sourceUrl="/landing-pages/chin-portfolio.html"
        applyScene={(iframe) => {
          if (frameRef.current !== iframe) {
            (frameRef as any).current = iframe;
          }
        }}
      />
      <ProjectModal project={selectedProject} onClose={closeModal} />
    </>
  );
}
