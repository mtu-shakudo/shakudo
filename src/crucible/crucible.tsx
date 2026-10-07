import "./crucible.css";
import { useEffect, useState } from "react";
import { MantineProvider, AppShell, Navbar } from "@mantine/core";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import SidebarWrapper from "./components/SideBar/SidebarWrapper";
import { NotificationsProvider } from "@mantine/notifications";
import BodyWrapper from "./components/BodyWrapper";
import { CustomDragLayer } from "./components/CustomDragLayer";

export default function Crucible() {
    const [projectID, setProjectID] = useState<number>();
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

    useEffect(() => {
        (window as any).electronAPI.getOpenProject().then((id: number) => setProjectID(id));
    }, []);

    useEffect(() => {
        const onMove = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
        window.addEventListener("mousemove", onMove);
        return () => window.removeEventListener("mousemove", onMove);
    }, []);

    return (
        <DndProvider backend={HTML5Backend}>
            <MantineProvider>
                <NotificationsProvider>
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
                        {projectID ? <BodyWrapper projectID={projectID} /> : <div>Loading</div>}
                    </AppShell>
                </NotificationsProvider>
            </MantineProvider>
            <CustomDragLayer mousePos={mousePos} />
        </DndProvider>
    );
}