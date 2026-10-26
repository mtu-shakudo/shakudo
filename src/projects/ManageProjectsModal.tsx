import React, { useState } from "react";
import { ActionIcon, Avatar, Badge, Button, Group, Modal, Stack, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons";
import DeleteProjectModal from "./DeleteProjectModal";
import { fileName, ProjectRow } from "./types";

const api = () => (window as any).electronAPI;

interface Props {
  opened: boolean;
  projects: ProjectRow[];
  openID: number;
  onClose(): void;
  onNew(): void;
}

const openedLabel = (when: Date) => {
  const d = new Date(when);
  if (d.toDateString() === new Date().toDateString()) return "Opened today";
  return "Opened " + d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

// Every project as a name + file row: click to open, trash to delete
function ManageProjectsModal({ opened, projects, openID, onClose, onNew }: Props) {
  const [deleting, setDeleting] = useState<ProjectRow | null>(null);

  const open = (p: ProjectRow) => {
    onClose();
    if (p.id !== openID) api().openProject(p.id);
  };

  return (
    <>
      <Modal opened={opened} onClose={onClose} title="Projects" size="lg">
        <Stack spacing={2}>
          {projects.length === 0 && (
            <Text size="sm" color="dimmed" align="center" py="lg">
              No projects yet. A project keeps one .als file together with its tests.
            </Text>
          )}
          {projects.map((p) => {
            const isOpen = p.id === openID;
            const folder = (p.sourcePath ?? "").split(/[\\/]/).slice(0, -1).join("/");
            return (
              <Group key={p.id} noWrap spacing="sm">
                <UnstyledButton
                  disabled={!p.sourcePath}
                  onClick={() => open(p)}
                  sx={(theme) => ({
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: 8,
                    borderRadius: theme.radius.sm,
                    background: isOpen ? theme.colors.dark[5] : undefined,
                    "&:hover": { background: theme.colors.dark[5] },
                    "&:disabled": { opacity: 0.5, cursor: "default" },
                  })}
                >
                  <Avatar size={32} radius="sm" color="blue">
                    {p.name.charAt(0).toUpperCase()}
                  </Avatar>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Group spacing={6} noWrap>
                      <Text size="sm" truncate>
                        {p.name}
                      </Text>
                      {isOpen && (
                        <Badge size="xs" variant="light">
                          open
                        </Badge>
                      )}
                    </Group>
                    <Text size="xs" truncate title={p.sourcePath ?? undefined}>
                      {fileName(p.sourcePath)}{" "}
                      <Text component="span" color="dimmed">
                        {folder && `· ${folder}`}
                      </Text>
                    </Text>
                  </div>
                  <Text size="xs" color="dimmed" style={{ whiteSpace: "nowrap" }}>
                    {openedLabel(p.lastOpened)}
                  </Text>
                </UnstyledButton>
                <Tooltip label={isOpen ? "Open another project first" : "Delete project"} withinPortal>
                  <div>
                    <ActionIcon
                      disabled={isOpen}
                      onClick={() => setDeleting(p)}
                      aria-label={`Delete ${p.name}`}
                      sx={{ "&[data-disabled]": { background: "transparent", border: 0, opacity: 0.35 } }}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </div>
                </Tooltip>
              </Group>
            );
          })}
        </Stack>
        <Group position="right" mt="md" pt="md" sx={(theme) => ({ borderTop: `1px solid ${theme.colors.dark[4]}` })}>
          <Button leftIcon={<IconPlus size={16} />} onClick={onNew}>
            New Project
          </Button>
        </Group>
      </Modal>
      <DeleteProjectModal project={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

export default ManageProjectsModal;
