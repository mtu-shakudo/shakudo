import "./crucible.css";
import { useEffect, useState } from "react";
import { MantineProvider, AppShell, Navbar } from "@mantine/core";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import SidebarWrapper from "./components/SideBar/SidebarWrapper";

export default function Crucible() {
    const [projectID, setProjectID] = useState<number>();

    useEffect(() => {
        (window as any).electronAPI.getOpenProject().then((id: number) => setProjectID(id));
    }, []);

    return (
        <DndProvider backend={HTML5Backend}>
            <MantineProvider>
                <AppShell
                    fixed={false}
                    padding={0}
                    styles={{ main: { minHeight: 0 } }}
                    sx={(theme) => ({
                        height: "100%",
                        width: "100%",
                        position: "absolute",
                        backgroundColor: theme.colors.gray[2],
                    })}
                    navbar={
                        <Navbar
                            zIndex={100}
                            width={{ base: 84 }}
                            styles={(theme) => ({ backgroundColor: theme.white, height: "100%" })}
                        >
                            {projectID ? <SidebarWrapper projectID={projectID} /> : <></>}
                        </Navbar>
                    }
                >
                    <div style={{ padding: 16 }}>
                        {projectID ? `Project ID: ${projectID}` : "Loading"}
                    </div>
                </AppShell>
            </MantineProvider>
        </DndProvider>
    );
}