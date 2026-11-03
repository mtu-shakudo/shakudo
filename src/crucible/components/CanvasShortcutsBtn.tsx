import React from "react";
import { ActionIcon, Divider, Group, Kbd, Popover, Stack, Text, Tooltip } from "@mantine/core";
import { IconKeyboard } from "@tabler/icons";

export const MOD = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl";

const ROWS: { group: string; rows: { label: string; ways: string[][] }[] }[] = [
  {
    group: "Canvas",
    rows: [
      { label: "Pan", ways: [["Drag empty canvas"], ["Scroll"]] },
      { label: "Zoom", ways: [[MOD, "scroll"], ["Pinch"]] },
      { label: "Box select", ways: [["Space", "drag"]] },
      { label: "Add to selection", ways: [["Shift", "click"], ["Shift", "drag"]] },
      { label: "Rename atom", ways: [["Double-click name"]] },
    ],
  },
  {
    group: "Selection",
    rows: [
      { label: "Select all", ways: [[MOD, "A"]] },
      { label: "Copy / Cut", ways: [[MOD, "C"], [MOD, "X"]] },
      { label: "Paste", ways: [[MOD, "V"]] },
      { label: "Delete", ways: [["Delete"]] },
      { label: "Deselect", ways: [["Esc"]] },
    ],
  },
  {
    group: "History",
    rows: [
      { label: "Undo", ways: [[MOD, "Z"]] },
      { label: "Redo", ways: [["Shift", MOD, "Z"]] },
    ],
  },
];

// words in a way (like "drag") are actions, not keys, so they're shown as plain text
const KEYS = new Set(["Space", "Shift", "Delete", "Esc", "A", "C", "V", "X", "Z", MOD]);

function CanvasShortcutsBtn() {
  return (
    <Popover position={"bottom-start"} withArrow shadow={"md"} width={300}>
      {/* Tooltip hands extra props to its label, not its child, so the popover's click goes on a wrapper */}
      <Popover.Target>
        <div>
          <Tooltip label={"Shortcuts"} position={"bottom"}>
            <ActionIcon variant={"light"}>
              <IconKeyboard size={18} />
            </ActionIcon>
          </Tooltip>
        </div>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack spacing={"xs"}>
          {ROWS.map(({ group, rows }, i) => (
            <React.Fragment key={group}>
              {i > 0 && <Divider />}
              <Text size={"xs"} weight={600} color={"dimmed"} transform={"uppercase"}>
                {group}
              </Text>
              {rows.map(({ label, ways }) => (
                <Group key={label} position={"apart"} noWrap spacing={"xs"}>
                  <Text size={"sm"}>{label}</Text>
                  <Group spacing={6} noWrap>
                    {ways.map((way, j) => (
                      <React.Fragment key={j}>
                        {j > 0 && <Text size={"xs"} color={"dimmed"}>or</Text>}
                        <Group spacing={3} noWrap>
                          {way.map((part) =>
                            KEYS.has(part) ? <Kbd key={part}>{part}</Kbd> : <Text key={part} size={"xs"}>{part}</Text>
                          )}
                        </Group>
                      </React.Fragment>
                    ))}
                  </Group>
                </Group>
              ))}
            </React.Fragment>
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

export default CanvasShortcutsBtn;
