import { useEffect, useState } from "react";
import type { Project } from "../components/ProjectModal";
import projectsData from "../data/projects.json";

export function useProjectModal(frameRef: React.RefObject<HTMLIFrameElement>) {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame?.contentWindow) return;

    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === "PROJECT_TAG_CLICK") {
        const tag = e.data.tag as string;
        const project = projectsData.projects.find((p) =>
          p.tags.includes(tag)
        );
        if (project) setSelectedProject(project as Project);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [frameRef]);

  const closeModal = () => setSelectedProject(null);

  return { selectedProject, closeModal };
}
