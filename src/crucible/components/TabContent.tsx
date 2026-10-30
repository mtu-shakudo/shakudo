import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActionIcon, Box, Group, Tooltip, UnstyledButton } from "@mantine/core";
import { IconFocusCentered, IconZoomIn, IconZoomOut } from "@tabler/icons";
import Canvas from "./Canvas";

import type { Test } from "@prisma/client";
import TestPredicatesBtn from "./TestPredicatesBtn";
import TestPlayBtn from "./TestPlayBtn";
import { ATOM_HEIGHT, ATOM_WIDTH } from "../utils/constants";
//import Benchmark from "./Benchmark";

interface Props {
  test: Test;
  projectID: number;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const CANVAS_SIZE = 5000; // .canvas width and height in crucible.css
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

function TabContent({ test, projectID }: Props) {
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Zoom and scroll change together. Fast wheel events must build on the last requested values,
  // not on the DOM, which hasn't caught up yet; `pending` says whether that request is still unapplied.
  const view = useRef({ zoom: 1, left: 0, top: 0, pending: false });

  const applyView = (next: number, left: number, top: number) => {
    const box = scrollRef.current;
    if (!box) return;
    const maxLeft = Math.max(0, CANVAS_SIZE * next - box.clientWidth);
    const maxTop = Math.max(0, CANVAS_SIZE * next - box.clientHeight);
    view.current = {
      zoom: next,
      left: Math.min(maxLeft, Math.max(0, left)),
      top: Math.min(maxTop, Math.max(0, top)),
      pending: true,
    };
    setZoom(next);
  };

  // scroll in the same frame the new zoom is drawn, so the point under the pointer doesn't jump
  useLayoutEffect(() => {
    if (!view.current.pending) return;
    scrollRef.current?.scrollTo(view.current.left, view.current.top);
    view.current.pending = false;
  }, [zoom]);

  // Zoom to `next`, keeping the canvas point under (x, y) of the scroll box in place (default: its centre)
  const zoomTo = (next: number, x?: number, y?: number) => {
    const box = scrollRef.current;
    if (!box) return;
    const from = view.current.pending ? view.current : { ...view.current, left: box.scrollLeft, top: box.scrollTop };
    next = clampZoom(next);
    const ratio = next / from.zoom;
    const px = x ?? box.clientWidth / 2;
    const py = y ?? box.clientHeight / 2;
    applyView(next, (from.left + px) * ratio - px, (from.top + py) * ratio - py);
  };

  // Every atom in view, never larger than 100%
  const fit = async () => {
    const box = scrollRef.current;
    const { atoms } = await window.electronAPI.readTest(test.id);
    if (!box || atoms.length === 0) return zoomTo(1);
    const pad = 40;
    const minX = Math.min(...atoms.map((a: any) => a.left)) - pad;
    const minY = Math.min(...atoms.map((a: any) => a.top)) - pad;
    const maxX = Math.max(...atoms.map((a: any) => a.left + ATOM_WIDTH)) + pad;
    const maxY = Math.max(...atoms.map((a: any) => a.top + ATOM_HEIGHT)) + pad;
    const next = clampZoom(Math.min(1, box.clientWidth / (maxX - minX), box.clientHeight / (maxY - minY)));
    applyView(next, minX * next, minY * next);
  };

  // ⌘/Ctrl + scroll zooms around the pointer (a trackpad pinch arrives as ctrl + wheel); plain scroll still pans.
  // Added by hand because React's onWheel is passive and can't stop the page from scrolling.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      // a mouse wheel notch reports ~100 (or counts lines); trackpads and pinches report small steady amounts
      const notch = e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50;
      const factor = notch ? Math.pow(1.15, -Math.sign(e.deltaY)) : Math.exp(-e.deltaY * 0.01);
      const rect = box.getBoundingClientRect();
      zoomTo(view.current.zoom * factor, e.clientX - rect.left, e.clientY - rect.top);
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, []);

  // Grab an empty part of the canvas and drag to move around. Presses on atoms, their dots and the
  // buttons are left alone, so dragging atoms and making connections work as before.
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = scrollRef.current;
    if (!box || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[draggable="true"], button, input, .connectionNode')) return;
    pan.current = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop };
    box.setPointerCapture(e.pointerId);
    setPanning(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pan.current) return;
    scrollRef.current?.scrollTo(pan.current.left - (e.clientX - pan.current.x), pan.current.top - (e.clientY - pan.current.y));
  };
  const onPointerUp = () => {
    pan.current = null;
    setPanning(false);
  };

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
        <TestPredicatesBtn testID={test.id} />
        {/*<Benchmark disabled={false} projectID={projectID} testID={test.id} />*/}
        <Group spacing={4}>
          <Tooltip label={"Zoom out"} position={"bottom"}>
            <ActionIcon variant={"light"} onClick={() => zoomTo(zoom / 1.25)}>
              <IconZoomOut size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={"Actual size"} position={"bottom"}>
            <UnstyledButton
              onClick={() => zoomTo(1)}
              sx={(theme) => ({
                minWidth: 42,
                textAlign: "center",
                fontSize: 12,
                fontWeight: 500,
                fontVariantNumeric: "tabular-nums",
                color: theme.colors.gray[7],
              })}
            >
              {Math.round(zoom * 100)}%
            </UnstyledButton>
          </Tooltip>
          <Tooltip label={"Zoom in"} position={"bottom"}>
            <ActionIcon variant={"light"} onClick={() => zoomTo(zoom * 1.25)}>
              <IconZoomIn size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={"Fit all atoms"} position={"bottom"}>
            <ActionIcon variant={"light"} onClick={fit}>
              <IconFocusCentered size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <Box
        ref={scrollRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        sx={(theme) => ({
          position: "relative",
          height: "100%",
          width: "100%",
          overflow: "scroll",
          cursor: panning ? "grabbing" : "grab",
          backgroundColor: theme.colors.gray[0],
          border: "solid 1px gray",
        })}
      >
        <Canvas testID={test.id} zoom={zoom} />
      </Box>
    </>
  );
}

export default TabContent;
