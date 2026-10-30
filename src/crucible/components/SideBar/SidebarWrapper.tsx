import { Center, ActionIcon, Stack, Drawer, Box, Tooltip } from "@mantine/core";
import {
  IconAdjustmentsHorizontal,
  IconArrowBackUp,
  IconAtom,
  IconExternalLink,
  IconTestPipe,
} from "@tabler/icons";
import React, { useState } from "react";
import AtomsSidebarTab from "./AtomsSidebarTab";
import TestsSidebarTab from "./Tests/TestsSidebarTab";

interface Props {
  projectID: number;
}

function SidebarWrapper({ projectID }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const data = [
    {
      icon: IconAtom,
      label: "atoms",
      drawerContent: <AtomsSidebarTab projectID={projectID} />,
    },
    {
      icon: IconTestPipe,
      label: "tests",
      drawerContent: <TestsSidebarTab projectID={projectID} onTestOpened={handleDrawerClose} />,
    },
  ];

  function handleClick(index: number) {
    if (index !== active) {
      setActive(index);
      setDrawerOpen(true);
    } else {
      setActive(null);
      setDrawerOpen(!drawerOpen);
    }
  }

  function handleDrawerClose() {
    setDrawerOpen(false)
    setActive(null)
  }

  const items = data.map((item, index) => (
    <Center key={item.label} sx={() => ({ width: "100%" })}>
      <ActionIcon
        key={item.label}
        size={"xl"}
        radius={"lg"}
        variant={index === active ? "light" : "subtle"}
        color={index === active ? "blue" : "gray"}
        sx={(theme) => ({
          "&:hover": {
            backgroundColor: theme.colors.blue[0],
            color: theme.colors.blue[6],
          },
        })}
        onClick={() => handleClick(index)}
      >
        <item.icon size={34} />
      </ActionIcon>
    </Center>
  ));

  return (
    <>
      <Stack
        id={"sidebar"}
        py={"sm"}
        sx={(theme) => ({
          zIndex: 4,
          backgroundColor: theme.white,
          height: "100%",
        })}
      >
        {items}
        {/* Tests in their own window, or back into the main one (closing the window does the same) */}
        <Center mt={"auto"} sx={() => ({ width: "100%" })}>
          {window.electronAPI.isTestsWindow() ? (
            <Tooltip label={"Put tests back"} position={"right"}>
              <ActionIcon size={"xl"} radius={"lg"} color={"gray"} onClick={() => window.close()}>
                <IconArrowBackUp size={26} />
              </ActionIcon>
            </Tooltip>
          ) : (
            <Tooltip label={"Open tests in a new window"} position={"right"}>
              <ActionIcon size={"xl"} radius={"lg"} color={"gray"} onClick={() => window.electronAPI.popOutTests()}>
                <IconExternalLink size={26} />
              </ActionIcon>
            </Tooltip>
          )}
        </Center>
      </Stack>
      <Drawer
        target="#crucible-portals"
        zIndex={99}
        opened={drawerOpen}
        withOverlay={false}
        size={400}
        onClose={() => handleDrawerClose()}
      >
        <Box
          sx={(theme) => ({
            paddingLeft: "100px",
            paddingRight: theme.spacing.sm,
          })}
        >
          {active !== null ? data[active].drawerContent : ""}
        </Box>
      </Drawer>
    </>
  );
}

export default SidebarWrapper;
