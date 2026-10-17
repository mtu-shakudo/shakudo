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