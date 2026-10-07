import React from "react";
import { Box, Group } from "@mantine/core";
import Canvas from "./Canvas";

import type { Test } from "@prisma/client";
//import TestPredicatesBtn from "./TestPredicatesBtn";
import TestPlayBtn from "./TestPlayBtn";
//import Benchmark from "./Benchmark";

interface Props {
  test: Test;
  projectID: number;
}

function TabContent({ test, projectID }: Props) {
  return (
    <>
      <Group
        style={{
          position: "absolute",
          top: 40,
          left: 0,
          margin: "16px",
          zIndex: 1,
        }}
      >
        <TestPlayBtn projectID={projectID} testID={test.id} disabled={false} />
        {/*<Benchmark disabled={false} projectID={projectID} testID={test.id} />*/}
      </Group>
      <Box
        sx={(theme) => ({
          position: "relative",
          height: "100%",
          width: "100%",
          overflow: "scroll",
          backgroundColor: theme.colors.gray[0],
          border: "solid 1px gray",
        })}
      >
        <Canvas testID={test.id} />
      </Box>
    </>
  );
}

export default TabContent;
