const { ipcRenderer } = window.require("electron");

// API calls IPC handlers
const api: Record<string, any> = {
  getOpenProject: () => ipcRenderer.invoke("crucible:get-open-project"),
  getAtomSources: (projectID: number) =>
    ipcRenderer.invoke("crucible:get-atom-sources", projectID),
  getTests: (projectID: number) => ipcRenderer.invoke("crucible:get-tests", projectID),
  createNewTest: (args: { projectID: number; testName: string }) =>
    ipcRenderer.invoke("crucible:create-test", args),
  openTest: (args: any) => ipcRenderer.invoke("crucible:open-test", args),
  closeTest: (args: any) => ipcRenderer.invoke("crucible:close-test", args),
  getActiveTest: (projectID: number) => ipcRenderer.invoke("crucible:get-active-test", projectID),
  setActiveTest: (args: any) => ipcRenderer.invoke("crucible:set-active-test", args),
  listenForTabsChange: (cb: Function) => {
    ipcRenderer.on("crucible:tabs-update", () => cb());
  },
  readTest: (id: number) => ipcRenderer.invoke("crucible:read-test", id),
  testCanAddAtom: (args: any) => ipcRenderer.invoke("crucible:test-can-add-atom", args),
  testAddAtom: (args: any) => ipcRenderer.invoke("crucible:test-add-atom", args),
  updateAtom: (args: any) => ipcRenderer.invoke("crucible:update-atom", args),
  deleteAtom: (id: number) => ipcRenderer.invoke("crucible:delete-atom", id),
  getPredicates: (testID: number) => ipcRenderer.invoke("crucible:get-predicates", testID),
  updatePredicateState: (args: any) => ipcRenderer.invoke("crucible:update-pred-state", args),
  updatePredParam: (args: any) => ipcRenderer.invoke("crucible:update-pred-param", args),
  listenForCanvasChange: (cb: Function) => {
    ipcRenderer.on("crucible:canvas-update", (e: any, v: any) => cb(e, v));
  },
  listenForPredicatesChange: (cb: Function) => {
    ipcRenderer.on("crucible:predicates-update", (e: any, v: any) => cb(e, v));
  },
  getRelationsToAtom: (args: any) => ipcRenderer.invoke("crucible:get-relations-to-atom", args),
  getAtomParents: (id: number) => ipcRenderer.invoke("crucible:get-atom-parents", id),
  getAtomChildren: (args: any) => ipcRenderer.invoke("crucible:get-atom-children", args),
  createConnection: (args: any) => ipcRenderer.invoke("crucible:create-connection", args),
  createDependentConnection: (args: any) => ipcRenderer.invoke("crucible:create-connection", args),
  createHighConnection: (args: any) => ipcRenderer.invoke("crucible:create-high-connection", args),
  deleteConnection: (id: number) => ipcRenderer.invoke("crucible:delete-connection", id),
  connectionNodeEnabled: (args: any) => ipcRenderer.invoke("crucible:connection-enabled", args),
  runTest: async (args: { projectID: number; testID: number }) => {
    const text = (window as any).collectAlloyText?.();
    if (typeof text === "string" && text.trim().length > 0) {
      await ipcRenderer.invoke("crucible:sync-als", text);
    }
    return ipcRenderer.invoke("crucible:run-test", args);
  },
};

(window as any).electronAPI = new Proxy(api, {
	get(target, prop: string) {
		if (prop in target) return target[prop];
		return (...args: any[]) => {
			console.warn("[crucible] unimplemented:", prop, args);
			return Promise.resolve(undefined);
		};
	},
});