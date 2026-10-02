"use client";

import { useCallback, useState } from "react";

export type UndoEntry = {
  label: string;
  undo: () => void;
};

const MAX_UNDO = 20;

export function useUndoStack() {
  const [stack, setStack] = useState<UndoEntry[]>([]);

  const pushUndo = useCallback((entry: UndoEntry) => {
    setStack((current) => [...current.slice(-(MAX_UNDO - 1)), entry]);
  }, []);

  const clearUndo = useCallback(() => setStack([]), []);

  const canUndo = stack.length > 0;
  const nextLabel = stack[stack.length - 1]?.label ?? "";

  const undo = useCallback(() => {
    setStack((current) => {
      if (!current.length) return current;
      const next = [...current];
      const entry = next.pop();
      queueMicrotask(() => entry?.undo());
      return next;
    });
  }, []);

  return { pushUndo, undo, canUndo, nextLabel, clearUndo, stackSize: stack.length };
}
