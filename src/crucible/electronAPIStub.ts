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

