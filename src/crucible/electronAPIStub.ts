// src/crucible/electronAPIStub.ts

// This file is hard coded data that will get replaced by a dynamic electronAPI.ts eventually...

const PROJECT_ID = 1;

const atomSources = [
	{
		id: 1, projectID: PROJECT_ID, label: "this/Kitteh", color: "#4DABF7", shape: "rectangle",
		isAbstract: false, isEnum: false, isLone: false, isOne: false, isSome: false,
		fromRelations: [], isChildOf: [],
	},
	{
		id: 2, projectID: PROJECT_ID, label: "this/Imposter", color: "#69DB7C", shape: "rectangle",
		isAbstract: false, isEnum: false, isLone: false, isOne: false, isSome: false,
		fromRelations: [], isChildOf: [],
	},
];

let tests: any[] = [
	{ id: 1, name: "Sample Test", projectID: PROJECT_ID, testFile: "", atomCount: 0, tabIsOpen: false },
];

let activeTab = "";

const tabListeners: Function[] = [];
const fireTabsUpdate = () => tabListeners.forEach((cb) => cb());

const canvasListeners: Function[] = [];

let atoms: any[] = [];
let nextAtomID = 1;

const fireCanvasUpdate = () => canvasListeners.forEach((cb) => cb({}, undefined));

const api: Record<string, any> = {
	getOpenProject: async () => PROJECT_ID,
	getAtomSources: async (_projectID: number) => atomSources,
	getTests: async (_projectID: number) => [...tests],
	createNewTest: async ({ testName }: { testName: string }) => {
		if (tests.some((t) => t.name === testName)) {
			// Same shape as the Zod issues the real main process returns
			return { success: false, error: [{ path: ["testName"], message: "A test with that name already exists" }] };
		}
		const test = { id: Date.now(), name: testName, projectID: PROJECT_ID, testFile: "", atomCount: 0, tabIsOpen: false };
		tests = [...tests, test];
		return { success: true, error: null, test };
	},
	getActiveTest: async (_projectID: number) => activeTab,
	setActiveTest: ({ testName }: { testName: string }) => {
		activeTab = testName;
		fireTabsUpdate();
	},
	openTest: async ({ testID }: { testID: number }) => {
		tests = tests.map((t) => (t.id === testID ? { ...t, tabIsOpen: true } : t));
		activeTab = tests.find((t) => t.id === testID)?.name ?? activeTab;
		fireTabsUpdate();
		return { success: true };
	},
	closeTest: async ({ testID }: { testID: number }) => {
		tests = tests.map((t) => (t.id === testID ? { ...t, tabIsOpen: false } : t));
		const stillOpen = tests.find((t) => t.tabIsOpen);
		activeTab = stillOpen ? stillOpen.name : "";
		fireTabsUpdate();
		return { success: true };
	},
	listenForTabsChange: (cb: Function) => { tabListeners.push(cb); },
	readTest: async (id: number) => ({
		...(tests.find((t) => t.id === id) ?? {}),
		atoms: atoms.filter((a) => a.testID === id),
		connections: [],
	}),
	listenForCanvasChange: (cb: Function) => { canvasListeners.push(cb); },
	testCanAddAtom: async () => ({ success: true }),
	testAddAtom: ({ testID, sourceAtomID, top, left }: any) => {
		const src = atomSources.find((s) => s.id === sourceAtomID);
		const test = tests.find((t) => t.id === testID);
		if (!src || !test) return;
		atoms = [...atoms, {
			id: nextAtomID++, testID, srcID: sourceAtomID, top, left,
			nickname: `${src.label.split("/")[1]}${test.atomCount}`,
			srcAtom: { ...src, isParentOf: [], toRelations: [] },
			connsFrom: [], connsTo: [],
		}];
		tests = tests.map((t) => (t.id === testID ? { ...t, atomCount: t.atomCount + 1 } : t));
		fireCanvasUpdate();
	},

	updateAtom: ({ atomID, left, top }: any) => {
		atoms = atoms.map((a) => (a.id === atomID ? { ...a, left, top } : a));
		fireCanvasUpdate();
	},
	deleteAtom: async (atomID: number) => {
		atoms = atoms.filter((a) => a.id !== atomID);
		fireCanvasUpdate();
		return { success: true, error: null };
	},
	getRelationsToAtom: async () => [],
	getAtomParents: async () => [],
	getAtomChildren: async () => [],
	connectionNodeEnabled: async () => false,
};

// Any method not listed above warns in DevTools instead of crashing.
(window as any).electronAPI = new Proxy(api, {
	get(target, prop: string) {
		if (prop in target) return target[prop];
		return (...args: any[]) => {
			console.warn("[crucible stub] unimplemented:", prop, args);
			return Promise.resolve(undefined);
		};
	},
});

