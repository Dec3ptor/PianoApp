import { useSyncExternalStore } from "react";
import type { Transport } from "../lib/transport";

/**
 * Reads a value derived from the transport. The transport notifies every
 * animation frame while playing, but the component only re-renders when the
 * selected value actually changes - so select primitives (numbers, strings,
 * booleans), e.g. `t => Math.floor(t.beat)` rather than `t => t.beat`.
 */
export function useTransportValue<T>(transport: Transport, select: (t: Transport) => T): T {
  const get = () => select(transport);
  return useSyncExternalStore(transport.subscribe, get, get);
}
