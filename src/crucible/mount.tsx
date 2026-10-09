import React from "react";
import ReactDOM from "react-dom/client";
import "./electronAPI"; // replace with electronAPI.ts later
import Crucible from "./crucible";

export function mountCrucible(el: HTMLElement) {
	ReactDOM.createRoot(el).render(
		<React.StrictMode>
			<Crucible />
		</React.StrictMode>
	);
}