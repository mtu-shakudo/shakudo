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
    const [epoch, setEpoch] = useState(0);

    const refresh = () => (window as any).electronAPI.getOpenProject().then(setProjectID);

    useEffect(() => {
        refresh();
        (window as any).electronAPI.listenForProjectChange(() => {
            (window as any).electronAPI.resetListeners();
            refresh().then(() => setEpoch((e) => e + 1));
        });
    }, []);

    useEffect(() => {
        const onMove = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
        window.addEventListener("mousemove", onMove);
        return () => window.removeEventListener("mousemove", onMove);
    }, []);

    return (
        <DndProvider backend={HTML5Backend}>
            <MantineProvider
                key={epoch}
            >
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
                                {projectID && projectID > 0 ? <SidebarWrapper projectID={projectID} /> : <></>}
                            </Navbar>
                        }
                    >
                        {projectID && projectID > 0 ? <BodyWrapper projectID={projectID} /> : <div style={{ padding: 16 }}>No project open</div>}
                    </AppShell>
                </NotificationsProvider>
            </MantineProvider>
            <CustomDragLayer mousePos={mousePos} />
        </DndProvider>
    );
}