// The external store behind selector reads (store-selector.ts): the provider
// publishes each state it renders here. Kept apart from store-selector.ts so
// store.tsx can provide it without importing the hooks, which read
// `useStore` from "./store" (a test that mocks the store reaches them there).
import { createContext, useLayoutEffect, useRef, type Dispatch } from "react";
import type { Action, AppState } from "./store";

/** What selector reads subscribe to: the latest rendered state and the store's dispatch. */
export interface StoreSource<S = AppState, A = Action> {
  getState(): S;
  subscribe(listener: () => void): () => void;
  dispatch: Dispatch<A>;
}

export interface PublishingStoreSource<S = AppState, A = Action> extends StoreSource<S, A> {
  /** Make `state` what getState returns, without telling anyone yet. */
  publish(state: S): void;
  /** Tell every subscriber to compare its selection again. */
  notify(): void;
  /** Forward `dispatch` to this function from now on (a scoped editor store may hand a new one). */
  setDispatch(dispatch: Dispatch<A>): void;
}

export function createStoreSource<S, A>(initial: S, dispatch: Dispatch<A>): PublishingStoreSource<S, A> {
  let state = initial;
  let send = dispatch;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    // stable identity; forwards to the dispatch of the latest render
    dispatch: (action) => send(action),
    publish(next) { state = next; },
    // a copy: a listener may unsubscribe while we call the others
    notify() { for (const listener of Array.from(listeners)) listener(); },
    setDispatch(next) { send = next; },
  };
}

export const StoreSourceContext = createContext<StoreSource | null>(null);

/** One source per provider, holding the state this render draws. Publishing
 * during render lets children rendered in the same pass read that state;
 * subscribers that did not render are told once the commit lands. */
export function usePublishedStoreSource(state: AppState, dispatch: Dispatch<Action>): StoreSource {
  const ref = useRef<PublishingStoreSource | null>(null);
  if (!ref.current) ref.current = createStoreSource(state, dispatch);
  const source = ref.current;
  source.publish(state);
  source.setDispatch(dispatch);
  useLayoutEffect(() => {
    // the committed state, in case a render that published another was dropped
    source.publish(state);
    source.notify();
  }, [source, state]);
  return source;
}
