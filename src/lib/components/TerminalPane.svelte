<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import type { Profile } from '../types';
  import type { Dir } from '../tiling';
  import { app } from '../state.svelte';
  import { bus, INSERT_DRAG_TYPE } from '../bus.svelte';
  import {
    createSession,
    writeSession,
    resizeSession,
    closeSession,
    clipboardReadText,
    clipboardWriteText,
  } from '../api';

  interface Props {
    profile: Profile;
    /** This is the focused pane within its workspace. */
    active: boolean;
    /** This pane's workspace is the one currently shown (not a warm, hidden
     *  project). Hidden panes opt out of `bus.send`/broadcast and re-fit when
     *  shown again. Defaults to true so single-workspace callers need not pass it. */
    visible?: boolean;
    onexit?: () => void;
    /**
     * Report this session's busy↔idle transitions: `true` when the PTY starts
     * emitting output, `false` once it goes quiet (see the idle timer below).
     * The tiling container forwards it to `PaneRuntime.setBusy` so the left
     * panel can show busy / idle session counts.
     */
    onbusy?: (busy: boolean) => void;
  }
  let { profile, active, visible = true, onexit, onbusy }: Props = $props();

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

  // --- busy / idle detection ---------------------------------------------
  // A session is "busy" while its PTY is emitting output — a streaming claude
  // response, an animated spinner (TUI apps redraw every ~100ms while working),
  // or a running command — and flips back to "idle" once output stays quiet for
  // IDLE_MS. The threshold sits comfortably above a spinner's redraw interval so
  // working sessions don't flicker, while still feeling responsive when a
  // response finishes and the prompt goes quiet. Local echo of typed input also
  // counts as activity, so a session reads busy briefly while you type into it.
  const IDLE_MS = 1200;
  let busy = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  function setBusy(next: boolean) {
    if (busy === next) return;
    busy = next;
    onbusy?.(next);
  }
  // Called on every chunk of PTY output: (re)arm the quiet timer and mark busy.
  function noteOutput() {
    setBusy(true);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => setBusy(false), IDLE_MS);
  }

  // --- copy / paste ---
  // xterm keeps its own selection layer (a hidden helper textarea + positioned
  // rows), so the WebView2 native "Copy" never sees it; we read the selection
  // ourselves. Returns whether there was anything to copy so right-click can fall
  // back to paste on an empty selection.
  async function copySelection(): Promise<boolean> {
    const sel = term?.getSelection() ?? '';
    if (!sel) return false;
    try {
      await clipboardWriteText(sel);
    } catch {
      /* clipboard unavailable — nothing useful to do */
    }
    return true;
  }

  // `term.paste()` (not a raw write) so bracketed-paste mode is honoured and the
  // text routes through the same onData → writeSession path as typing. In
  // standalone there is no PTY/onData, so echo locally to keep the preview usable.
  async function pasteClipboard() {
    let text = '';
    try {
      text = await clipboardReadText();
    } catch {
      return; // read blocked/empty — leave the terminal untouched
    }
    if (!text) return;
    if (sessionId !== null) term?.paste(text);
    else term?.write(text);
  }

  // Right-click mirrors Windows Terminal / PuTTY: copy when there's a selection
  // (and clear it as an "it copied" cue), otherwise paste. Suppress the native
  // context menu, which can't act on xterm's canvas selection anyway.
  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    void (async () => {
      if (await copySelection()) term?.clearSelection();
      else await pasteClipboard();
      term?.focus();
    })();
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
      bus.focusedShell = profile.shell;
    } else if (bus.send === sendToSession) {
      bus.send = () => {};
      bus.focusedShell = null;
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
  // xterm can't measure under display:none, so its dimensions are stale. Defer a
  // frame so the just-shown pane has been laid out — and so we coalesce with the
  // ResizeObserver's 0→size fire into a single resize instead of racing it — then
  // fit, push the new size down to the PTY, and pin the viewport to the bottom.
  // xterm resizes synchronously while the SIGWINCH (resizeSession) is async, so a
  // session that is still streaming can otherwise redraw against the new grid
  // before the child learns the new size, stranding its input box above stale
  // lines; re-pinning to the bottom keeps the prompt in view on return.
  $effect(() => {
    if (!visible || !ready || !term) return;
    let cancelled = false;
    const raf = requestAnimationFrame(async () => {
      if (cancelled || !term) return;
      safeFit();
      if (sessionId !== null) await resizeSession(sessionId, term.cols, term.rows);
      if (!cancelled) term?.scrollToBottom();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
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
        // Without an explicit colour the selection is near-invisible, which makes
        // "select then copy" hard to use. Blue mirrors VS Code's editor selection.
        selectionBackground: '#264f78',
        selectionInactiveBackground: '#264f7866',
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
        onData: (bytes) => {
          term?.write(bytes);
          noteOutput();
        },
        onExit: () => {
          term?.writeln('\r\n\x1b[90m[process exited]\x1b[0m');
          // An exited process can't be busy — drop it out of the busy count.
          clearTimeout(idleTimer);
          setBusy(false);
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
  // handling them): Alt+Arrow moves focus to the neighbouring pane, Alt+Shift+Arrow
  // resizes the focused pane (Windows Terminal style); Alt+Enter maximizes;
  // Alt+Shift++/- splits; Ctrl+W closes; Ctrl +/-/0 zooms the font.
  function onKey(e: KeyboardEvent): boolean {
    if (e.type !== 'keydown') return true;
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const dir = ARROW_DIR[e.key];
      if (dir) {
        e.preventDefault(); // also stop browser back/forward in standalone preview
        if (e.shiftKey) bus.resizeDir(dir);
        else bus.focusDir(dir);
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
    // Copy/paste. Plain Ctrl+C must stay SIGINT and plain Ctrl+V keeps xterm's own
    // textarea paste, so we only claim the Shift variants and the Insert combos.
    if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && (e.key === 'C' || e.key === 'c')) {
      e.preventDefault();
      void copySelection();
      return false;
    }
    if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && (e.key === 'V' || e.key === 'v')) {
      e.preventDefault();
      void pasteClipboard();
      return false;
    }
    if (e.key === 'Insert' && !e.altKey && !e.metaKey) {
      if (e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        void copySelection();
        return false;
      }
      if (e.shiftKey && !e.ctrlKey) {
        e.preventDefault();
        void pasteClipboard();
        return false;
      }
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
    clearTimeout(idleTimer);
    resizeObs?.disconnect();
    // If this pane owned the shared sender, clear it so panels don't write to
    // a closed session.
    if (bus.send === sendToSession) {
      bus.send = () => {};
      bus.focusedShell = null;
    }
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
  oncontextmenu={onContextMenu}
></div>
