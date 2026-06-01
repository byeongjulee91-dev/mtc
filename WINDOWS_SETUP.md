# Windows `tauri dev` 체크리스트

mtc를 Windows에서 처음 실행(`npm run tauri dev`)할 때 막히기 쉬운 지점들. 위에서
아래로 순서대로 확인하면 된다.

---

## 0. TL;DR (빠른 시작)

```powershell
# (Windows-네이티브 경로에서 — 아래 §2 참고)
cd C:\dev\mtc
npm install            # ★ Windows에서 새로 (WSL의 node_modules 재사용 금지)
npm run tauri dev      # vite + cargo 자동 실행, 핫리로드 창
```

처음 빌드는 Rust 의존성 컴파일로 수 분 걸린다(이후 캐시됨).

---

## 1. 사전 설치 (한 번만)

- [ ] **Rust (MSVC 툴체인)** — https://rustup.rs → `rustup default stable-msvc`
      확인: `rustc -V`, `cargo -V`
- [ ] **Visual Studio C++ Build Tools** — "Desktop development with C++" 워크로드
      (MSVC 링커 + Windows SDK). Tauri 빌드의 링크 단계에 필수.
- [ ] **Node.js ≥ 18** (LTS 권장) — 확인: `node -v`, `npm -v`
- [ ] **WebView2 Runtime** — Windows 11엔 기본 포함. 없으면 Evergreen Runtime 설치.
      (없으면 창이 안 뜨거나 흰 화면)
- [ ] **WSL + 배포판** — `wsl -l -v` 로 배포판과 버전 확인
      - [ ] `--cd` 옵션 지원 버전인지: 최신 WSL 권장 (`wsl --update`)
- [ ] **claude / codex 가 WSL 안에 설치**되어 있고 **로그인 셸 PATH에 잡히는지**
      (mtc는 `wsl.exe ... -- bash -lic "claude; ..."` 로 띄움 → 아래 §4가 핵심)
- [ ] Tauri 공식 사전요건 재확인: https://tauri.app/start/prerequisites/

---

## 2. 프로젝트 위치 선택 (중요)

프로젝트는 현재 WSL 경로(`~/project/mtc`)에 있다. Windows에서 빌드하는 두 가지 방법:

- **권장: Windows 네이티브 드라이브로 복사 후 빌드** (예: `C:\dev\mtc`)
  - [ ] `\\wsl$` / `\\wsl.localhost\` (9p 파일시스템) 위에서 직접 `cargo`/`vite`를
        돌리면 파일 감시(HMR)가 느리고, cargo의 target 경로/링커가 UNC 경로에서
        문제를 일으킬 수 있다.
  - 복사 시 `node_modules/`, `src-tauri/target/`, `dist/` 는 빼고 복사
    (`.gitignore` 기준 — 어차피 Windows에서 새로 생성).
- **대안: `\\wsl.localhost\<distro>\home\<you>\project\mtc` 에서 직접**
  - 동작은 하지만 느릴 수 있음. 빌드가 이상하면 §2 권장안으로 전환.

> git clone 으로 Windows에 받는 게 가장 깔끔: `git clone <repo> C:\dev\mtc`

---

## 3. 의존성 설치 (플랫폼별로 새로)

- [ ] **`npm install` 을 Windows에서 새로 실행** — WSL에서 만든 `node_modules` 를
      복사해 쓰지 말 것. `@tauri-apps/cli`, `esbuild`, `rollup` 등은 **플랫폼별
      네이티브 바이너리**라 Linux 빌드는 Windows에서 안 돈다.
- [ ] `src-tauri/target/` 도 마찬가지 — Windows가 자체적으로 새로 컴파일(자동).

---

## 4. claude/codex 가 WSL 세션에서 실제로 실행되는지 (제일 흔한 함정)

mtc 프로파일은 내부적으로 다음을 실행한다(Windows 분기, `src-tauri/src/profile.rs`):

```
wsl.exe [-d <distro>] [--cd <cwd>] -- bash -lic "<command>; exec bash -l"
```

→ **로그인 + 인터랙티브 bash(`-li`)** 에서 명령이 잡혀야 한다. 먼저 수동 검증:

- [ ] PowerShell에서: `wsl -- bash -lic "claude --version"` 가 동작하는가?
- [ ] codex도: `wsl -- bash -lic "codex --version"`
- [ ] 안 되면: claude/codex 설치 경로가 `~/.bashrc` 또는 `~/.profile` 의 PATH에
      들어가 있는지 확인 (nvm/asdf/volta 같은 버전매니저는 보통 `~/.bashrc`에서
      초기화됨 → `-i` 라서 잡히지만, 환경에 따라 `~/.bash_profile` 정리가 필요).
- [ ] 특정 배포판을 쓰면 프로파일의 **distro** 필드에 `wsl -l -q` 의 이름을 입력.
- [ ] 시작 디렉터리는 프로파일 **cwd** 에 WSL 경로(`~/work`, `/home/you/proj`)로.

> 팁: 우선 **"WSL Shell" 프로파일**(command 비움)로 먼저 띄워서 셸 진입 자체가
> 되는지 확인하고, 그 안에서 `claude` 를 직접 쳐보면 PATH 문제인지 바로 가려진다.

---

## 5. 실행 & 동작 확인

- [ ] `npm run tauri dev` → 창이 뜨고 3-패널 UI가 보이는가
      (상태바에 `WSL desktop` 표시 = 백엔드 연결됨; `browser preview` 면 Tauri
      아님)
- [ ] 중앙 상단 **프로파일 칩(Claude/Codex/WSL Shell)** 클릭 → 패널에 WSL 터미널
      뜨고 명령 실행되는가
- [ ] 터미널에 타이핑 → 입력 전달되는가 (한글/UTF-8, 방향키, Ctrl-C 등)
- [ ] **분할** ◧/⬓, **최대화/복원** ⛶, **닫기** ✕ 동작
- [ ] 좌측 **Query** 저장 후 `➤` → 포커스된 터미널로 텍스트 전송
- [ ] 우측 **Skills** → 루트 경로 추가 후 새로고침 → 목록, `↳`로 `/skill` 삽입
      - skill 루트는 WSL 안의 경로를 **UNC**로:
        `\\wsl.localhost\Ubuntu\home\<you>\.claude\skills`

---

## 6. 자주 나는 에러 & 해결

| 증상 | 원인 / 해결 |
| --- | --- |
| `error: linker 'link.exe' not found` | VS C++ Build Tools 미설치 → §1 |
| 빌드는 되는데 **흰 화면 / 창 안 뜸** | WebView2 Runtime 미설치 → 설치 |
| `'wsl.exe' ... not recognized` 또는 세션이 즉시 종료 | WSL 미설치/미활성 (`wsl --install`), 또는 distro 이름 오타 |
| 터미널 열리지만 `claude: command not found` | §4 — 로그인 셸 PATH 문제 |
| `--cd` 관련 오류 | 구버전 WSL → `wsl --update` |
| `Port 1420 is already in use` | 다른 vite/dev 프로세스 종료, 또는 `vite.config.ts`/`tauri.conf.json` 포트 변경 |
| `cargo`가 UNC 경로에서 실패/느림 | §2 — Windows 드라이브로 복사 후 빌드 |
| `npm run tauri dev`가 vite를 못 띄움 | `npm install` 을 Windows에서 다시 (§3) |
| 백신/Defender가 `target\debug\mtc.exe` 차단 | 개발 폴더 예외 등록 |
| 빌드 깨짐(이상한 캐시) | `cargo clean` (in `src-tauri/`) + `rd /s /q dist` 후 재시도 |

---

## 7. 배포본 빌드

```powershell
npm run tauri build
# 산출물: src-tauri\target\release\bundle\  (.msi / NSIS .exe)
```

- [ ] 코드서명은 별도 설정 필요(서명 없으면 SmartScreen 경고). MVP에선 생략 가능.

---

## 8. 아이콘 재생성 (필요 시)

```powershell
node scripts/gen-icon.mjs
npm run tauri icon app-icon.png   # src-tauri/icons/* 갱신
```

---

### 참고
- 아키텍처/내부 동작/확장 방법: `DEVELOPMENT.md`
- 사용자 가이드: `README.md`
- 이 레포는 Linux/WSL에서 개발·검증됨. **Windows 전용 경로(WebView2, `wsl.exe`
  스폰, 폴더 다이얼로그, UNC skill 루트)는 이 문서대로 Windows 호스트에서 확인**해야
  한다.
