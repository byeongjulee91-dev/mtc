/**
 * A tiny shared bus so the side panels can act on the currently-focused
 * terminal pane without prop-drilling through the tiling tree. The focused
 * pane registers its sender here; panels call `bus.send(...)`.
 */
class Bus {
  /** Send text to the focused terminal session (optionally followed by Enter). */
  send: (text: string, enter?: boolean) => void = () => {};
  /** Whether at least one terminal pane is open. */
  hasFocus = $state(false);
}

export const bus = new Bus();
