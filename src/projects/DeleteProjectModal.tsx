import React, { useState } from "react";
import { Button, Group, List, Modal, Text } from "@mantine/core";
import { fileName, ProjectRow } from "./types";

const api = () => (window as any).electronAPI;

interface Props {
  project: ProjectRow | null; // null keeps it closed
  onClose(): void;
}

// Plain confirm: say what goes and what stays, then delete
function DeleteProjectModal({ project, onClose }: Props) {
  const [deleting, setDeleting] = useState(false);
  const tests = project?._count.tests ?? 0;

  const remove = async () => {
    if (!project) return;
    setDeleting(true);
    await api().deleteProject(project.id);
    setDeleting(false);
    onClose();
  };

  return (
    <Modal opened={!!project} onClose={onClose} title="Delete Project" size="sm">
      <Text weight={700} size="lg" mb="xs">
        Delete {project?.name}?
      </Text>
      <List size="sm" spacing={4} mb="lg">
        <List.Item>
          Deletes its <b>{tests === 1 ? "1 test" : `${tests} tests`}</b> and the project folder.
        </List.Item>
        {project?.sourcePath && (
          <List.Item>
            Keeps <b>{fileName(project.sourcePath)}</b> where it is.
          </List.Item>
        )}
      </List>
      <Group position="right">
        <Button variant="default" onClick={onClose}>
          Cancel
        </Button>
        <Button color="red" loading={deleting} onClick={remove}>
          Delete project
        </Button>
      </Group>
    </Modal>
  );
}

export default DeleteProjectModal;
