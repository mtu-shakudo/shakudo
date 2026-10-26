import React, { useEffect, useState } from "react";
import { Menu, Text, UnstyledButton } from "@mantine/core";
import { IconCheck, IconChevronDown, IconFolder } from "@tabler/icons";
import type { Project } from "@prisma/client";

const api = () => (window as any).electronAPI;
const fileName = (filePath: string | null) => (filePath ? filePath.split(/[\\/]/).pop() : "no file");

// Open project name at the left of the Blockly tab bar, with a dropdown of recent projects
function ProjectSwitcher() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [openID, setOpenID] = useState(-1);

  const load = () =>
    Promise.all([api().listProjects(), api().getOpenProject()]).then(([list, id]) => {
      setProjects(list);
      setOpenID(id);
    });

  useEffect(() => {
    load();
    api().listenForProjectChange(load);
    api().listenForProjectsChange(load);
  }, []);

  const open = projects.find((p) => p.id === openID);

  return (
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
      </Menu.Dropdown>
    </Menu>
  );
}

export default ProjectSwitcher;
