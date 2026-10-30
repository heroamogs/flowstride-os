import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { clampFlowPanelWidth, DEFAULT_FLOW_PANEL_WIDTH, flowPanelBounds } from "../utils/flowPanelSize";
import "./ResizableFlowPanel.css";

interface Props {
  isOpen: boolean;
  preferredWidth: number;
  onWidthChange: (width: number) => void;
  children: ReactNode;
}

export function ResizableFlowPanel({ isOpen, preferredWidth, onWidthChange, children }: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const dragMovedRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    handle: HTMLDivElement;
  } | null>(null);
  const [containerWidth, setContainerWidth] = useState(Number.NaN);
  const [isDragging, setDragging] = useState(false);
  const { min, max } = flowPanelBounds(containerWidth);
  const width = clampFlowPanelWidth(preferredWidth, containerWidth);

  const finishDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
    setDragging(false);
  }, []);

  useLayoutEffect(() => {
    const container = panelRef.current?.parentElement;
    if (!container) return;
    const measure = () => setContainerWidth(container.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isOpen) finishDrag();
  }, [isOpen, finishDrag]);

  useEffect(() => {
    if (!isDragging) return;
    const { style } = document.body;
    const previousSelect = style.userSelect;
    const previousCursor = style.cursor;
    style.userSelect = "none";
    style.cursor = "col-resize";
    window.addEventListener("blur", finishDrag);
    return () => {
      style.userSelect = previousSelect;
      style.cursor = previousCursor;
      window.removeEventListener("blur", finishDrag);
    };
  }, [isDragging, finishDrag]);

  useEffect(() => () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
  }, []);

  const availableWidth = () => panelRef.current?.parentElement?.clientWidth ?? containerWidth;
  const changeWidth = (value: number) => onWidthChange(clampFlowPanelWidth(value, availableWidth()));

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || dragRef.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragMovedRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
      handle: event.currentTarget,
    };
    setDragging(true);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - drag.startX) > 3) dragMovedRef.current = true;
    changeWidth(drag.startWidth + event.clientX - drag.startX);
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const increment = event.shiftKey ? 50 : 10;
    const next = event.key === "ArrowLeft" ? width - increment
      : event.key === "ArrowRight" ? width + increment
      : event.key === "Home" ? min
      : event.key === "End" ? max
      : event.key === "Enter" ? DEFAULT_FLOW_PANEL_WIDTH
      : null;
    if (event.key === "Escape") { finishDrag(); return; }
    if (next === null) return;
    event.preventDefault();
    changeWidth(next);
  };

  return (
    <aside
      ref={panelRef}
      id="flowstride-test-flows"
      aria-label="Test flows"
      aria-hidden={!isOpen}
      style={{
        width: isOpen ? width : 0,
        transition: isDragging ? "none" : "width 0.2s ease",
        backgroundColor: "#0d1117",
        borderRight: isOpen ? "1px solid #30363d" : "none",
        flexShrink: 0,
        position: "relative",
      }}
    >
      <div style={{ width: "100%", height: "100%", overflow: "hidden", visibility: isOpen ? "visible" : "hidden" }}>
        {children}
      </div>
      {isOpen && (
        <div
          role="separator"
          aria-label="Resize test flows panel"
          aria-orientation="vertical"
          aria-controls="flowstride-test-flows"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={width}
          aria-valuetext={`${width} pixels`}
          tabIndex={0}
          className="flow-panel-divider"
          data-dragging={isDragging || undefined}
          title="Drag to resize. Arrow keys resize; Enter or double-click resets."
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={event => { if (dragRef.current?.pointerId === event.pointerId) finishDrag(); }}
          onPointerCancel={event => { if (dragRef.current?.pointerId === event.pointerId) finishDrag(); }}
          onLostPointerCapture={event => { if (dragRef.current?.pointerId === event.pointerId) finishDrag(); }}
          onKeyDown={resizeWithKeyboard}
          onContextMenu={event => event.preventDefault()}
          onDoubleClick={() => { if (!dragMovedRef.current) changeWidth(DEFAULT_FLOW_PANEL_WIDTH); }}
        />
      )}
      {isDragging && <div aria-hidden="true" data-flow-panel-drag-shield style={{ position: "fixed", inset: 0, zIndex: 10000, cursor: "col-resize" }} />}
    </aside>
  );
}
