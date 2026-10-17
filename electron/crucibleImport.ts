import * as crypto from "crypto";
import { postJson } from "./crucibleAPI";
import { prisma } from "./crucibleDb";

// matches the spring boot server's atom object
interface ApiAtom {
	label: string;
	isEnum: boolean | null; isLone: boolean | null; isOne: boolean | null;
	isSome: boolean | null; isAbstract: boolean | null;
	relations: { label: string; multiplicity: string; type: string }[];
}

// matches the spring boot server's function object
interface ApiFunc { label: string; parameters: { label: string; paramType: string }[] }

// matches the spring boot server's \files endpoint POST return JSON
export interface Structure { atoms: ApiAtom[]; functions: ApiFunc[] }

const COLORS = [
	"#FFA94D", "#FFD43B", "#A9E34B", "#69DB7C", "#38D9A9", "#3BC9DB",
	"#4DABF7", "#748FFC", "#9775FA", "#DA77F2", "#F783AC", "#FF8787",
];

// Returns null for anything that isn't a predicate
const predName = (label: string): string | null => {
	if (!label.startsWith("pred ")) return null;
	return label.slice(5).replace(/^this\//, "");
};

// Ask the aSketch-API.jar to parse the .als file
export async function fetchStructure(alsPath: string): Promise<{ data: Structure; hash: string }> {
	const filePath = process.platform === "win32" ? alsPath.split("\\") : alsPath.split("/");
	const resp = await postJson("/files", { filePath, operatingSystem: process.platform });
	if (resp.status >= 400) throw new Error(`/files failed (${resp.status}): ${resp.text}`);
	const data: Structure = JSON.parse(resp.text);

	/* 
	   Get the normalized hash of the Alloy file so we can detect if the file was changed outside of Shakudo 
	   
	   The /files endpoint returns the parsed .als file in the form of the Structure interface (atoms and functions).
	   We need to come up with what it means for the file to be altered in a way that could be undesireable for
	   Shakudo. If the Alloy file is found to be changed in an undesirable way, we can simply just re-import the file
	   for parsing, and clear our databases assumptions of the file ( replaceStructure() ). 
	   
	   The Alloy file is said to be "desirably changed" if its changes are limited to the following:
	   		1. Re-ordering of signatures or functions that the database already knows about (i.e. the parsed data comes back
	           in a different order, but it's all still the same data)
			2. The path to the Alloy file is different (i.e. it was simply moved somewhere else)
			3. A function/predicate's internal code changed, but its parameters and return type are still the same
			4. White space/comments were added/removed (still need to look at if changing shakudo comments breaks things once 
			   we add shakudo stuff to the db)

		Thus we must normalize the returned JSON from a POST to /files to let changes of type 1 not result in different
		hash values. The normalized version is the list of atoms sorted alphabetically by name, followed by the list of 
		functions sorted in the same way. Note that the atoms relations are also sorted in the same way per atom.
	*/
	const normalized = {
		atoms: data.atoms
			.map((a) => ({
				label: a.label,
				relations: a.relations
					.map((r) => ({ label: r.label, multiplicity: r.multiplicity, type: r.type }))
					.sort((x, y) => x.label.localeCompare(y.label)),
			}))
			.sort((x, y) => x.label.localeCompare(y.label)),
		preds: data.functions
			.map((f) => ({ name: predName(f.label), params: f.parameters }))
			.filter((f) => f.name !== null)
			.sort((x, y) => (x.name as string).localeCompare(y.name as string)),
	};
	const hash = crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
	return { data, hash };
}

// Delete everything derived from the .als, then insert the new structure.
// The Project row is kept.
export async function replaceStructure(projectID: number, data: Structure, hash: string): Promise<void> {
	await prisma.$transaction(async (tx) => {
		// Order matters: Relation has no cascade to AtomSource, so it goes first.
		await tx.test.deleteMany({ where: { projectID } });          // cascades atoms, connections, predicate instances
		await tx.predicate.deleteMany({ where: { projectID } });     // cascades params
		await tx.relation.deleteMany({ where: { projectID } });
		await tx.atomInheritance.deleteMany({ where: { projectID } });
		await tx.atomSource.deleteMany({ where: { projectID } });
		await tx.shakPredicate.deleteMany({ where: { projectID } });

		// Atom sources first, since relations point at them
		let i = 0;
		for (const a of data.atoms) {
			await tx.atomSource.create({
				data: {
					projectID, label: a.label, color: COLORS[i++ % COLORS.length],
					isEnum: !!a.isEnum, isLone: !!a.isLone, isOne: !!a.isOne,
					isSome: !!a.isSome, isAbstract: !!a.isAbstract,
				},
			});
		}

		const seen = new Set<string>();
		for (const a of data.atoms) {
			for (const r of a.relations) {
				if (seen.has(r.label)) continue;
				seen.add(r.label);
				const parts = r.type.split("->");
				const toLabel = parts[parts.length - 1].split("}")[0];
				await tx.relation.create({
					data: {
						projectID, label: r.label, multiplicity: r.multiplicity, type: r.type,
						fromLabel: a.label, toLabel, arityCount: parts.length,
						dependsOn: parts.length > 2 ? parts.slice(0, -1).join("->") + "}" : null,
					},
				});
			}
		}

		for (const f of data.functions) {
			const name = predName(f.label);
			if (name === null) continue;
			const pred = await tx.predicate.create({ data: { projectID, name } });
			for (const p of f.parameters) {
				await tx.predParam.create({
					data: { predID: pred.id, label: p.label, paramType: p.paramType },
				});
			}
		}

		await tx.project.update({ where: { id: projectID }, data: { structureHash: hash } });
	});
}

export type SyncResult = "imported" | "unchanged" | "cancelled";

// Import on first open, do nothing if the structure matches, confirm before wiping if it differs.
export async function syncProjectStructure(
	projectID: number,
	alsPath: string,
	confirmWipe: () => Promise<boolean>
): Promise<SyncResult> {
	const { data, hash } = await fetchStructure(alsPath);
	const project = await prisma.project.findFirst({ where: { id: projectID } });
	if (!project) throw new Error("Project not found");

	// does the returned hash match what is in the database?
	if (project.structureHash === hash) return "unchanged"; // yes
	if (project.structureHash !== null && !(await confirmWipe())) return "cancelled"; // actually, nevermind

	await replaceStructure(projectID, data, hash); // no
	return "imported";
}