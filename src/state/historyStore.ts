import { createStore, type StoreApi } from "zustand/vanilla";

export interface HistoryCommand<T> {
  description: string;
  apply(value: T): T;
  revert(value: T): T;
}

export interface HistoryTransition<T> {
  value: T;
  command: HistoryCommand<T> | null;
}

export interface HistoryStoreState<T> {
  undoStack: readonly HistoryCommand<T>[];
  redoStack: readonly HistoryCommand<T>[];
  canUndo: boolean;
  canRedo: boolean;
  execute(value: T, command: HistoryCommand<T>): T;
  undo(value: T): HistoryTransition<T>;
  redo(value: T): HistoryTransition<T>;
  clear(): void;
}

export type HistoryStore<T> = StoreApi<HistoryStoreState<T>>;

export function createHistoryStore<T>(): HistoryStore<T> {
  return createStore<HistoryStoreState<T>>((set, get) => ({
    undoStack: [],
    redoStack: [],
    canUndo: false,
    canRedo: false,
    execute(value, command) {
      const nextValue = command.apply(value);
      const undoStack = [...get().undoStack, command];

      set({
        undoStack,
        redoStack: [],
        canUndo: undoStack.length > 0,
        canRedo: false,
      });

      return nextValue;
    },
    undo(value) {
      const { undoStack, redoStack } = get();
      const command = undoStack.at(-1) ?? null;

      if (!command) {
        return { value, command: null };
      }

      const nextUndoStack = undoStack.slice(0, -1);
      const nextRedoStack = [...redoStack, command];

      set({
        undoStack: nextUndoStack,
        redoStack: nextRedoStack,
        canUndo: nextUndoStack.length > 0,
        canRedo: nextRedoStack.length > 0,
      });

      return {
        value: command.revert(value),
        command,
      };
    },
    redo(value) {
      const { undoStack, redoStack } = get();
      const command = redoStack.at(-1) ?? null;

      if (!command) {
        return { value, command: null };
      }

      const nextRedoStack = redoStack.slice(0, -1);
      const nextUndoStack = [...undoStack, command];

      set({
        undoStack: nextUndoStack,
        redoStack: nextRedoStack,
        canUndo: nextUndoStack.length > 0,
        canRedo: nextRedoStack.length > 0,
      });

      return {
        value: command.apply(value),
        command,
      };
    },
    clear() {
      set({
        undoStack: [],
        redoStack: [],
        canUndo: false,
        canRedo: false,
      });
    },
  }));
}
