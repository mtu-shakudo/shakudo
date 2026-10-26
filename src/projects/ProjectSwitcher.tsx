import React, { useEffect, useState } from "react";
import { Menu, Text, UnstyledButton } from "@mantine/core";
import { IconCheck, IconChevronDown, IconFolder, IconList, IconPlus } from "@tabler/icons";
import NewProjectModal from "./NewProjectModal";
import ManageProjectsModal from "./ManageProjectsModal";
import { fileName, ProjectRow } from "./types";

const api = () => (window as any).electronAPI;

// Open project name at the left of the Blockly tab bar, with a dropdown of recent projects
function ProjectSwitcher() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [openID, setOpenID] = useState(-1);
  const [newFile, setNewFile] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  const load = (): Promise<number> =>
    Promise.all([api().listProjects(), api().getOpenProject()]).then(([list, id]) => {
      setProjects(list);
      setOpenID(id);
      return id;
    });

  useEffect(() => {
    // Nothing is open at launch, so ask which project to open
    load().then((id) => {
      if (id < 0) setManageOpen(true);
    });
    api().listenForProjectChange(() => {
      setManageOpen(false); // e.g. File > Open while the launch picker is showing
      load();
    });
    api().listenForProjectsChange(load);
  }, []);

  const open = projects.find((p) => p.id === openID);

  // Pick the file first; a file that already has a project just opens it
  const startNew = async () => {
    const filePath: string | null = await api().selectAlloyFile();
    if (!filePath) return;
    const existing = projects.find((p) => p.sourcePath === filePath);
    if (existing) {
      if (existing.id !== openID) api().openProject(existing.id);
      return;
    }
    setNewFile(filePath);
  };

  return (
    <>
      <Menu position="bottom-start" width={300} withinPortal zIndex={1000}>
        <Menu.Target>
          <UnstyledButton
            title={open?.sourcePath ?? undefined}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: "100%",
              maxWidth: 220,
              padding: "0 14px",
              color: "#abb2bf",
              background: "#2c313a",
              borderRight: "1px solid #3a404b",
              "&:hover": { background: "#3a404b" },
            }}
          >
            <IconFolder size={16} style={{ flex: "none" }} />
            <Text size="sm" weight={500} truncate>
              {open ? open.name : "No project"}
            </Text>
            <IconChevronDown size={14} style={{ flex: "none" }} />
          </UnstyledButton>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Label>Recent projects</Menu.Label>
          {projects.length === 0 && <Menu.Item disabled>No projects yet</Menu.Item>}
          {projects.map((p) => (
            <Menu.Item
              key={p.id}
              disabled={!p.sourcePath}
              icon={p.id === openID ? <IconCheck size={14} /> : <span style={{ width: 14 }} />}
              rightSection={
                <Text size="xs" color="dimmed" ml="md">
                  {fileName(p.sourcePath)}
                </Text>
              }
              onClick={() => p.id !== openID && api().openProject(p.id)}
            >
              {p.name}
            </Menu.Item>
          ))}
          <Menu.Divider />
          <Menu.Item icon={<IconPlus size={14} />} onClick={startNew}>
            New project…
          </Menu.Item>
          <Menu.Item icon={<IconList size={14} />} onClick={() => setManageOpen(true)}>
            Manage projects…
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <ManageProjectsModal
        opened={manageOpen}
        projects={projects}
        openID={openID}
        onClose={() => setManageOpen(false)}
        onNew={() => {
          setManageOpen(false);
          startNew();
        }}
      />
      <NewProjectModal
        sourcePath={newFile}
        takenNames={projects.map((p) => p.name)}
        onClose={() => setNewFile(null)}
      />
    </>
  );
}

export default ProjectSwitcher;
