import { app } from "electron";
import { PrismaClient } from "@prisma/client";
import * as path from "path";
import * as fs from "fs";

const SESSION_PROJECT_NAME = "shakudo-session"; // temporary, until when we add project selection functinality

export let prisma: PrismaClient;
// The active project's id. -1 means no project is open.
export let crucibleProjectID = -1;

export async function initCrucibleDb(): Promise<void> {
	const userDir = path.join(app.getPath("userData"), "crucible");
	fs.mkdirSync(userDir, { recursive: true });

	// get the users database file on disk
	const dbPath = path.join(userDir, "crucible.db");
	if (!fs.existsSync(dbPath)) {
		// if it does not exist yet, copy over a fresh db file
		fs.copyFileSync(path.join(app.getAppPath(), "prisma", "template.db"), dbPath);
	}

	prisma = new PrismaClient({
		datasources: { db: { url: "file:" + dbPath.replace(/\\/g, "/") } },
	});
	console.log("[crucible] db:", dbPath);

	/*
		Each project has the following file structure:

		<projects root>/<name>/
			crucible.als  -- this is the plain Alloy that is read by Crucible for running tests
			tests/        -- test files for crucible
	*/
	// Temporary: auto-create and open one project. Remove when we add project selection functinality
	const projectPath = path.join(userDir, "session");
	const project = await prisma.project.upsert({
		where: { name: SESSION_PROJECT_NAME },
		create: { name: SESSION_PROJECT_NAME, projectPath, alloyFile: path.join(projectPath, "crucible.als") },
		update: {},
	});
	await setActiveProject(project.id);
}

// Makes a project the active one. Every handler reads crucibleProjectID, so this is the only switch.
export async function setActiveProject(id: number): Promise<void> {
	const project = await prisma.project.findFirst({ where: { id } });
	if (!project) throw new Error(`Project ${id} not found`);

	fs.mkdirSync(path.join(project.projectPath, "tests"), { recursive: true });
	await prisma.project.update({
		where: { id },
		data: { alloyFile: path.join(project.projectPath, "crucible.als"), lastOpened: new Date() },
	});

	crucibleProjectID = id;
	console.log("[crucible] active project:", id);
}

export function clearActiveProject(): void {
	crucibleProjectID = -1;
}

// Every project gets its own folder under here, named after the project
const projectsRoot = () => path.join(app.getPath("userData"), "crucible", "projects");

// Same character set Crucible allows for test names, since the name becomes a folder name
const validProjectName = /^[-\w^&'@{}[\],$=!#().%+~ ]+$/;

export type CreateProjectResult =
	| { success: true; projectID: number }
	| { success: false; field: "name" | "sourcePath"; message: string };

// Creates the project row and folder. Structure import happens on first open.
export async function createProject(name: string, sourcePath: string): Promise<CreateProjectResult> {
	name = name.trim();
	if (!name) return { success: false, field: "name", message: "Name is required." };
	if (!validProjectName.test(name)) return { success: false, field: "name", message: "Name has invalid characters." };
	if (await prisma.project.findFirst({ where: { name } })) {
		return { success: false, field: "name", message: "A project with that name already exists." };
	}
	if (!sourcePath.endsWith(".als") || !fs.existsSync(sourcePath)) {
		return { success: false, field: "sourcePath", message: "Pick an existing .als file." };
	}

	const projectPath = path.join(projectsRoot(), name);
	fs.mkdirSync(path.join(projectPath, "tests"), { recursive: true });
	const project = await prisma.project.create({
		data: { name, projectPath, sourcePath, alloyFile: path.join(projectPath, "crucible.als") },
	});
	return { success: true, projectID: project.id };
}

// File > Open: reuse the project that already uses this .als, or make one named after the file
export async function projectForFile(sourcePath: string): Promise<number> {
	const existing = await prisma.project.findFirst({ where: { sourcePath } });
	if (existing) return existing.id;

	const base = path.basename(sourcePath, ".als").replace(/[^-\w^&'@{}[\],$=!#().%+~ ]/g, "-").trim() || "Untitled";
	for (let n = 1; ; n++) {
		const result = await createProject(n === 1 ? base : `${base} ${n}`, sourcePath);
		if (result.success) return result.projectID;
		if (result.field === "sourcePath") throw new Error(result.message);
	}
}

// Deletes the project row and its folder. The user's original .als (sourcePath) is never touched.
export async function deleteProject(id: number): Promise<void> {
	const project = await prisma.project.findFirst({ where: { id } });
	if (!project) return;

	await prisma.$transaction([
		// Relation has no cascade to AtomSource, so it goes first (same as replaceStructure)
		prisma.relation.deleteMany({ where: { projectID: id } }),
		prisma.project.delete({ where: { id } }),
	]);

	// Only remove folders we created
	if (path.dirname(project.projectPath) === projectsRoot()) {
		fs.rmSync(project.projectPath, { recursive: true, force: true });
	}
	if (crucibleProjectID === id) clearActiveProject();
}