// src/crucible/electronAPIStub.ts

// This file is hard coded data that will get replaced by a dynamic electronAPI.ts eventually...

const PROJECT_ID = 1;

const atomSources = [
	{
		id: 1, projectID: PROJECT_ID, label: "this/Person", color: "#4DABF7", shape: "rectangle",
		isAbstract: false, isEnum: false, isLone: false, isOne: false, isSome: false,
		fromRelations: [], isChildOf: [],
	},
	{
		id: 2, projectID: PROJECT_ID, label: "this/Book", color: "#69DB7C", shape: "rectangle",
		isAbstract: false, isEnum: false, isLone: false, isOne: false, isSome: false,
		fromRelations: [], isChildOf: [],
	},
];

const api: Record<string, any> = {
	getOpenProject: async () => PROJECT_ID,
	getAtomSources: async (_projectID: number) => atomSources,
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