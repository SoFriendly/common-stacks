# Common Stacks — Mobile Port Plan

A worked plan for taking the existing Tauri 2 desktop app to iOS and (later)
Android. Sized so another agent can execute it without back-and-forth.

> Project root: `/Users/jmitch/GitHub/common-stacks`. The current desktop
> build runs cleanly via `bun run tauri dev` on macOS. Tauri version `2.11`.

---

## Outcome

- `bun run tauri ios dev` launches Common Stacks in the iOS simulator and a
  user can: browse Mayberry/Gutenberg/SE, search, open a book, see metadata
  enrichment, download a file, and send a book to a Crosspoint Reader / the
  Kindle relay.
- A `bun run tauri android dev` launches an equivalent on Android.
- Desktop behavior is unchanged. All conditional logic for mobile vs
  desktop is platform-gated (`#[cfg(target_os = "ios")]` in Rust, runtime
  `os.platform()` checks in TypeScript) so the same source tree builds all
  three.
- No regressions to: OPDS browsing, search, downloads, send-to-Crosspoint,
  send-to-Kindle (the Cloudflare relay), enrichment, EPUB optimizer.
- Subprocess plugin loader is **disabled on iOS** (Apple sandbox forbids
  spawning executables) and **kept on Android**.
- Auto-updater is disabled on iOS (Apple disallows self-update). Android
  may keep the existing updater for sideload installs.

---

## Phase 0 — Survey, don't change anything yet (1–2 hours)

1. Run `bun run tauri ios init`. Inspect what's generated in
   `src-tauri/gen/apple/`. Commit the directory; revert if anything looks
   wrong.
2. Run `bun run tauri ios dev`. Note every visible breakage and every
   console error. Most likely failures:
   - macOS-only Tauri plugins refusing to load (`updater`, `process`).
   - Filesystem paths that don't exist (`~/Books/Common Stacks/`).
   - The drag-region div in `App.tsx` looking out of place.
   - `std::process::Command` calls panicking.
3. Same for `bun run tauri android init` + `dev` if Android Studio is set
   up. If not, defer Android until after iOS is solid.

The point of Phase 0 is the inventory: write down *every* concrete issue,
not vague impressions. Phase 1+ tackle them.

---

## Phase 1 — Make the Rust binary build for iOS (½ day)

Goal: compile + launch in the simulator. The UI may still look terrible,
but the binary stops crashing.

1. **Disable the updater on iOS** in `src-tauri/src/lib.rs`:

   ```rust
   #[cfg(not(any(target_os = "ios", target_os = "android")))]
   .plugin(tauri_plugin_updater::Builder::new().build())
   #[cfg(not(any(target_os = "ios", target_os = "android")))]
   .plugin(tauri_plugin_process::init())
   ```

   Same for the corresponding capability entries in
   `src-tauri/capabilities/default.json` — drop `core:window:allow-show`,
   `updater:default`, `process:*` for mobile. Easiest: create a new
   `src-tauri/capabilities/desktop.json` scoped to the desktop platforms,
   and a `mobile.json` for iOS/Android, instead of one default file.
   `tauri.conf.json` already supports this via the `tauri.json/security`
   shape — see the Tauri 2 docs for `capabilities/<file>` with `platforms`.

2. **Gate subprocess code paths.** Wrap every `std::process::Command::new`
   in `#[cfg(not(target_os = "ios"))]`. Affected files:
   - `src-tauri/src/commands.rs` — `open_download`, `reveal_download`,
     `reveal_plugins_dir`.
   - `src-tauri/src/plugins/loader.rs` — entire subprocess loader.

   Provide alternatives:
   - `open_download` on iOS: use Tauri's `opener` plugin or
     `UIApplication.shared.open(_:)` via a small Rust ↔ Swift FFI shim.
     For v1, just open the file with `UIDocumentInteractionController`
     (sheet to choose the target reader app).
   - `reveal_download` on iOS: no equivalent. Return an error like
     "Not supported on iOS — files are managed in the Books app." Or
     wire to the system Share sheet for the file.
   - `reveal_plugins_dir` on iOS: hide the button from the UI entirely.
     iOS users can't drop plugin folders into the app sandbox manually.

3. **Plugin loader on iOS**: have `register_user_plugins` short-circuit to
   `Vec::new()` when `cfg!(target_os = "ios")`. On Android, keep it but
   change `plugins_dir()` to use the app's external files dir
   (`Context.getExternalFilesDir(null)`), reachable from `Files` app for
   the user to populate.

4. **`config_dir()` and `default_download_dir()`** in `src-tauri/src/config.rs`
   need mobile branches. Both currently use `dirs::config_dir()` and
   `dirs::home_dir()`. On mobile, swap to Tauri's `app_local_data_dir`
   (config) and `app_data_dir` (downloads). Use `tauri::AppHandle::path()`
   methods, which means lifting `config_dir()`/`default_download_dir()`
   from free functions into something that has access to `AppHandle` —
   probably plumb the handle through `AppState`.

5. **Tauri `tauri.conf.json`**: add the iOS bundle bits:
   ```jsonc
   "bundle": {
     "iOS": {
       "developmentTeam": "<your team id>",
       "minimumSystemVersion": "15.0"
     }
   }
   ```
   And in `Info.plist` (path: `src-tauri/gen/apple/<app>/Info.plist`):
   - `NSLocalNetworkUsageDescription = "Common Stacks talks to Crosspoint Readers on your local Wi-Fi to send books."`
   - `NSBonjourServices` listing `_http._tcp.` for Crosspoint mDNS.
   - `NSAppTransportSecurity` allowing localhost HTTP if needed for the
     Crosspoint case (it talks HTTP, not HTTPS). Use a per-domain
     exception for `crosspoint.local`.

6. **Lettre on iOS**: the Kindle SMTP plugin uses `lettre` with rustls. On
   iOS, that links against system OpenSSL or the bundled rustls — verify
   the build succeeds. If it doesn't, gate the entire SMTP plugin
   (`KindleEmailTarget`) off on iOS. The Cloudflare relay plugin is the
   primary send path anyway.

End of phase: `tauri ios dev` boots, the Library tab loads books, no
crashes. UI looks like a desktop app shrunk to a phone — that's Phase 2.

---

## Phase 2 — Mobile-shaped UI (2–4 days)

Adapt the React frontend. Add a `useIsMobile()` hook in `src/lib/platform.ts`
that returns true when running on iOS or Android (via
`@tauri-apps/api/os.platform()`), false otherwise.

Replace or branch the following:

### Navigation

`src/components/ViewToggle.tsx` is fine on desktop but on mobile it should
become a bottom tab bar.

- Create `src/components/MobileTabBar.tsx`: bottom-anchored fixed bar with
  Library, Downloads, Settings tabs, each a `<NavLink>` with active
  state.
- In `App.tsx`, render `<MobileTabBar />` when mobile, `<ViewToggle />`
  embedded in route headers when desktop (the current setup).
- Remove the drag-region div on mobile (`{!isMobile && <div data-tauri-drag-region/>}`).

### Per-screen rework

- **Library** (`src/routes/Library.tsx`):
  - Top-right icon strip (refresh, settings) → a single overflow menu in
    the header, or move Refresh next to the search input.
  - Horizontal rails are touch-friendly already (overflow-x-auto), but
    the cover sizes (`w-36`) may feel small. Consider `w-32` on phones,
    `w-40` on tablets via Tailwind's breakpoints.
  - The search input is fine but ensure the keyboard doesn't obscure
    the results — add `pb-16` (room for the keyboard) on mobile.

- **Downloads** (`src/routes/Downloads.tsx`):
  - The `MoreHorizontal` button that opens a click-outside menu is awful
    on touch. Replace with a long-press gesture or a always-visible
    bottom-sheet action row.
  - Right-click context menu → long-press (use `react-use-gesture` or a
    custom `useLongPress` hook).
  - Grid vs List toggle works as-is.

- **Book detail** (`src/routes/Book.tsx`):
  - The current side-by-side cover + metadata layout collapses to
    stacked nicely with `flex-col` (already responsive).
  - Download buttons are fine as-is.

- **Settings** (`src/routes/Settings.tsx`):
  - All the disclosure rows work via tap.
  - Forms need larger hit targets — bump input padding from `py-2` to
    `py-3` on mobile.
  - **Hide "Open plugins folder"** on iOS (folder is unreachable by the
    user anyway).
  - **Hide the "Send-to (SMTP)" Kindle target** on iOS unless it builds —
    less of a setup nightmare for mobile users.

- **Send progress modal**: convert the fixed-width centered dialog into a
  bottom sheet on mobile. Slides up from the bottom. Tailwind: change
  positioning to `inset-x-0 bottom-0 rounded-t-2xl` on mobile.

### Touch ergonomics globally

- Every button: minimum 44×44 pt tap target (Apple HIG). Audit Tailwind
  classes — `h-9 w-9` (36 px) icon buttons should bump to `h-11 w-11` on
  mobile.
- Hover states: change `hover:` to `active:` on touch, or just keep
  hover and accept that taps don't trigger it (fine).
- Right-click handlers: replace with long-press.

### Status bar / safe areas

Use Tailwind's safe-area utilities or CSS env vars:

```css
.safe-top { padding-top: env(safe-area-inset-top); }
.safe-bottom { padding-bottom: env(safe-area-inset-bottom); }
```

Wrap the bottom tab bar in `safe-bottom`, the top header in `safe-top`.

---

## Phase 3 — Plugins on mobile (1 day)

The desktop subprocess plugin loader doesn't work on iOS. Decide policy
per platform:

- **iOS**: No user plugins in v1. Document this in `PLUGIN_DEVELOPMENT.md`.
  Future option: WebAssembly Component plugins via `wasmtime` (works on
  iOS but is non-trivial scaffolding).
- **Android**: Subprocess plugins technically work, but only if the
  binary is bundled with the app or downloaded to the app's data
  directory. Decide whether to expose this; probably defer to v2.

In `src-tauri/src/plugins/mod.rs`, change `register_user_plugins`:

```rust
fn register_user_plugins(&mut self) {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        return; // No user plugins on mobile in v1.
    }
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        let loaded = loader::load_all();
        ...
    }
}
```

Update the Plugins panel in `src/routes/Settings.tsx` to show a "User
plugins not available on this platform" message when mobile.

---

## Phase 4 — Crosspoint mDNS on iOS (½ day)

iOS gates Bonjour service discovery behind a per-app permission. The first
time `crosspoint.local` is resolved, iOS prompts the user.

1. Add to `Info.plist`:
   ```xml
   <key>NSLocalNetworkUsageDescription</key>
   <string>Common Stacks talks to a Crosspoint Reader on your local network to send books to it.</string>
   <key>NSBonjourServices</key>
   <array>
     <string>_http._tcp.</string>
     <string>_crosspoint._tcp.</string>
   </array>
   ```
2. Test in the simulator with a real Crosspoint on the LAN (the simulator
   shares the host's network).
3. If the first `reqwest` call to `crosspoint.local` fails because the
   user hasn't yet granted permission, show a friendlier error in the
   send modal (something like "Tap allow when iOS asks for local network
   access").

---

## Phase 5 — Filesystem on mobile (½ day)

Both platforms sandbox the app. Downloads can't go to `~/Books/Common Stacks/`.

1. **Determine the app data dir** at runtime via the Tauri `path` API:
   `app.path().app_data_dir()` (iOS Documents directory; Android internal
   storage).
2. Plumb an `AppHandle` into `AppState::new(handle)` so `config_dir()`
   and `default_download_dir()` can compute platform-correct paths.
3. **Expose downloads via the Files app** (iOS):
   - In `Info.plist`: `UISupportsDocumentBrowser = true`,
     `LSSupportsOpeningDocumentsInPlace = true`,
     `UIFileSharingEnabled = true`. This makes the app's Documents
     directory show up in the Files app under "On My iPhone → Common
     Stacks", so users can move books around manually.
4. **Android**: use the external files directory (no permission needed for
   scoped storage on Android 10+). Same Files-app-style integration via
   the system file picker.

---

## Phase 6 — Build + distribute (varies)

### iOS

1. **Apple Developer enrollment** ($99/year). Need this for TestFlight + App
   Store.
2. Generate signing identities in Xcode (Apple ID auto-handles for dev
   builds; manual for App Store).
3. Build: `bun run tauri ios build`. Produces a `.ipa`.
4. **TestFlight upload**: through Xcode's Organizer or Transporter. Beta
   testers get the app via the TestFlight app.
5. **App Store submission**: extra steps — privacy nutrition labels
   (declare network use, no analytics, no tracking), screenshots, App
   Review questionnaire. Common Stacks is borderline "reader app" by
   Apple's definitions; expect questions about how content is acquired.
   The OPDS-only design (no in-app purchase, no Amazon affiliate, no
   subscription) should clear review.

### Android

1. **Google Play Developer** ($25 one-time) for Play distribution. **F-Droid**
   is free and friendlier for an open-source app like this.
2. Build: `bun run tauri android build`. Produces a `.apk` and `.aab`.
3. **Direct distribution**: host the `.apk` somewhere and link from the
   project README. Users sideload.
4. **F-Droid submission**: PR to the F-Droid repo with a build recipe.
5. **Play submission**: AAB upload + Play Console listing.

---

## Concrete deliverables checklist

In rough execution order:

- [ ] `bun run tauri ios init` committed.
- [ ] Updater + process plugins disabled on iOS in `lib.rs` + capabilities.
- [ ] Subprocess code paths in `commands.rs` cfg-gated.
- [ ] `loader.rs` cfg-gated; user plugins disabled on iOS.
- [ ] `config.rs` paths use `AppHandle::path()` on mobile.
- [ ] Build succeeds: `bun run tauri ios build`.
- [ ] App launches in simulator, Library loads.
- [ ] `useIsMobile()` hook in `src/lib/platform.ts`.
- [ ] `MobileTabBar` component + conditional render in `App.tsx`.
- [ ] Long-press gestures replace right-click on Downloads.
- [ ] Send modal becomes a bottom sheet on mobile.
- [ ] Safe-area insets respected.
- [ ] `Info.plist` has Bonjour entries + NSLocalNetworkUsageDescription.
- [ ] `UIFileSharingEnabled` etc. so users see downloads in Files app.
- [ ] First Crosspoint send works from iOS.
- [ ] First Kindle-relay send works from iOS.
- [ ] First book download works from iOS, opens via Share sheet.
- [ ] TestFlight build submitted (gate behind real device test first).
- [ ] Android equivalents complete.

---

## Things to **not** do in v1

- Plugin marketplace / in-app plugin install. Phase 3 disables user
  plugins on iOS; that's the v1 answer.
- Sandboxed WASM plugin runtime. Tracked as v2.
- Background downloads / sync. Tauri's task model doesn't expose iOS
  BGAppRefreshTask cleanly yet. Sync = "user-initiated only" for v1.
- Watch / TV / etc. App Store branches.
- iCloud sync of config. The user's downloaded books are intentionally
  not synced (privacy + cost). If desired later, use `NSUbiquitous`
  containers — but that's its own project.

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| `lettre` + rustls fails to build for iOS target | Medium | Lose Kindle SMTP on iOS | Gate the plugin off on iOS; recommend Kindle relay instead. |
| App Store rejection ("reader app" rules) | Medium | Can't ship to App Store | Be ready to argue: no DRM bypass, no paid content sold, OPDS is a public open protocol. Worst case ship via TestFlight only or sideload. |
| Local network permission UX confuses users | Medium | Crosspoint feature unusable on first try | Add a one-time onboarding card explaining the prompt. |
| Tauri 2 mobile bugs (still maturing) | Medium | Random crashes, debugging burden | Pin to the latest stable Tauri minor; file issues upstream. |
| Bundle size on iOS (rustls + image + lettre + zip) | Low | App takes longer to download | Profile with `cargo bloat`; drop unused features. |
| EPUB optimizer OOM on a 4 GB device | Low | One specific user-flow fails | Document a max file size in the optimizer; reject ahead of time. |

---

## What to send back

When you're done, the deliverables back to me (or whoever picks this up
next) should be:

1. A commit (or branch) implementing every checklist item above.
2. A short `docs/MOBILE_STATUS.md` capturing:
   - Which checklist items are done / blocked / skipped.
   - Screenshots of the iOS simulator on Library, Book, Downloads,
     Settings, Send modal.
   - Build commands that worked.
   - Any deviations from this plan and why.
3. A TestFlight invite (or `.ipa` + sideload instructions) so I can run it
   on a real device.

The plan is intentionally opinionated — if you hit something that
genuinely needs a different approach, change it and document why in
`MOBILE_STATUS.md`. Don't ask for clarification on small choices; just
make them.
