<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import type { Profile } from '../types';
  import { app } from '../state.svelte';
  import { bus } from '../bus.svelte';
  import { createSession, writeSession, resizeSession, closeSession } from '../api';

  interface Props {
    profile: Profile;
    active: boolean;
    onexit?: () => void;
  }
  let { profile, active, onexit }: Props = $props();

  let host: HTMLDivElement;
  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let sessionId: number | null = null;
  let resizeObs: ResizeObserver | null = null;
  let ready = $state(false);

  function sendToSession(text: string, enter = false) {
    if (sessionId !== null) void writeSession(sessionId, enter ? text + '\r' : text);
  }

  // The active pane owns the shared sender used by the side panels.
  $effect(() => {
    if (active && ready && term) {
      term.focus();
      bus.send = sendToSession;
    }
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

  // Ctrl + '=' / '+' to grow, Ctrl + '-' to shrink, Ctrl + '0' to reset.
  function onKey(e: KeyboardEvent): boolean {
    if (e.type !== 'keydown' || !e.ctrlKey) return true;
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
    if (sessionId !== null) void closeSession(sessionId);
    term?.dispose();
  });
</script>

<div class="pane-term" bind:this={host}></div>
