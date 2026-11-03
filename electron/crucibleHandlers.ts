import { ipcMain, BrowserWindow, dialog } from "electron";
import * as path from "path";
import * as fs from "fs";
import { prisma, crucibleProjectID, createProject, deleteProject } from "./crucibleDb";
import { postJson } from "./crucibleAPI";
import type { Atom, AtomSource, Connection } from "@prisma/client";

const short = (label: string) => label.split("/")[1] ?? label;
const nick = (s: string) => s.replace(/ /g, "");

const ALLOY_KEYWORDS = new Set(
	("abstract all and as assert but check disj else exactly extends fact for fun iden iff implies in Int int let " +
		"lone module no none not one open or pred run seq set sig some sum this univ String var enum steps always " +
		"eventually after before historically once until releases since triggered").split(" ")
);

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
export function registerCrucibleHandlers(
	getWin: () => BrowserWindow | null,
	openProject: (id: number) => Promise<void>
) {
	// every window, so a popped-out tests window stays in step with the main one
	const send = (channel: string, ...args: any[]) =>
		BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, ...args));

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

	// Undo and redo per test. Every change to a test's atoms or connections first saves a copy of them;
	// undo puts the copy back with the same ids, so predicate parameters that point at atoms still match.
	type Snapshot = { atoms: Atom[]; connections: Connection[] };
	const history = new Map<number, { undo: Snapshot[]; redo: Snapshot[] }>();

	const snapshot = async (testID: number): Promise<Snapshot> => ({
		atoms: await prisma.atom.findMany({ where: { testID } }),
		connections: await prisma.connection.findMany({ where: { testID } }),
	});

	const record = async (testID: number) => {
		const h = history.get(testID) ?? { undo: [], redo: [] };
		h.undo.push(await snapshot(testID));
		if (h.undo.length > 100) h.undo.shift();
		h.redo = [];
		history.set(testID, h);
	};

	const restore = (testID: number, snap: Snapshot) =>
		prisma.$transaction([
			prisma.connection.deleteMany({ where: { testID } }),
			prisma.atom.deleteMany({ where: { testID } }),
			...snap.atoms.map((a) => prisma.atom.create({ data: a })),
			// dependID is unique and points both ways in an arity-3 pair, so link the pairs once all rows exist
			...snap.connections.map((c) => prisma.connection.create({ data: { ...c, dependID: null } })),
			...snap.connections
				.filter((c) => c.dependID !== null)
				.map((c) => prisma.connection.update({ where: { id: c.id }, data: { dependID: c.dependID } })),
		]);

	const historyState = (testID: number) => {
		const h = history.get(testID);
		return { canUndo: !!h?.undo.length, canRedo: !!h?.redo.length };
	};

	const step = async (testID: number, dir: "undo" | "redo") => {
		const h = history.get(testID);
		const from = dir === "undo" ? h?.undo : h?.redo;
		const to = dir === "undo" ? h?.redo : h?.undo;
		const snap = from?.pop();
		if (!snap || !to) return historyState(testID);
		to.push(await snapshot(testID));
		await restore(testID, snap);
		send("crucible:canvas-update");
		return historyState(testID);
	};

	ipcMain.handle("crucible:undo", async (_e, testID: number) => step(testID, "undo"));
	ipcMain.handle("crucible:redo", async (_e, testID: number) => step(testID, "redo"));
	ipcMain.handle("crucible:history-state", async (_e, testID: number) => historyState(testID));

    ipcMain.handle("crucible:get-open-project", async () => crucibleProjectID);

	ipcMain.handle("crucible:list-projects", async () =>
		prisma.project.findMany({ orderBy: { lastOpened: "desc" }, include: { _count: { select: { tests: true } } } })
	);

	ipcMain.handle("crucible:create-project", async (_e, { name, sourcePath }) => {
		const result = await createProject(name, sourcePath);
		if (result.success) send("crucible:projects-changed");
		return result;
	});

	ipcMain.handle("crucible:open-project", async (_e, id: number) => openProject(id));

	ipcMain.handle("crucible:delete-project", async (_e, id: number) => {
		await deleteProject(id);
		send("crucible:projects-changed");
	});

	// Editor state of the open project: blocks per tab, the selected tab, and Work vs Test view
	ipcMain.handle("crucible:save-workspace", async (_e, { title, xml, metaHash }) => {
		if (crucibleProjectID < 0) return;
		await prisma.shakPredicate.upsert({
			where: { projectID_title: { projectID: crucibleProjectID, title } },
			create: { projectID: crucibleProjectID, title, workspaceXml: xml, metaHash },
			update: { workspaceXml: xml, metaHash },
		});
	});

	ipcMain.handle("crucible:set-active-pred", async (_e, title: string) => {
		if (crucibleProjectID < 0) return;
		await prisma.project.update({ where: { id: crucibleProjectID }, data: { activeShakPred: title } });
	});

	ipcMain.handle("crucible:set-view", async (_e, editorOpen: boolean) => {
		if (crucibleProjectID < 0) return;
		await prisma.project.update({ where: { id: crucibleProjectID }, data: { editorOpen } });
	});

	// File picking has to happen on main to get the full path
	ipcMain.handle("crucible:select-alloy-file", async () => {
		const win = getWin();
		if (!win) return null;
		const result = await dialog.showOpenDialog(win, {
			properties: ["openFile"],
			filters: [{ name: "Alloy", extensions: ["als"] }],
		});
		return result.canceled ? null : result.filePaths[0];
	});


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
		await record(testID);
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
		const atom = await prisma.atom.findFirst({ where: { id: atomID } });
		if (!atom) return;
		await record(atom.testID);
		await prisma.atom.update({ where: { id: atomID }, data: { left, top } });
		send("crucible:canvas-update");
	});

	// Moving a selection: one undo step for all of it
	ipcMain.handle("crucible:move-atoms", async (_e, { testID, moves }: { testID: number; moves: { atomID: number; left: number; top: number }[] }) => {
		if (moves.length === 0) return;
		await record(testID);
		await prisma.$transaction(
			moves.map((m) => prisma.atom.update({ where: { id: m.atomID }, data: { left: m.left, top: m.top } }))
		);
		send("crucible:canvas-update");
	});

	ipcMain.handle("crucible:delete-atom", async (_e, atomID: number) => {
		const atom = await prisma.atom.findFirst({ where: { id: atomID } });
		if (!atom) return { success: false, error: "Atom not found" };
		await record(atom.testID);
		await prisma.atom.delete({ where: { id: atomID } }); // connections cascade
		send("crucible:canvas-update");
		return { success: true, error: null };
	});

	ipcMain.handle("crucible:delete-atoms", async (_e, { testID, atomIDs }: { testID: number; atomIDs: number[] }) => {
		if (atomIDs.length === 0) return;
		await record(testID);
		await prisma.atom.deleteMany({ where: { testID, id: { in: atomIDs } } });
		send("crucible:canvas-update");
	});

	// The name is used as-is in the Alloy command, so it has to be a plain Alloy name that nothing in the model uses.
	ipcMain.handle("crucible:rename-atom", async (_e, { atomID, nickname }: { atomID: number; nickname: string }) => {
		const name = String(nickname).trim();
		const atom = await prisma.atom.findFirst({ where: { id: atomID }, include: { test: true } });
		if (!atom) return { success: false, error: "Atom not found." };
		if (name === atom.nickname) return { success: true };
		if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
			return { success: false, error: "Use letters, digits and _, starting with a letter." };
		}
		const project = await prisma.project.findFirst({
			where: { id: atom.test.projectID },
			include: { atoms: true, relations: true, predicates: true },
		});
		const modelNames = [
			...(project?.atoms.map((a) => short(a.label)) ?? []),
			...(project?.relations.map((r) => r.label) ?? []),
			...(project?.predicates.map((p) => p.name) ?? []),
		];
		if (ALLOY_KEYWORDS.has(name)) return { success: false, error: `${name} is an Alloy keyword.` };
		if (modelNames.includes(name)) return { success: false, error: `${name} is already a name in the model.` };
		if (await prisma.atom.findFirst({ where: { testID: atom.testID, nickname: name } })) {
			return { success: false, error: `${name} is already used in this test.` };
		}

		await record(atom.testID);
		// connections keep their own copy of the names; an atom that is third in an arity-3 pair is named on the pair's first row
		const thirds = await prisma.connection.findMany({ where: { toID: atomID, order: 2 } });
		await prisma.$transaction([
			prisma.atom.update({ where: { id: atomID }, data: { nickname: name } }),
			prisma.connection.updateMany({ where: { fromID: atomID }, data: { fromNick: name } }),
			prisma.connection.updateMany({ where: { toID: atomID }, data: { toNick: name } }),
			...thirds
				.filter((c) => c.dependID !== null)
				.map((c) => prisma.connection.update({ where: { id: c.dependID as number }, data: { finalNick: name } })),
		]);
		send("crucible:canvas-update");
		return { success: true };
	});

	// Paste copied atoms, and the connections between them, `offset` down and right of where they were copied.
	// Atoms from another project, and one/lone atoms the test already has, are left out.
	ipcMain.handle("crucible:paste-atoms", async (_e, args: { testID: number; atoms: Atom[]; connections: Connection[]; offset: number }) => {
		const { testID, atoms, connections, offset } = args;
		const test = await prisma.test.findFirst({ where: { id: testID } });
		if (!test) return { ids: [], skipped: atoms.length };

		const plan: { from: Atom; src: AtomSource }[] = [];
		for (const a of atoms) {
			const src = await prisma.atomSource.findFirst({ where: { id: a.srcID } });
			if (!src || src.projectID !== test.projectID) continue;
			if (src.isLone || src.isOne) {
				const exists = (await prisma.atom.findFirst({ where: { testID, srcID: src.id } })) || plan.some((p) => p.src.id === src.id);
				if (exists) continue;
			}
			plan.push({ from: a, src });
		}
		if (plan.length === 0) return { ids: [], skipped: atoms.length };

		await record(testID);
		const made = new Map<number, Atom>();
		let count = test.atomCount;
		for (const { from, src } of plan) {
			let nickname = `${short(src.label)}${count++}`;
			while (await prisma.atom.findFirst({ where: { testID, nickname } })) nickname = `${short(src.label)}${count++}`;
			made.set(from.id, await prisma.atom.create({
				data: { testID, srcID: src.id, nickname, left: from.left + offset, top: from.top + offset },
			}));
		}
		await prisma.test.update({ where: { id: testID }, data: { atomCount: count } });

		// A connection comes along when both its ends did; an arity-3 pair only when its partner does too
		const copied = new Map(connections.map((c) => [c.id, c]));
		const bothEnds = (c: Connection) => made.has(c.fromID) && made.has(c.toID);
		const keep = connections.filter((c) => {
			if (!bothEnds(c)) return false;
			if (c.order === null) return true;
			const partner = c.dependID !== null ? copied.get(c.dependID) : undefined;
			return !!partner && bothEnds(partner);
		});
		const newConn = new Map<number, number>();
		for (const c of keep) {
			const fromAtom = made.get(c.fromID) as Atom;
			const toAtom = made.get(c.toID) as Atom;
			const third = c.order === 1 ? made.get((copied.get(c.dependID as number) as Connection).toID) : undefined;
			const row = await prisma.connection.create({
				data: {
					projectID: test.projectID, testID, order: c.order,
					fromID: fromAtom.id, toID: toAtom.id, fromNick: fromAtom.nickname, toNick: toAtom.nickname,
					fromLabel: c.fromLabel, toLabel: c.toLabel, label: c.label,
					finalNick: third ? third.nickname : null,
				},
			});
			newConn.set(c.id, row.id);
		}
		for (const c of keep) {
			if (c.dependID !== null && newConn.has(c.dependID)) {
				await prisma.connection.update({ where: { id: newConn.get(c.id) as number }, data: { dependID: newConn.get(c.dependID) } });
			}
		}

		send("crucible:canvas-update");
		return { ids: Array.from(made.values()).map((a) => a.id), skipped: atoms.length - plan.length };
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
			if (existing) return { success: false, error: "Adding that connection would exceed its multiplicity." };
		}

		// a relation is a set of tuples, so the same pair can't be in it twice
		if (!dependency) {
			const same = await prisma.connection.findFirst({
				where: { label: relation.label, fromLabel: relation.fromLabel, fromID: fromAtom.id, toID: toAtom.id, testID: fromAtom.testID },
			});
			if (same) return { success: false, error: `${fromAtom.nickname} → ${toAtom.nickname} is already in ${relation.label}.` };
		}

		await record(fromAtom.testID);
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
			if (existing.length > relation.arityCount - 1) return { success: false, error: "Adding that connection would exceed its multiplicity." };
		}

		const [one, two, three] = await Promise.all(
			[atomOneID, atomTwoID, atomThreeID].map((id) =>
				prisma.atom.findFirst({ where: { id, testID } })
			)
		);
		if (!one || !two || !three) return { success: false, error: "Atom not found." };

		// the same triple can't be in the relation twice: an order-1 row one→two whose partner goes to three
		const firsts = await prisma.connection.findMany({
			where: { label: relation.label, fromID: one.id, toID: two.id, order: 1, testID },
		});
		const partnerIDs = firsts.map((c) => c.dependID).filter((id): id is number => id !== null);
		if (partnerIDs.length && (await prisma.connection.findFirst({ where: { id: { in: partnerIDs }, toID: three.id } }))) {
			return { success: false, error: `${one.nickname} → ${two.nickname} → ${three.nickname} is already in ${relation.label}.` };
		}

		await record(testID);
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

	// The other half of an arity-3 pair goes with it (dependsOn cascades)
	ipcMain.handle("crucible:delete-connection", async (_e, atomID: number) => {
		const atom = await prisma.atom.findFirst({ where: { id: atomID } });
		if (!atom) return { success: false, error: "Atom not found" };
		await record(atom.testID);
		await prisma.connection.deleteMany({
			where: { OR: [{ toID: atomID }, { fromID: atomID }] },
		});
		send("crucible:canvas-update");
		return { success: true, error: null };
	});

	// Delete specific connections. One undo step for all of them.
	ipcMain.handle("crucible:delete-connections", async (_e, { testID, connectionIDs }: { testID: number; connectionIDs: number[] }) => {
		if (connectionIDs.length === 0) return { success: true };
		const rows = await prisma.connection.findMany({ where: { testID, id: { in: connectionIDs } } });
		if (rows.length === 0) return { success: false, error: "Connection not found" };

		// An arity-3 pair is one tuple stored as two rows, so deleting either half takes both.
		const ids = new Set(rows.map((r) => r.id));
		for (const r of rows) if (r.order !== null && r.dependID !== null) ids.add(r.dependID);

		await record(testID);
		await prisma.connection.deleteMany({ where: { testID, id: { in: Array.from(ids) } } });
		send("crucible:canvas-update");
		return { success: true };
	});

	ipcMain.handle("crucible:connection-enabled", async (_e, { atomID, relationDependsOn }) => {
		const conns = await prisma.connection.findMany({
			where: { fromID: atomID },
			include: { connLabel: true },
		});
		return conns.some((c) => c.connLabel.type === relationDependsOn);
	});

    // Writes the editor's current .als text where the project points
    const syncAls = async (text: string) => {
		const project = await prisma.project.findFirst({ where: { id: crucibleProjectID } });
		if (!project) return;
		fs.mkdirSync(path.dirname(project.alloyFile), { recursive: true });
		fs.writeFileSync(project.alloyFile, text);
	};
    ipcMain.handle("crucible:sync-als", async (_e, text: string) => syncAls(text));

    ipcMain.handle("crucible:run-test", async (_e, { projectID, testID }) => {
        try {
            // Test against what's in the editor now. Asked of the main window, since Run can come from the tests window.
            const text = await getWin()?.webContents.executeJavaScript("window.collectAlloyText?.() ?? ''");
            if (typeof text === "string" && text.trim().length > 0) await syncAls(text);
            const built = await buildTestCommand(projectID, testID);
            if (!built || "error" in built) {
                console.log("[crucible] run-test:", built ? built.error : "test not found");
                return "Error";
            }
            console.log("[crucible] command:", built.cmd);

            const resp = await postJson("/tests", {
                path: built.alloyFile,
                command: built.cmd,
                //scope: built.scope,
                maximum: built.maxSeq,
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