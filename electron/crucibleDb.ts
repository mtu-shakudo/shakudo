import { app } from "electron";
import { PrismaClient } from "@prisma/client";
import * as path from "path";
import * as fs from "fs";

const SESSION_PROJECT_NAME = "shakudo-session";

export let prisma: PrismaClient;
export let crucibleProjectID = -1;

export const crucibleAlloyPath = () =>
	path.join(app.getPath("userData"), "crucible", "session", "current.als");

export async function initCrucibleDb(): Promise<void> {
    let alloyFile = crucibleAlloyPath();

	const userDir = path.join(app.getPath("userData"), "crucible");
	fs.mkdirSync(userDir, { recursive: true });

	// First run: copy the migrated template into the user-data folder.
	const dbPath = path.join(userDir, "crucible.db");
	if (!fs.existsSync(dbPath)) {
		fs.copyFileSync(path.join(app.getAppPath(), "prisma", "template.db"), dbPath);
	}

	prisma = new PrismaClient({
		datasources: { db: { url: "file:" + dbPath.replace(/\\/g, "/") } },
	});

	// Crucible writes test files to <projectPath>/tests, so that folder must exist.
	const projectPath = path.join(userDir, "session");
	fs.mkdirSync(path.join(projectPath, "tests"), { recursive: true });

	// Exactly one Project row. Upsert on the unique name keeps it at one across launches.
	const project = await prisma.project.upsert({
		where: { name: SESSION_PROJECT_NAME },
		create: { name: SESSION_PROJECT_NAME, projectPath, alloyFile },
		update: alloyFile ? { alloyFile } : {},
	});

	crucibleProjectID = project.id;
	console.log("[crucible] db:", dbPath, "| project id:", project.id);
}

export async function setAlloyFile(alloyFile: string): Promise<void> {
	if (crucibleProjectID === -1) return;
	await prisma.project.update({
		where: { id: crucibleProjectID },
		data: { alloyFile },
	});
}