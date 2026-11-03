import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActionIcon, Box, Group, Tooltip, UnstyledButton } from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import { IconArrowBackUp, IconArrowForwardUp, IconFocusCentered, IconZoomIn, IconZoomOut } from "@tabler/icons";
import Canvas from "./Canvas";

import type { Connection, Test } from "@prisma/client";
import TestPredicatesBtn from "./TestPredicatesBtn";
import TestPlayBtn from "./TestPlayBtn";
import CanvasShortcutsBtn, { MOD } from "./CanvasShortcutsBtn";
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
const PASTE_OFFSET = 30;

// Copied atoms and the connections between them. Kept for the window, so they can be pasted into another test.
let clipboard: { atoms: { id: number; srcID: number; left: number; top: number }[]; connections: Connection[]; pastes: number } | null = null;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

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

  const [selected, setSelected] = useState<number[]>([]);
  const atomsInView = () =>
    Array.from(scrollRef.current?.querySelectorAll<HTMLElement>("[data-atom-id]") ?? []);

  // Dragging on an empty part of the canvas draws a selection box. Holding space (or using the middle button)
  // drags the view instead. Presses on atoms, their dots and the buttons are left alone.
  const space = useRef(false);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const marquee = useRef<{ x: number; y: number; base: number[] } | null>(null);
  const [marqueeBox, setMarqueeBox] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = scrollRef.current;
    if (!box || (e.button !== 0 && e.button !== 1)) return;
    if ((e.target as HTMLElement).closest('[draggable="true"], button, input, .connectionNode')) return;
    box.setPointerCapture(e.pointerId);
    if (e.button === 1 || space.current) {
      pan.current = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop };
      setPanning(true);
      return;
    }
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    marquee.current = { x: e.clientX, y: e.clientY, base: additive ? selected : [] };
    if (!additive) setSelected([]);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pan.current) {
      scrollRef.current?.scrollTo(pan.current.left - (e.clientX - pan.current.x), pan.current.top - (e.clientY - pan.current.y));
      return;
    }
    const m = marquee.current;
    if (!m) return;
    const rect = {
      left: Math.min(m.x, e.clientX),
      top: Math.min(m.y, e.clientY),
      right: Math.max(m.x, e.clientX),
      bottom: Math.max(m.y, e.clientY),
    };
    setMarqueeBox(rect);
    const hits = atomsInView()
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top;
      })
      .map((el) => Number(el.dataset.atomId));
    setSelected(Array.from(new Set([...m.base, ...hits])));
  };
  const onPointerUp = () => {
    pan.current = null;
    marquee.current = null;
    setMarqueeBox(null);
    setPanning(false);
  };

  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  useEffect(() => {
    const load = () => window.electronAPI.historyState(test.id).then(setHistory);
    load();
    return window.electronAPI.listenForCanvasChange(load);
  }, [test.id]);
  const undo = () => window.electronAPI.undo(test.id).then(setHistory);
  const redo = () => window.electronAPI.redo(test.id).then(setHistory);

  const copy = async () => {
    const t = await window.electronAPI.readTest(test.id);
    const atoms = t.atoms
      .filter((a: any) => selected.includes(a.id))
      .map(({ id, srcID, left, top }: any) => ({ id, srcID, left, top }));
    const connections = t.connections
      .filter((c: any) => selected.includes(c.fromID) && selected.includes(c.toID))
      .map(({ to, from, connLabel, ...c }: any) => c);
    clipboard = { atoms, connections, pastes: 0 };
  };

  const remove = () => {
    window.electronAPI.deleteAtoms({ testID: test.id, atomIDs: selected });
    setSelected([]);
  };

  const paste = async () => {
    if (!clipboard || clipboard.atoms.length === 0) return;
    clipboard.pastes += 1;
    const resp = await window.electronAPI.pasteAtoms({
      testID: test.id,
      atoms: clipboard.atoms,
      connections: clipboard.connections,
      offset: PASTE_OFFSET * clipboard.pastes,
    });
    setSelected(resp.ids);
    if (resp.skipped > 0) {
      showNotification({
        title: resp.ids.length ? "Some atoms weren't pasted" : "Nothing pasted",
        message: "A one or lone sig can only have one atom in a test, and atoms can't move between projects.",
        color: "orange",
      });
    }
  };

  // Shortcuts work after a click on the canvas or its toolbar, so the blocks editor keeps its own ⌘Z, ⌘C and ⌘V.
  // Captured on the window and stopped there, so Blockly and the Edit menu don't act on the same keys.
  const canvasActive = useRef(false);
  const keys = useRef<(e: KeyboardEvent) => boolean>(() => false);
  keys.current = (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === "z") e.shiftKey ? redo() : undo();
    else if (mod && key === "y") redo();
    else if (mod && key === "a") setSelected(atomsInView().map((el) => Number(el.dataset.atomId)));
    else if (mod && key === "c" && selected.length) copy();
    else if (mod && key === "x" && selected.length) copy().then(remove);
    else if (mod && key === "v" && clipboard) paste();
    else if (!mod && (key === "delete" || key === "backspace") && selected.length) remove();
    else if (key === "escape" && selected.length) setSelected([]);
    else return false;
    return true;
  };
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      canvasActive.current = !!(e.target as HTMLElement).closest?.(`[data-test-canvas="${test.id}"]`);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === "Space") {
        space.current = true;
        // otherwise the scroll box pages down (or a focused toolbar button gets pressed)
        if (canvasActive.current) e.preventDefault();
      }
      if (canvasActive.current && keys.current(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [test.id]);

  return (
    <>
      <Group
        data-test-canvas={test.id}
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
          {/* A disabled button swallows mouseleave, so the tooltip hangs on the wrapper and the button lets the pointer through */}
          <Tooltip label={`Undo (${MOD}Z)`} position={"bottom"}>
            <div>
              <ActionIcon variant={"light"} disabled={!history.canUndo} onClick={undo} sx={{ "&:disabled": { pointerEvents: "none" } }}>
                <IconArrowBackUp size={18} />
              </ActionIcon>
            </div>
          </Tooltip>
          <Tooltip label={`Redo (⇧${MOD}Z)`} position={"bottom"}>
            <div>
              <ActionIcon variant={"light"} disabled={!history.canRedo} onClick={redo} sx={{ "&:disabled": { pointerEvents: "none" } }}>
                <IconArrowForwardUp size={18} />
              </ActionIcon>
            </div>
          </Tooltip>
        </Group>
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
        <CanvasShortcutsBtn />
      </Group>
      <Box
        ref={scrollRef}
        data-test-canvas={test.id}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        sx={(theme) => ({
          position: "relative",
          height: "100%",
          width: "100%",
          overflow: "scroll",
          cursor: panning ? "grabbing" : "default",
          backgroundColor: theme.colors.gray[0],
          border: "solid 1px gray",
        })}
      >
        <Canvas testID={test.id} zoom={zoom} selected={selected} setSelected={setSelected} />
      </Box>
      {marqueeBox && (
        <Box
          sx={(theme) => ({
            position: "fixed",
            left: marqueeBox.left,
            top: marqueeBox.top,
            width: marqueeBox.right - marqueeBox.left,
            height: marqueeBox.bottom - marqueeBox.top,
            border: `1px solid ${theme.colors.blue[5]}`,
            backgroundColor: "rgba(34, 139, 230, 0.1)",
            pointerEvents: "none",
            zIndex: 2,
          })}
        />
      )}
    </>
  );
}

export default TabContent;
