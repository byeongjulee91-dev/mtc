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
    /** Numeric pane ID assigned by CenterPanel (used to track todo associations). */
    paneId: number;
    profile: Profile;
    /** This is the focused pane within its workspace. */
    active: boolean;
    /** This pane's workspace is the one currently shown (not a warm, hidden
     *  project). Hidden panes opt out of `bus.send`/broadcast and re-fit when
     *  shown again. Defaults to true so single-workspace callers need not pass it. */
    visible?: boolean;
    onexit?: () => void;
    /** Report this pane busy (streaming output) / idle, for the project panel's
     *  working indicator. Driven by the output idle timer below. */
    onbusy?: (busy: boolean) => void;
  }
  let { paneId, profile, active, visible = true, onexit, onbusy }: Props = $props();

  let host: HTMLDivElement;
  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let sessionId: number | null = null;
  let resizeObs: ResizeObserver | null = null;
  let ready = $state(false);
  let dragOver = $state(false);

  // --- resume-hint detection (the Resume chip) ---
  // On exit, claude prints `claude --resume <uuid>`. We surface it as a one-click
  // chip rather than auto-typing it into the prompt: that same string can appear
  // while claude is still *running* (it answers a "how do I resume?" question, or
  // a file/`history` containing it is printed), and we can't reliably tell that
  // the foreground is now a shell ready for input. A chip lets the user confirm
  // both intent and timing — and a false positive only shows a stray, dismissable
  // chip instead of writing a command into the wrong place. Detection runs for
  // every session (not just claude profiles) so it also catches `claude` launched
  // by hand in a plain shell; the indexOf gate below keeps that cheap.
  let resumeCmd = $state<string | null>(null);
  let resumeId = ''; // last id surfaced — suppresses re-showing the same hint
  let exited = $state(false); // PTY gone: a dead pane can't resume, so stop showing chips
  const SCAN_MAX = 2048; // rolling output window kept for the regex
  const resumeDecoder = new TextDecoder();
  let scanBuf = '';
  // Strip CSI sequences (colours/cursor moves) so they don't sit between the
  // characters of the hint. ESC [ params intermediates final-byte.
  const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
  const RESUME_RE =
    /claude\s+--resume\s+([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/;

  // Called for every output chunk. A cheap indexOf('--resume') gate keeps the
  // regex/ANSI-strip off the hot path — that substring is absent from virtually
  // all normal output, so >99% of chunks return on the first line below.
  function detectResume(bytes: Uint8Array) {
    if (exited) return;
    scanBuf += resumeDecoder.decode(bytes, { stream: true });
    if (scanBuf.length > SCAN_MAX) scanBuf = scanBuf.slice(-SCAN_MAX);
    if (scanBuf.indexOf('--resume') === -1) return;
    const m = scanBuf.replace(ANSI_RE, '').match(RESUME_RE);
    if (!m || m[1] === resumeId) return;
    resumeId = m[1];
    resumeCmd = `claude --resume ${m[1]}`;
  }

  // Chip clicked: type the resume command and submit it.
  // If the PTY is still alive (keepOpen=true, bash shell running): write directly
  // to the terminal session. term.focus() is intentionally skipped here — calling
  // it triggers xterm to emit a focus escape sequence (\x1b[I) which can land
  // in the PTY ahead of our command and corrupt the input line.
  // If the PTY is dead (keepOpen=false): copy to clipboard so the user can paste
  // into a new terminal. The chip stays visible until dismissed or pane closes.
  function runResume() {
    const cmd = resumeCmd;
    if (cmd === null) return;
    resumeCmd = null;
    if (!exited && sessionId !== null) {
      sendToSession(cmd, true);
    } else {
      void clipboardWriteText(cmd).catch(() => {});
    }
  }
  function dismissResume() {
    resumeCmd = null;
  }

  // TUI apps (claude, codex) detect pastes by timing: input that arrives in one
  // burst is treated as pasted text, so a trailing '\r' lands as a literal
  // newline in the input box instead of submitting. Sending text+'\r' in a
  // single write hits this intermittently (it only works when the PTY happens to
  // split them across reads). So write the text, let the app drain it, then send
  // the Enter on its own so it's read as a discrete submit keystroke.
  const ENTER_DELAY_MS = 75;

  // --- busy detection ---
  // "Busy" is *inferred* from raw PTY output — there's no signal from claude/codex
  // that says "I'm working", so a session producing output is treated as busy and
  // a silent one as idle. The hard part is that non-work UI events make a TUI
  // repaint its whole screen, and that repaint is output indistinguishable, byte
  // for byte, from real work. The worst case is switching projects: it flips a
  // pane's visibility (fit/SIGWINCH) and focus (focus-report restyle, DECSET 1004),
  // so claude/codex repaint and the project you just left would flash "busy".
  //
  // We separate the two by their *shape* rather than by timing windows (a window
  // can't know when a redraw will land): a repaint is a single short burst, while
  // real work streams output continuously for much longer. So we only declare a
  // pane busy once output has been *sustained* for BUSY_CONFIRM_MS — long enough
  // that a one-shot repaint never qualifies, short enough that genuine work lights
  // the dot promptly. A gap longer than BUSY_GAP_MS starts a fresh run, so a
  // repaint burst is always measured on its own and falls short of the bar.
  const BUSY_IDLE_MS = 700; // silence before a busy pane is called idle again
  const BUSY_CONFIRM_MS = 450; // output must be sustained this long to count as busy
  const BUSY_GAP_MS = 500; // a gap longer than this restarts the sustained-output run
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let isBusy = false;
  let runStart = 0; // when the current uninterrupted output run began
  let lastOutput = 0; // timestamp of the most recent output chunk

  // Called for every chunk of PTY output. Extends the current output run (or
  // starts a new one after a gap), flips to busy once that run is long enough to
  // rule out a repaint, and arms the idle timer that clears busy after silence.
  function noteOutput() {
    const now = Date.now();
    if (now - lastOutput > BUSY_GAP_MS) {
      runStart = now;
      // The previous run is over. A short fresh burst (e.g. a project-switch
      // repaint that lands while a just-finished session's idle timer is still
      // running) must NOT inherit that busy state, so drop it now — this run
      // re-confirms below only if it is itself sustained past BUSY_CONFIRM_MS.
      if (isBusy) {
        isBusy = false;
        onbusy?.(false);
      }
    }
    lastOutput = now;

    if (!isBusy && now - runStart >= BUSY_CONFIRM_MS) {
      isBusy = true;
      onbusy?.(true);
    }
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      runStart = 0;
      if (isBusy) {
        isBusy = false;
        onbusy?.(false);
      }
    }, BUSY_IDLE_MS);
  }

  function sendToSession(text: string, enter = false) {
    const id = sessionId;
    if (id === null) return;
    if (!enter) {
      void writeSession(id, text);
      return;
    }
    void (async () => {
      try {
        await writeSession(id, text);
        await new Promise((resolve) => setTimeout(resolve, ENTER_DELAY_MS));
        await writeSession(id, '\r');
      } catch {
        /* session closed mid-send — nothing left to submit */
      }
    })();
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
    // Record todo association when a todo was dragged onto this pane.
    if (bus.dragTodoIndex !== null) {
      bus.paneToTodo = { ...bus.paneToTodo, [paneId]: bus.dragTodoIndex };
    }
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
      bus.focusedPaneId = paneId;
    } else if (bus.send === sendToSession) {
      bus.send = () => {};
      bus.focusedShell = null;
      bus.focusedPaneId = null;
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
          detectResume(bytes);
        },
        onExit: () => {
          // PTY is gone. Keep any pending resumeCmd so the chip stays visible —
          // the user may still want to copy/resume in a new session. runResume
          // detects exited=true and falls back to clipboard instead of writing.
          exited = true;
          term?.writeln('\r\n\x1b[90m[process exited]\x1b[0m');
          onexit?.();
        },
      });
    } catch (e) {
      term.writeln('\x1b[31m  failed to start session: ' + String(e) + '\x1b[0m');
      return;
    }

    term.onData((d) => {
      // The user is typing/acting in this pane — any pending resume hint is now
      // stale, so hide the chip. (The chip's own click writes via writeSession,
      // not term input, so it never trips this.)
      if (resumeCmd !== null) resumeCmd = null;
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
    resizeObs?.disconnect();
    // Stop the idle timer and clear any lingering busy state so a pane that's
    // closed (or parked) mid-stream doesn't leave its project marked working.
    if (idleTimer) clearTimeout(idleTimer);
    if (isBusy) onbusy?.(false);
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

<div class="pane-term-wrap">
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
  {#if resumeCmd}
    <div class="resume-chip" class:dead={exited}>
      <button
        class="resume-run"
        onclick={runResume}
        title={exited ? `클립보드에 복사: ${resumeCmd}` : resumeCmd}
      >{exited ? '⎘ Copy Resume' : '↻ Resume'}</button>
      <button class="resume-x" onclick={dismissResume} aria-label="Resume 힌트 닫기" title="닫기">✕</button>
    </div>
  {/if}
</div>
