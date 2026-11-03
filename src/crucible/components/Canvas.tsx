import React, { useEffect, useRef, useState } from "react";
import { useDragLayer, useDrop } from "react-dnd";
import Xarrow from "react-xarrows";
import { showNotification } from "@mantine/notifications";
import { IconAlertTriangle } from "@tabler/icons";
import { useClickOutside } from "@mantine/hooks";
import { Affix, Popover, Select, Title, useMantineTheme } from "@mantine/core";
import {
  AtomWithSource,
  TestWithCanvas,
} from "../types";
import { AtomInstance } from "./Atom/AtomInstance";
import type { Atom, AtomSource, Connection } from "@prisma/client";

import { ATOM, ATOM_HEIGHT, ATOM_SOURCE, ATOM_WIDTH } from "../utils/constants";
import { AtomContents } from "./Atom/AtomContents";
//import { Arrow } from "react-absolute-svg-arrows";
//import { z } from "zod";

interface Props {
  testID: number;
  zoom: number;
  selected: number[];
  setSelected(ids: number[]): void;
}

// What useDrag in AtomContents and AtomSourceItem hand over. `group` is the rest of the selection when a selected atom is dragged.
type AtomDraggable = { data: Atom | AtomSource; group?: AtomWithSource[] };

// The canvas is scaled with CSS zoom (react-xarrows still lines up under it; transform: scale doesn't).
// Positions inside it stay in canvas units, but the pointer is in screen pixels, so drops divide by zoom.
function Canvas({ testID, zoom, selected, setSelected }: Props) {

  const AtomHeight = 120
  const AtomWidth = 240

  const [canvasItems, setCanvas] = useState<TestWithCanvas>();
  const [atomMenu, setAtomMenu] = useState(false);
  const [coords, setCoords] = useState<{
    clickX: number | null;
    clickY: number | null;
  }>({ clickX: null, clickY: null });
  const [atoms, setAtoms] = useState<AtomWithSource[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [quickInsertData, setQuickInsertData] = useState([]);
  const theme = useMantineTheme();

  const canvasRef = useRef<HTMLDivElement | null>(null);

  useEffect(
    () =>
      window.electronAPI.listenForCanvasChange((_event: any, value: any) => {
        console.log("got canvas update");
        window.electronAPI.readTest(testID).then((data: TestWithCanvas) => {
          setCanvas(data);
        });
      }),
    []
  );

  useEffect(() => {
    const loadCanvas = async () => {
      window.electronAPI.readTest(testID).then((data: TestWithCanvas) => {
        setCanvas(data);
      });
    };
    loadCanvas().then(() => setLoading(false));
  }, []);

  // useDidUpdate(() => {
  //   setQuickInsertData(
  //     atoms.map( (atom) => ({
  //       label: value["label"],
  //       value: key,
  //     }))
  //   );
  // }, [atoms]);

  const ref = useClickOutside(() => setCoords({ clickX: null, clickY: null }));

  const validCoords = coords.clickX !== null && coords.clickY !== null;

  const addNewAtom = ({
    sourceAtomID,
    top,
    left,
  }: {
    sourceAtomID: number;
    top: number;
    left: number;
  }) => {
    window.electronAPI
      .testCanAddAtom({ testID, sourceAtomID })
      .then((resp: { success: boolean; error?: any }) => {
        if (resp.success) {
          window.electronAPI.testAddAtom({ testID, sourceAtomID, top, left });
        } else {
          if (resp.error) console.log(resp.error);

          showNotification({
            title: "Cannot add Atom",
            message: `Adding that atom would exceed it's multiplicity.`,
            color: "red",
            icon: <IconAlertTriangle />,
          });
        }
      });
  };

  // Apply moves locally right away so the atom doesn't flash back to its old spot
  // while the IPC round trip and re-read are in flight.
  const applyMovesLocally = (
    moves: { atomID: number; left: number; top: number }[]
  ) => {
    const byId = new Map(moves.map((m) => [m.atomID, m]));
    setCanvas((prev) =>
      prev
        ? {
            ...prev,
            atoms: prev.atoms.map((a) => {
              const m = byId.get(a.id);
              return m ? { ...a, left: m.left, top: m.top } : a;
            }),
          }
        : prev
    );
  };

  const reloadCanvas = () =>
    window.electronAPI.readTest(testID).then((data: TestWithCanvas) => setCanvas(data));

  const updateAtom = (atomID: number, left: number, top: number) => {
    applyMovesLocally([{ atomID, left, top }]);
    window.electronAPI
      .updateAtom({ atomID, left, top })
      .catch(() => reloadCanvas()); // roll back to DB state if the write fails
  };

  function quickInsert(selectedAtom: Atom | null, coords: any) {
    //   window.electronAPI
    //     .getAtomInstance(projectKey, selectedAtom)
    //     .then((atom) => {
    //       console.log(coords);
    //       //let canvasRect = this.getBoundingClientRect();
    //       // TODO: Translate to coordinates in canvas.
    //       addNewAtom(
    //         coords.clickX,
    //         coords.clickY,
    //         projectKey,
    //         testKey,
    //         selectedAtom,
    //         atom.label
    //       );
    //     });
  }

  /* Helper function to assist in differentiating between AtomSource drops
  and existing Atom instance drops on the canvas. */
  function isAtomInstance(item: Atom | AtomSource): item is Atom {
    return (item as Atom).srcID !== undefined;
  }

  const [, drop] = useDrop(
    () => ({
      accept: [ATOM, ATOM_SOURCE],
      drop(item: AtomDraggable, monitor) {
        const delta = monitor.getDifferenceFromInitialOffset();
        if (delta) {
          if (isAtomInstance(item.data)) {
            const left = Math.round(item.data.left + delta.x / zoom);
            const top = Math.round(item.data.top + delta.y / zoom);
            if (monitor.getItemType() === ATOM) {
              console.log("Existing atom dragged.");
              if (item.group?.length) {
                const moves = [item.data, ...item.group].map((a) => ({
                  atomID: a.id,
                  left: Math.round(a.left + delta.x / zoom),
                  top: Math.round(a.top + delta.y / zoom),
                }));
                applyMovesLocally(moves);
                window.electronAPI.moveAtoms({ testID, moves }).catch(() => reloadCanvas());
              } else {
                updateAtom(item.data.id, left, top);
              }
            }
          } else {
            if (monitor.getItemType() === ATOM_SOURCE) {
              console.log("New atom dragged.");
              const clickCoords = monitor.getClientOffset();
              const rect = canvasRef.current?.getBoundingClientRect();
              if (clickCoords && rect) {
                console.log("Item ", item);
                addNewAtom({
                  sourceAtomID: item.data.id,
                  top: Math.round((clickCoords.y - rect.top) / zoom),
                  left: Math.round((clickCoords.x - rect.left) / zoom),
                });
              }
            }
          }
          return undefined;
        }
      },
    }),
    [updateAtom, addNewAtom]
  );

  // Live drag state: which atoms are moving, and by how much (in screen px).
  const drag = useDragLayer((monitor) => {
    const dragging = monitor.isDragging() && monitor.getItemType() === ATOM;
    const item = dragging ? (monitor.getItem() as AtomDraggable) : null;
    const delta = dragging ? monitor.getDifferenceFromInitialOffset() : null;
    return {
      id: item?.data.id ?? null,
      group: item?.group ?? null,
      dx: delta?.x ?? 0,
      dy: delta?.y ?? 0,
    };
  });
  const hidden = new Set(drag.group?.map((a) => a.id));

  // Same rounding as CustomDragLayer, so arrow ends sit exactly on the preview's edges.
  const dragShift = (id: number) =>
    drag.id !== null && (id === drag.id || drag.group?.some((a) => a.id === id))
      ? { x: Math.round(drag.dx / zoom), y: Math.round(drag.dy / zoom) }
      : { x: 0, y: 0 };

  const isSelected = (id: number) => selected.includes(id);
  // Click selects one atom; shift, ⌘ or ctrl adds or removes it. Pressing on an unselected atom selects it,
  // so dragging it moves it alone; pressing on a selected one keeps the selection, so dragging moves them all.
  const selectAtom = (id: number, how: "press" | "click" | "toggle") => {
    if (how === "toggle") setSelected(isSelected(id) ? selected.filter((s) => s !== id) : [...selected, id]);
    else if (how === "click" || !isSelected(id)) setSelected([id]);
  };
  const groupFor = (id: number) =>
    isSelected(id) && canvasItems ? canvasItems.atoms.filter((a) => a.id !== id && isSelected(a.id)) : [];

  const [selectedConns, setSelectedConns] = useState<number[]>([]);

  // Selecting atoms and selecting connections are exclusive, so Delete only ever means one thing.
  useEffect(() => {
    if (selected.length > 0) setSelectedConns([]);
  }, [selected]);

  // Forget ids that no longer exist after a reload (undo, delete elsewhere).
  useEffect(() => {
    if (!canvasItems) return;
    setSelectedConns((cur) => {
      const next = cur.filter((id) => canvasItems.connections.some((c) => c.id === id));
      return next.length === cur.length ? cur : next;
    });
  }, [canvasItems]);

  useEffect(() => {
    if (selectedConns.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      // don't steal the key from the rename box or any other text field
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      window.electronAPI
        .deleteConnections({ testID, connectionIDs: selectedConns })
        .finally(() => setSelectedConns([]));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedConns, testID]);

  // Pressing anywhere that isn't a connection clears the connection selection.
  useEffect(() => {
    if (selectedConns.length === 0) return;
    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("[data-conn-id]")) return;
      setSelectedConns([]);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [selectedConns.length > 0]);

  const selectConn = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setSelected([]); // clear atom selection
    const multi = e.shiftKey || e.metaKey || e.ctrlKey;
    setSelectedConns((cur) =>
      multi ? (cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id]) : [id]
    );
  };

  if (canvasItems) {
    return (
      <div
        ref={(node) => {
          canvasRef.current = node;
          drop(node);
        }}
        className={"canvas"}
        style={{ zoom }}
        onClick={(e) => { if (e.target === e.currentTarget) setSelectedConns([]); }}
        onMouseDown={(e) => {
          const el = (e.target as HTMLElement).closest("[data-conn-id]");
          if (!el) return;
          selectConn(e, Number(el.getAttribute("data-conn-id")));
        }}
        onMouseDownCapture={(e) => console.log("mousedown target:", e.target)}
        // onContextMenu={(e) => {
        //   e.preventDefault();
        //   const clickCoords = { clickX: e.pageX, clickY: e.pageY };
        //   // console.log(clickCoords);
        //   // console.log(quickInsertData);
        //   setCoords(clickCoords);
        // }}
      >
        <Affix
          sx={{ display: validCoords ? "initial" : "none" }}
          position={
            coords.clickX !== null && coords.clickY !== null
              ? { left: coords.clickX, top: coords.clickY }
              : undefined
          }
        >
          <Popover opened={validCoords} trapFocus width={400} shadow={"md"}>
            <div ref={ref}>
              <Popover.Target>
                <div />
              </Popover.Target>
              <Popover.Dropdown>
                <Title size={"xs"} color={"dimmed"}>
                  Quick Insert
                </Title>
                <Select
                  data={quickInsertData}
                  label="Atoms"
                  placeholder="Pick one"
                  searchable
                  data-auto-focus
                  nothingFound="No options"
                  onChange={(selected) => quickInsert(null, coords)}
                />
                {/*<Text size={"sm"} weight={500} mt={"sm"} mb={"xs"}>Data Types</Text>*/}
                {/*<Group>*/}
                {/*    <Tooltip label={"Integer"} position={"bottom"}>*/}
                {/*        <ActionIcon variant={"light"} > <IconNumbers/> </ActionIcon>*/}
                {/*    </Tooltip>*/}
                {/*    <Tooltip label={"String"} position={"bottom"}>*/}
                {/*        <ActionIcon variant={"light"} disabled> <IconAlphabetLatin/> </ActionIcon>*/}
                {/*    </Tooltip>*/}
                {/*</Group>*/}
              </Popover.Dropdown>
            </div>
          </Popover>
        </Affix>
        {canvasItems.atoms.map((atom: AtomWithSource) => (
          <AtomContents
            key={atom.id}
            contentsBeingDragged={false}
            atom={atom}
            atoms={canvasItems.atoms}
            selected={isSelected(atom.id)}
            hidden={hidden.has(atom.id)}
            onSelect={(how) => selectAtom(atom.id, how)}
            groupFor={() => groupFor(atom.id)}
          />
        ))}
        {canvasItems.connections.map((connection, index) => {
          // Which sides an arrow joins depends on where the atoms sit. To an atom off to the right it leaves the
          // relation's dot and enters the left edge; to one off to the left it leaves the left edge of the box and enters
          // the right edge; to one above or below (columns overlapping) it runs between the bottom and top edges, so it
          // never cuts back across either atom. When two atoms share several connections, each later one lands a little
          // further along the target edge so they fan out instead of drawing on top of each other.
          const from = canvasItems.atoms.find((a) => a.id === connection.fromID);
          const to = canvasItems.atoms.find((a) => a.id === connection.toID);
          const fs = from ? dragShift(from.id) : { x: 0, y: 0 };
          const ts = to ? dragShift(to.id) : { x: 0, y: 0 };

          const fromLeft = (from?.left ?? 0) + fs.x;
          const fromTop = (from?.top ?? 0) + fs.y;
          const toLeft = (to?.left ?? 0) + ts.x;
          const toTop = (to?.top ?? 0) + ts.y;

          const side =
            !from || !to || from.id === to.id || toLeft >= fromLeft + ATOM_WIDTH ? "right"
            : toLeft + ATOM_WIDTH <= fromLeft ? "left"
            : toTop > fromTop ? "below" : "above";

          const sharedBefore = canvasItems.connections
            .slice(0, index)
            .filter((c) => c.fromID === connection.fromID && c.toID === connection.toID).length;
          const fan = (sharedBefore % 2 ? 1 : -1) * Math.ceil(sharedBefore / 2) * 16;

          const ends = {
            right: { start: "right", end: "left", offset: { x: 0, y: fan } },
            left: { start: "left", end: "right", offset: { x: 0, y: fan } },
            below: { start: "bottom", end: "top", offset: { x: fan, y: 0 } },
            above: { start: "top", end: "bottom", offset: { x: fan, y: 0 } },
          } as const;
          const { start, end, offset } = ends[side];

          // Selected on its own, or swept up with the atoms: both ends are in the atom selection.
          const inAtomSelection = selected.includes(connection.fromID) && selected.includes(connection.toID);
          const isSel = selectedConns.includes(connection.id) || inAtomSelection;
          const pick = (e: React.MouseEvent) => {
            selectConn(e, connection.id);
          };

          const highlight = theme.colors.yellow[4];
          const glow = isSel
            ? `drop-shadow(0 0 1px ${highlight}) drop-shadow(0 0 3px ${highlight})`
            : undefined;

          return (
            <div key={connection.id} data-conn-id={connection.id} style={{ display: "contents" }}>
              <Xarrow
                start={side === "right" ? connection.fromID + connection.label : connection.fromID.toString()}
                end={connection.toID.toString()}
                startAnchor={{ position: start, offset: { x: fs.x, y: fs.y } }}
                endAnchor={{ position: end, offset: { x: offset.x + ts.x, y: offset.y + ts.y } }}
                color={connection.connLabel.arityCount > 2 ? theme.colors.orange[5] : theme.colors.blue[5]}
                strokeWidth={4}
                arrowBodyProps={{ style: { cursor: "pointer", pointerEvents: "visibleStroke", filter: glow } }}
                arrowHeadProps={{ style: { cursor: "pointer", pointerEvents: "all", filter: glow } }}
                labels={{
                  middle: (
                    <span
                      style={{
                        background: theme.colors.dark[7], color: "white", padding: "0 4px", borderRadius: 4, fontSize: 12,
                        pointerEvents: "auto", cursor: "pointer",
                        outline: isSel ? `2px solid ${highlight}` : undefined,
                      }}
                    >
                      {connection.connLabel.label}
                    </span>
                  ),
                }}
              />
            </div>
          );
          // const start = {x: connection.from.left + AtomWidth, y: connection.from.top + AtomHeight / 2}
          // const end = {x: connection.to.left, y: (connection.to.top + AtomHeight / 2)}
          //
          // return <Arrow startPoint={start} endPoint={end}
          //        config={{ arrowColor: theme.colors.blue[5], strokeWidth: 5, }} />
        })}
      </div>
    );
  } else {
    // Loading items
    return (
      <div 
        ref={(node) => {
          canvasRef.current = node;
          drop(node);
        }} 
        className={"canvas"}
        style={{ zoom }}>
      </div>
    );
  }
}

export default Canvas;
