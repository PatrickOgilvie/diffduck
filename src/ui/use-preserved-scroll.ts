import { useLayoutEffect, useRef, type UIEvent } from "react";

/** Keep independent scroll positions without keeping hidden diff renderers mounted. */
export function usePreservedScroll(key: string) {
  const ref = useRef<HTMLDivElement | null>(null);
  const positions = useRef(new Map<string, { top: number; left: number }>());
  useLayoutEffect(() => {
    const position = positions.current.get(key);
    ref.current?.scrollTo({ top: position?.top ?? 0, left: position?.left ?? 0, behavior: "instant" });
  }, [key]);
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    positions.current.set(key, { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft });
  };
  return { ref, onScroll };
}
