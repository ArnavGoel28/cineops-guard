"use client";
import React, { createContext, useContext, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listProductions, createProduction, Production } from "@/lib/api";

type ProjectContextType = {
  productions: Production[];
  activeProjectId: string;
  activeProject: Production | null;
  setActiveProjectId: (id: string) => void;
  isLoading: boolean;
  createProjectModalOpen: boolean;
  setCreateProjectModalOpen: (open: boolean) => void;
  createProject: (name: string) => Promise<void>;
  isCreating: boolean;
};

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = "cineops_active_production_id";

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [activeProjectId, setActiveProjectIdState] = useState<string>("");
  const [createProjectModalOpen, setCreateProjectModalOpen] = useState<boolean>(false);

  const { data: productions = [], isLoading } = useQuery({
    queryKey: ["productions"],
    queryFn: listProductions,
  });

  useEffect(() => {
    if (typeof window !== "undefined" && productions.length > 0) {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored && productions.some((p) => p.id === stored)) {
        setActiveProjectIdState(stored);
      } else {
        setActiveProjectIdState(productions[0].id);
      }
    }
  }, [productions]);

  const setActiveProjectId = (id: string) => {
    setActiveProjectIdState(id);
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCAL_STORAGE_KEY, id);
    }
  };

  const activeProject = productions.find((p) => p.id === activeProjectId) || productions[0] || null;

  const createMut = useMutation({
    mutationFn: (name: string) => createProduction(name),
    onSuccess: (newProd) => {
      qc.invalidateQueries({ queryKey: ["productions"] });
      setActiveProjectId(newProd.id);
      setCreateProjectModalOpen(false);
    },
  });

  const createProject = async (name: string) => {
    await createMut.mutateAsync(name);
  };

  return (
    <ProjectContext.Provider
      value={{
        productions,
        activeProjectId,
        activeProject,
        setActiveProjectId,
        isLoading,
        createProjectModalOpen,
        setCreateProjectModalOpen,
        createProject,
        isCreating: createMut.isPending,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProject must be used within a ProjectProvider");
  }
  return ctx;
}
