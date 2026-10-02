import { useEffect, useRef } from "react";
import "./ProjectModal.css";

export type Project = {
  id: string;
  title: string;
  tagline: string;
  description: string;
  image: string;
  techStack: string[];
  tags: string[];
  links: { github?: string; demo?: string; flora?: string };
  year: number;
};

type ProjectModalProps = {
  project: Project | null;
  onClose: () => void;
};

export function ProjectModal({ project, onClose }: ProjectModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!project) return;
    const handleEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", handleEsc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = "";
    };
  }, [project, onClose]);

  if (!project) return null;

  return (
    <div
      ref={backdropRef}
      className="project-modal-backdrop"
      onClick={(e) => e.target === backdropRef.current && onClose()}
    >
      <div className="project-modal">
        <button className="modal-close" onClick={onClose} aria-label="Close modal">
          ×
        </button>

        <div className="modal-hero">
          <img src={project.image} alt={project.title} />
        </div>

        <div className="modal-content">
          <div className="modal-header">
            <h2>{project.title}</h2>
            <p className="modal-tagline">{project.tagline}</p>
          </div>

          <div className="modal-body">
            <p className="modal-description">{project.description}</p>

            <div className="modal-section">
              <h3>Tech Stack</h3>
              <div className="tech-stack">
                {project.techStack.map((tech) => (
                  <span key={tech} className="tech-badge">{tech}</span>
                ))}
              </div>
            </div>

            {(project.links.github || project.links.demo) && (
              <div className="modal-section modal-links">
                {project.links.github && (
                  <a href={project.links.github} target="_blank" rel="noopener noreferrer" className="modal-link">
                    View on GitHub →
                  </a>
                )}
                {project.links.demo && (
                  <a href={project.links.demo} target="_blank" rel="noopener noreferrer" className="modal-link">
                    Live Demo →
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
