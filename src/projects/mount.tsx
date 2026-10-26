import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import "../crucible/electronAPI";
import ProjectSwitcher from "./ProjectSwitcher";

export function mountProjectSwitcher(el: HTMLElement) {
	ReactDOM.createRoot(el).render(
		<React.StrictMode>
			<MantineProvider theme={{ colorScheme: "dark" }}>
				<ProjectSwitcher />
			</MantineProvider>
		</React.StrictMode>
	);
}
