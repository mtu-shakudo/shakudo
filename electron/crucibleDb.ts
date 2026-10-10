import { app } from "electron";
import { PrismaClient } from "@prisma/client";
import * as path from "path";
import * as fs from "fs";

/* 
	THIS API CURRENTLY HARDCODED TO WORK WITH "kittehLab.als" FOUND IN THE "examples" FOLDER

	Once the backend parses the .als file into Atoms, Predicates, etc., then we can remove the
	hardcoded data in "seedCrucibleDb"
*/

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
	console.log("[crucible] db:", dbPath, "| project id:", crucibleProjectID);

	await seedCrucibleDb(crucibleProjectID);
}

export async function setAlloyFile(alloyFile: string): Promise<void> {
	if (crucibleProjectID === -1) return;
	await prisma.project.update({
		where: { id: crucibleProjectID },
		data: { alloyFile },
	});
}

async function seedCrucibleDb(projectID: number): Promise<void> {
	// Only seed an empty project
	if ((await prisma.atomSource.count({ where: { projectID } })) > 0) return;

	await prisma.atomSource.create({
		data: { projectID, label: "this/Kitteh", color: "#4DABF7" },
	});
	await prisma.atomSource.create({
		data: { projectID, label: "this/Imposter", color: "#69DB7C" },
	});

	await prisma.relation.create({
		data: {
			projectID, label: "love", multiplicity: "set Kitteh",
			type: "{this/Kitteh->this/Kitteh}",
			fromLabel: "this/Kitteh", toLabel: "this/Kitteh", arityCount: 2,
		},
	});

	const preds: { name: string; params: string[] }[] = [
		{ name: "inLoveWith", params: ["k1", "k2"] },
		{ name: "selfLove", params: ["k"] },
		{ name: "onlyLoverOf", params: ["k1", "k2"] },
		{ name: "onlyBelovedOf", params: ["k1", "k2"] },
		{ name: "loveStory", params: [] },
		{ name: "rivals", params: [] },
		{ name: "narcissists", params: [] },
		{ name: "sociopath", params: [] },
		{ name: "rockstars", params: [] },
		{ name: "oneLove", params: [] },
		{ name: "allSociopaths", params: [] },
		{ name: "myBaby", params: [] },
		{ name: "realMyBaby", params: [] },
		{ name: "kittehLove", params: [] },
	];

	for (const p of preds) {
		const pred = await prisma.predicate.create({ data: { projectID, name: p.name } });
		for (const label of p.params) {
			await prisma.predParam.create({
				data: { predID: pred.id, label, paramType: "this/Kitteh" },
			});
		}
	}

	console.log("[crucible] seeded sample data");
}