import type { Project } from "@prisma/client";

// A row from crucible:list-projects
export type ProjectRow = Project & { _count: { tests: number } };

export const fileName = (filePath: string | null) => (filePath ? filePath.split(/[\\/]/).pop() : "no file");
