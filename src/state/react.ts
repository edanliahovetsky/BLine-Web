import { useCallback, useSyncExternalStore } from "react";
import type { StoreApi } from "zustand/vanilla";

export function useStoreSelector<TState, TSelected>(
  store: StoreApi<TState>,
  selector: (state: TState) => TSelected
): TSelected {
  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(() => onStoreChange()),
    [store]
  );
  const getSnapshot = useCallback(() => selector(store.getState()), [selector, store]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
