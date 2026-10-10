import { ipcMain, BrowserWindow } from "electron";
import * as path from "path";
import * as fs from "fs";
import { prisma, crucibleProjectID, crucibleAlloyPath } from "./crucibleDb";
import { postJson } from "./crucibleAPI";

const short = (label: string) => label.split("/")[1] ?? label;
const nick = (s: string) => s.replace(/ /g, "");

async function buildTestCommand(projectID: number, testID: number) {
	const test = await prisma.test.findFirst({
		where: { id: testID },
		include: {
			atoms: { include: { srcAtom: true } },
			connections: { include: { connLabel: true } },
		},
	});
	const project = await prisma.project.findFirst({
		where: { id: projectID },
		include: { atoms: true, relations: true },
	});
	if (!test || !project) return null;
	if (test.atoms.length === 0) return { error: "The test has no atoms." };

	const atomTypes = Array.from(new Set(test.atoms.map((a) => a.srcAtom.label)));
    const connTypes = Array.from(new Set(test.connections.map((c) => c.label)));

	let cmd = "";
	const counts: number[] = [];
	for (const type of atomTypes) {
		const atoms = test.atoms.filter((a) => a.srcAtom.label === type);
		counts.push(atoms.length);
		cmd += `some disj ${atoms.map((a) => nick(a.nickname)).join(", ")}: ${short(type)} {`;
	}

	// Each set equals exactly these atoms
	const clauses: string[] = atomTypes.map((type) => {
		const atoms = test.atoms.filter((a) => a.srcAtom.label === type);
		return `${short(type)}=${atoms.map((a) => nick(a.nickname)).join("+")}`;
	});

	// Each relation equals exactly these connections. Order 2 rows are the second
	// half of an arity-3 pair and are already covered by the order 1 row.
	for (const label of connTypes) {
		const conns = test.connections.filter((c) => c.label === label && c.order !== 2);
		const tuples = conns.map((c) =>
			c.connLabel.arityCount > 2
				? c.order === 1 ? `${nick(c.fromNick)}->${nick(c.toNick)}->${nick(c.finalNick ?? "")}` : null
				: `${nick(c.fromNick)}->${nick(c.toNick)}`
		).filter((t): t is string => t !== null);
		clauses.push(tuples.length ? `${label}=${tuples.join("+")}` : `no ${label}`);
	}

	// Anything the test doesn't use must be empty
	for (const a of project.atoms) {
		if (!atomTypes.includes(a.label) && !a.isAbstract) clauses.push(`no ${short(a.label)}`);
	}
	for (const r of project.relations) {
		if (!connTypes.includes(r.label)) clauses.push(`no ${r.label}`);
	}

	// Predicates the user set to valid or invalid
	const preds = await prisma.predInstance.findMany({
		where: { testID, NOT: { state: null } },
		include: { params: true, predicate: { include: { params: true } } },
	});
	for (const p of preds) {
		const args = p.params.map((pp) => {
			const atom = test.atoms.find((a) => a.id === pp.atom);
			return atom ? atom.nickname : null;
		});
		if (args.some((a) => a === null)) {
			return { error: `Predicate "${p.predicate.name}" has an unselected parameter.` };
		}
		const call = p.predicate.params.length > 0 ? `${p.predicate.name}[${args.join(",")}]` : p.predicate.name;
		clauses.push(p.state ? call : `not ${call}`);
	}

	cmd += clauses.join(" and ") + "}".repeat(atomTypes.length);

	return {
		cmd,
		alloyFile: project.alloyFile,
		scope: Math.max(...counts).toString(),
		maxSeq: counts.reduce((a, b) => a + b, 0).toString(),
	};
}

// Crucible Inter process communication handlers
export function registerCrucibleHandlers(getWin: () => BrowserWindow | null) {
	const send = (channel: string, ...args: any[]) =>
		getWin()?.webContents.send(channel, ...args);

	const canvasInclude = {
		atoms: {
			include: {
				srcAtom: {
					include: {
						fromRelations: { include: { fromAtom: { include: { isChildOf: true } }, toAtom: true } },
						toRelations: true,
						isChildOf: true,
					},
				},
				connsFrom: true,
				connsTo: true,
			},
		},
		connections: { include: { to: true, from: true, connLabel: true } },
	};

    ipcMain.handle("crucible:get-open-project", async () => crucibleProjectID);


	ipcMain.handle("crucible:read-test", async (_e, testID: number) =>
		prisma.test.findFirst({ where: { id: testID }, include: canvasInclude })
	);

	ipcMain.handle("crucible:test-can-add-atom", async (_e, { testID, sourceAtomID }) => {
		const src = await prisma.atomSource.findFirst({ where: { id: sourceAtomID } });
		if (!src) return { success: false, error: "Atom source not found" };
		if (src.isLone || src.isOne) {
			const existing = await prisma.atom.findFirst({ where: { testID, srcID: sourceAtomID } });
			if (existing) return { success: false };
		}
		return { success: true };
	});

	ipcMain.handle("crucible:test-add-atom", async (_e, { testID, sourceAtomID, top, left }) => {
		const test = await prisma.test.findFirst({ where: { id: testID } });
		const src = await prisma.atomSource.findFirst({ where: { id: sourceAtomID } });
		if (!test || !src) return;
		await prisma.atom.create({
			data: {
				testID, srcID: sourceAtomID, top, left,
				nickname: `${src.label.split("/")[1]}${test.atomCount}`,
			},
		});
		await prisma.test.update({ where: { id: testID }, data: { atomCount: { increment: 1 } } });
		send("crucible:canvas-update");
	});

	ipcMain.handle("crucible:update-atom", async (_e, { atomID, left, top }) => {
		await prisma.atom.update({ where: { id: atomID }, data: { left, top } });
		send("crucible:canvas-update");
	});

	ipcMain.handle("crucible:delete-atom", async (_e, atomID: number) => {
		await prisma.atom.delete({ where: { id: atomID } }); // connections cascade
		send("crucible:canvas-update");
		return { success: true, error: null };
	});

	ipcMain.handle("crucible:get-predicates", async (_e, testID: number) =>
		prisma.predInstance.findMany({
			where: { testID },
			include: { params: { include: { param: true } }, predicate: true },
		})
	);

	ipcMain.handle("crucible:update-pred-state", async (_e, { predicateID, state }) => {
		await prisma.predInstance.update({ where: { id: predicateID }, data: { state } });
		send("crucible:predicates-update");
	});

	ipcMain.handle("crucible:update-pred-param", async (_e, { predParamID, atomID }) => {
		await prisma.predInstanceParams.update({ where: { id: predParamID }, data: { atom: atomID } });
		send("crucible:predicates-update");
	});

	ipcMain.handle("crucible:get-atom-sources", async (_event, projectID: number) => {
		return prisma.atomSource.findMany({
			where: { projectID },
			include: { fromRelations: true, isChildOf: true },
		});
	});

	ipcMain.handle("crucible:get-tests", async (_e, projectID: number) =>
		prisma.test.findMany({ where: { projectID } })
	);

	ipcMain.handle("crucible:create-test", async (_e, { projectID, testName }) => {
		const exists = await prisma.test.findFirst({ where: { projectID, name: testName } });
		if (exists) {
			return { success: false, error: [{ path: ["testName"], message: "A test with that name already exists" }] };
		}
		const project = await prisma.project.findFirst({ where: { id: projectID } });
		if (!project) return { success: false, error: "Could not create test." };

		const testFile = path.join(project.projectPath, "tests", `${testName}.txt`);
		fs.writeFileSync(testFile, "Placeholder file...");
		const test = await prisma.test.create({ data: { name: testName, projectID, testFile } });

		// One predicate instance per project predicate, with its parameter slots
		const preds = await prisma.predicate.findMany({ where: { projectID }, include: { params: true } });
		for (const pred of preds) {
			const inst = await prisma.predInstance.create({ data: { predID: pred.id, testID: test.id, state: null } });
			for (const param of pred.params) {
				await prisma.predInstanceParams.create({ data: { predInstID: inst.id, predParamID: param.id } });
			}
		}
		return { success: true, error: null, test };
	});

	ipcMain.handle("crucible:open-test", async (_e, { testID, projectID }) => {
		const test = await prisma.test.update({ where: { id: testID }, data: { tabIsOpen: true } });
		await prisma.project.update({ where: { id: projectID }, data: { activeTab: test.name } });
		send("crucible:tabs-update");
		return { success: true };
	});

	ipcMain.handle("crucible:close-test", async (_e, { testID, projectID }) => {
		await prisma.test.update({ where: { id: testID }, data: { tabIsOpen: false } });
		const stillOpen = await prisma.test.findFirst({ where: { projectID, tabIsOpen: true } });
		await prisma.project.update({ where: { id: projectID }, data: { activeTab: stillOpen ? stillOpen.name : "" } });
		send("crucible:tabs-update");
		return { success: true };
	});

	ipcMain.handle("crucible:get-active-test", async (_e, projectID: number) => {
		const project = await prisma.project.findFirst({ where: { id: projectID } });
		return project?.activeTab ?? "";
	});

	ipcMain.handle("crucible:set-active-test", async (_e, { projectID, testName }) => {
		await prisma.project.update({ where: { id: projectID }, data: { activeTab: testName } });
		send("crucible:tabs-update");
	});

	ipcMain.handle("crucible:get-relations-to-atom", async (_e, { label, projectID }) =>
		prisma.relation.findMany({ where: { toLabel: label, projectID } })
	);

	ipcMain.handle("crucible:get-atom-parents", async (_e, srcAtomID: number) => {
		const src = await prisma.atomSource.findFirst({
			where: { id: srcAtomID },
			include: { isChildOf: true },
		});
		return src ? src.isChildOf.map((p) => p.parentLabel) : [];
	});

	ipcMain.handle("crucible:get-atom-children", async (_e, { label, projectID }) => {
		const src = await prisma.atomSource.findFirst({
			where: { label, projectID },
			include: { isParentOf: true },
		});
		return src ? src.isParentOf.map((c) => c.childLabel) : [];
	});

	// Used for plain (arity 2) connections, with an optional dependency
	ipcMain.handle("crucible:create-connection", async (_e, args) => {
		const { projectID, testID, fromAtom, toAtom, relation, dependency } = args;

		const mult = relation.multiplicity.split(" ")[0];
		if (mult === "lone" || mult === "one") {
			const existing = await prisma.connection.findFirst({
				where: { label: relation.label, fromLabel: relation.fromLabel, fromID: fromAtom.id, testID },
			});
			if (existing) return { success: false };
		}

		const connection = await prisma.connection.create({
			data: {
				fromID: fromAtom.id,
				toID: toAtom.id,
				fromNick: fromAtom.nickname,
				toNick: toAtom.nickname,
				fromLabel: relation.fromLabel,
				toLabel: relation.toLabel,
				label: relation.label,
				projectID,
				testID: fromAtom.testID,
				...(dependency ? { dependID: dependency } : {}),
			},
		});

		send("crucible:canvas-update");
		return { success: !!connection };
	});

	// Arity 3: two linked rows (order 1 and 2)
	ipcMain.handle("crucible:create-high-connection", async (_e, args) => {
		const { projectID, testID, atomOneID, atomTwoID, atomThreeID, relation } = args;

		const mult = relation.multiplicity.split(" ")[0];
		if (mult === "lone" || mult === "one") {
			const existing = await prisma.connection.findMany({
				where: { label: relation.label, fromID: atomOneID, testID },
			});
			if (existing.length > relation.arityCount - 1) return { success: false };
		}

		const [one, two, three] = await Promise.all(
			[atomOneID, atomTwoID, atomThreeID].map((id) =>
				prisma.atom.findFirst({ where: { id, testID } })
			)
		);
		if (!one || !two || !three) return { success: false };

		const base = {
			fromLabel: relation.fromLabel, toLabel: relation.toLabel,
			label: relation.label, projectID, testID, fromID: one.id, fromNick: one.nickname,
		};

		const first = await prisma.connection.create({
			data: { ...base, toID: two.id, toNick: two.nickname, finalNick: three.nickname, order: 1 },
		});
		const second = await prisma.connection.create({
			data: { ...base, toID: three.id, toNick: three.nickname, dependID: first.id, order: 2 },
		});
		await prisma.connection.update({ where: { id: first.id }, data: { dependID: second.id } });

		send("crucible:canvas-update");
		return { success: true };
	});

	ipcMain.handle("crucible:delete-connection", async (_e, atomID: number) => {
		await prisma.connection.deleteMany({
			where: { OR: [{ toID: atomID }, { fromID: atomID }, { dependID: atomID }] },
		});
		send("crucible:canvas-update");
		return { success: true, error: null };
	});

	ipcMain.handle("crucible:connection-enabled", async (_e, { atomID, relationDependsOn }) => {
		const conns = await prisma.connection.findMany({
			where: { fromID: atomID },
			include: { connLabel: true },
		});
		return conns.some((c) => c.connLabel.type === relationDependsOn);
	});

    // Receives the editor's current .als text and writes it where the project points
    ipcMain.handle("crucible:sync-als", async (_e, text: string) => {
        fs.mkdirSync(path.dirname(crucibleAlloyPath()), { recursive: true });
        fs.writeFileSync(crucibleAlloyPath(), text);
    });

    ipcMain.handle("crucible:run-test", async (_e, { projectID, testID }) => {
        try {
            const built = await buildTestCommand(projectID, testID);
            if (!built || "error" in built) {
                console.log("[crucible] run-test:", built ? built.error : "test not found");
                return "Error";
            }
            console.log("[crucible] command:", built.cmd);

            const resp = await postJson("/tests", {
                path: built.alloyFile,
                command: built.cmd,
                scope: built.scope,
                maxSeq: built.maxSeq,
            });
            if (resp.status >= 400) {
                console.error("[crucible] API error:", resp.status, resp.text);
                return "Error";
            }
            return resp.text.includes("Unsatisfiable") ? "Fail" : "Pass";
        } catch (e) {
            console.error("[crucible] run-test failed:", e);
            return "Error";
        }
    });
}