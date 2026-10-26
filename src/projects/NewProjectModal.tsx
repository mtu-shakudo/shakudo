import React, { useEffect, useState } from "react";
import { Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { IconFile, IconTag } from "@tabler/icons";

const api = () => (window as any).electronAPI;

interface Props {
  sourcePath: string | null; // the .als picked before this opens; null keeps it closed
  takenNames: string[];
  onClose(): void;
}

// Second half of New project: the file is already picked, confirm a name then create and open
function NewProjectModal({ sourcePath, takenNames, onClose }: Props) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parts = (sourcePath ?? "").split(/[\\/]/);
  const file = parts.pop() ?? "";
  const folder = parts.join("/");

  // Suggest the file name, numbered if a project already has it
  useEffect(() => {
    if (!sourcePath) return;
    const base = file.replace(/\.als$/, "");
    let suggestion = base;
    for (let n = 2; takenNames.includes(suggestion); n++) suggestion = `${base} ${n}`;
    setName(suggestion);
    setError(null);
  }, [sourcePath]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const result = await api().createProject({ name, sourcePath });
    setSaving(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    onClose();
    await api().openProject(result.projectID);
  };

  return (
    <Modal opened={!!sourcePath} onClose={onClose} title="New Project">
      <form onSubmit={create}>
        <Stack>
          <Group spacing="sm" noWrap>
            <IconFile size={18} style={{ flex: "none" }} />
            <div style={{ minWidth: 0 }}>
              <Text size="sm" weight={500}>
                {file}
              </Text>
              <Text size="xs" color="dimmed" truncate>
                {folder}
              </Text>
            </div>
          </Group>

          <TextInput
            required
            data-autofocus
            label="Project Name"
            description="Filled in from the file name."
            icon={<IconTag size={16} />}
            value={name}
            onChange={(e) => {
              setName(e.currentTarget.value);
              setError(null);
            }}
            error={error}
          />

          <Group position="right">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Create Project
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export default NewProjectModal;
