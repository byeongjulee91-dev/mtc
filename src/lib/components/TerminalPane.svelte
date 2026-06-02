<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import type { Profile } from '../types';
  import type { Dir } from '../tiling';
  import { app } from '../state.svelte';
  import { bus, INSERT_DRAG_TYPE } from '../bus.svelte';
  import { createSession, writeSession, resizeSession, closeSession } from '../api';

  interface Props {
    profile: Profile;
    /** This is the focused pane within its workspace. */
    active: boolean;
    /** This pane's workspace is the one currently shown (not a warm, hidden
     *  project). Hidden panes opt out of `bus.send`/broadcast and re-fit when
     *  shown again. Defaults to true so single-workspace callers need not pass it. */
    visible?: boolean;
    onexit?: () => void;
  }
  let { profile, active, visible = true, onexit }: Props = $props();

  let host: HTMLDivElement;
  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let sessionId: number | null = null;
  let resizeObs: ResizeObserver | null = null;
  let ready = $state(false);
  let dragOver = $state(false);

  function sendToSession(text: string, enter = false) {
    if (sessionId !== null) void writeSession(sessionId, enter ? text + '\r' : text);
  }

  // Accept todos/queries dragged from the side panel. Dropping inserts the text
  // into *this* session's input (no Enter) so it lands in the specific terminal
  // under the cursor rather than the focused one — and the user can edit/submit.
  // We gate on `bus.dragText` (set on dragstart) rather than the DataTransfer
  // MIME type, which WebView2 strips during dragover; `preventDefault()` here is
  // what turns the cursor from "no-drop" into a valid copy target.
  function onDragOver(e: DragEvent) {
    if (bus.dragText === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    dragOver = true;
  }
  function onDrop(e: DragEvent) {
    dragOver = false;
    const text = bus.dragText ?? e.dataTransfer?.getData(INSERT_DRAG_TYPE) ?? '';
    if (!text) return;
    e.preventDefault();
    term?.focus();
    if (sessionId !== null) sendToSession(text);
    // Standalone/no-backend (`npm run dev`): there is no PTY to write to, so
    // echo into the local xterm to make the drop visible while testing.
    else term?.write(text);
  }

  // The active *and* visible pane owns the shared sender used by the side
  // panels; otherwise it relinquishes ownership (guarded so we never clobber
  // another pane's claim). The guard makes the hand-off order-independent when
  // switching projects.
  $effect(() => {
    if (active && visible && ready && term) {
      term.focus();
      bus.send = sendToSession;
    } else if (bus.send === sendToSession) {
      bus.send = () => {};
    }
  });

  // Join the broadcast pool only while visible, so `sendAll` (e.g. /clear)
  // reaches just the active project's sessions — warm, hidden panes opt out.
  $effect(() => {
    if (!visible) return;
    bus.register(sendToSession);
    return () => bus.unregister(sendToSession);
  });

  // Re-fit when this pane's project becomes active again after being hidden:
  // xterm can't measure under display:none, so its dimensions are stale. (The
  // ResizeObserver also fires on the 0→size change, but this is deterministic.)
  $effect(() => {
    if (!visible || !ready || !term) return;
    safeFit();
    if (sessionId !== null) void resizeSession(sessionId, term.cols, term.rows);
  });

  onMount(async () => {
    term = new Terminal({
      fontFamily: 'ui-monospace, "Cascadia Code", "Consolas", monospace',
      fontSize: app.data.terminalFontSize,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: '#000000',
        foreground: '#d7dce5',
        cursor: '#00d7ff',
      },
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    // Intercept Ctrl +/-/0 before they reach the PTY so they zoom instead of
    // being sent to the shell. Returning false stops xterm from handling them.
    term.attachCustomKeyEventHandler(onKey);
    term.open(host);
    // Must be non-passive so preventDefault() can stop the browser's own
    // Ctrl+wheel page zoom.
    host.addEventListener('wheel', onWheel, { passive: false });
    safeFit();
    ready = true;

    if (app.standalone) {
      term.writeln('\x1b[33m  mtc terminal — desktop app required.\x1b[0m');
      term.writeln('  Run the Tauri app (e.g. `npm run tauri dev` on Windows) to');
      term.writeln('  spawn real WSL claude/codex sessions here.');
      return;
    }

    try {
      sessionId = await createSession(profile, term.cols, term.rows, {
        onData: (bytes) => term?.write(bytes),
        onExit: () => {
          term?.writeln('\r\n\x1b[90m[process exited]\x1b[0m');
          onexit?.();
        },
      });
    } catch (e) {
      term.writeln('\x1b[31m  failed to start session: ' + String(e) + '\x1b[0m');
      return;
    }

    term.onData((d) => {
      if (sessionId !== null) void writeSession(sessionId, d);
    });

    resizeObs = new ResizeObserver(() => {
      safeFit();
      if (term && sessionId !== null) void resizeSession(sessionId, term.cols, term.rows);
    });
    resizeObs.observe(host);
  });

  function safeFit() {
    try {
      fit?.fit();
    } catch {
      /* host not measurable yet */
    }
  }

  // Font size is shared across panes via app state. When it changes (from this
  // pane or another), apply it here, re-fit so the grid stays aligned, then push
  // the new cols/rows down to the PTY.
  $effect(() => {
    const size = app.data.terminalFontSize;
    if (!term || !ready) return;
    if (term.options.fontSize === size) return;
    term.options.fontSize = size;
    safeFit();
    if (sessionId !== null) void resizeSession(sessionId, term.cols, term.rows);
  });

  // Ctrl + wheel zooms the terminal font. Mutating shared state triggers the
  // $effect above on every pane.
  function onWheel(e: WheelEvent) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    app.adjustTerminalFontSize(e.deltaY < 0 ? 1 : -1);
  }

  const ARROW_DIR: Record<string, Dir | undefined> = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
  };

  // Intercept shortcuts before they reach the PTY (return false stops xterm from
  // handling them): Alt+Arrow moves focus to the neighbouring pane; Alt+Enter
  // maximizes; Alt+Shift++/- splits; Ctrl+W closes; Ctrl +/-/0 zooms the font.
  function onKey(e: KeyboardEvent): boolean {
    if (e.type !== 'keydown') return true;
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const dir = ARROW_DIR[e.key];
      if (dir) {
        e.preventDefault(); // also stop browser back/forward in standalone preview
        bus.focusDir(dir);
        return false;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        bus.toggleMax();
        return false;
      }
      // Use e.code (physical key) so Shift doesn't remap '-'→'_' / '='→'+':
      // Alt+Shift+= splits side-by-side, Alt+Shift+- splits stacked.
      if (e.shiftKey && e.code === 'Equal') {
        e.preventDefault();
        bus.splitDir('v');
        return false;
      }
      if (e.shiftKey && e.code === 'Minus') {
        e.preventDefault();
        bus.splitDir('h');
        return false;
      }
    }
    if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'w' || e.key === 'W')) {
      e.preventDefault();
      bus.closeFocused();
      return false;
    }
    if (!e.ctrlKey) return true;
    switch (e.key) {
      case '=':
      case '+':
        app.adjustTerminalFontSize(1);
        return false;
      case '-':
      case '_':
        app.adjustTerminalFontSize(-1);
        return false;
      case '0':
        app.resetTerminalFontSize();
        return false;
      default:
        return true;
    }
  }

  onDestroy(() => {
    host?.removeEventListener('wheel', onWheel);
    resizeObs?.disconnect();
    // If this pane owned the shared sender, clear it so panels don't write to
    // a closed session.
    if (bus.send === sendToSession) bus.send = () => {};
    bus.unregister(sendToSession);
    if (sessionId !== null) void closeSession(sessionId);
    term?.dispose();
  });
</script>

<div
  class="pane-term"
  class:drag-over={dragOver}
  bind:this={host}
  role="presentation"
  ondragover={onDragOver}
  ondragleave={() => (dragOver = false)}
  ondrop={onDrop}
></div>
