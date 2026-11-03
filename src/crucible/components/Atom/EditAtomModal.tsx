import React, { useEffect, useState } from "react";
import { Button, Group, Modal, Stack, TextInput } from "@mantine/core";
import { IconTag } from "@tabler/icons";
import { AtomWithSource } from "../../types";

interface Props {
  setModalOpened(val: boolean): void;
  opened: boolean;
  atom: AtomWithSource;
}

function EditAtomModal({ setModalOpened, opened, atom }: Props) {
  const [nickname, setNickname] = useState(atom.nickname);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (opened) {
      setNickname(atom.nickname);
      setError(undefined);
    }
  }, [opened, atom.nickname]);

  function rename(e: React.FormEvent) {
    e.preventDefault();
    window.electronAPI
      .renameAtom({ atomID: atom.id, nickname })
      .then((resp: { success: boolean; error?: string }) => {
        if (resp.success) setModalOpened(false);
        else setError(resp.error);
      });
  }

  function deleteConnections() {
    // Delete all connections
    window.electronAPI.deleteConnection(atom.id).then((resp: {success: boolean, error?: string}) => {
      if (resp.success) {
        setModalOpened(false)
      } else {
        console.log(resp.error)
      }
    })
  }

  function deleteAtom() {
    window.electronAPI.deleteAtom(atom.id).then((resp: {success: boolean, error?: string}) => {
      if (resp.success) {
        setModalOpened(false)
      } else {
        console.log(resp.error)
      }
    })
  }

  return (
    <Modal
      opened={opened}
      onClose={() => setModalOpened(false)}
      title="Edit Atom"
    >
      <form onSubmit={rename}>
        <Stack spacing={"xs"}>
          <TextInput
            label="Atom name"
            description={"Used for this atom in the Alloy command. You can also double-click the name on the atom."}
            icon={<IconTag />}
            value={nickname}
            error={error}
            onChange={(e) => {
              setNickname(e.currentTarget.value);
              setError(undefined);
            }}
          />
          <Button type="submit" disabled={nickname.trim() === atom.nickname}>
            Rename
          </Button>
        </Stack>
      </form>

      <Group grow mt={"md"}>
        <Button color='red' onClick={() => deleteConnections()}>
          Delete Connections
        </Button>
        <Button color='red' onClick={() => deleteAtom()}>
          Delete Atom
        </Button>
      </Group>
    </Modal>
  );
}

export default EditAtomModal;
