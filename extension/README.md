# RTDB Tree Editor (Chrome extension)

Adds a **Tree editor** tab to Realtime Database in the Firebase console, next to *Data · Rules · Backups · Usage*. It edits the data as a tree right inside the console, with no extra browser tab.

- Opening the tab loads the node you were viewing in *Data*.
- In the tree editor you can:
  - Add a child to an object or array (**+**), duplicate a node as its next sibling (**⧉**), or remove it (**−**).
  - Reorder array items by dragging an item's **⠿** handle up or down within its array.
  - Click a key or value to edit it.
  - Fold nodes, use undo/redo, switch to Text mode, and upload or download JSON.
- **Publish** shows a preview of the changes, then writes the JSON back to that path. The console updates live.
- **No separate sign-in.** The editor uses this console tab's session, so it can read and write exactly what you can in the console, nothing more.
- **Rollback.** Before every publish, the data that was on the server is saved as a snapshot. **History** lists the snapshots; load one and publish it to roll back.
- **Conflict-safe.** If the data changed on the server after you loaded it, you're asked before anything is overwritten.

## Install

Install from the Chrome Web Store: **[RTDB Tree Editor](https://chromewebstore.google.com/detail/rtdb-tree-editor/jhaiapddcbedapdpbghcbcdnfnfdhfbf)** → **Add to Chrome**. Updates install automatically.

Then reload any Firebase console tabs that were already open. There's no sign-in or setup.

<details>
<summary>Developers: load from source</summary>

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select this `extension` folder.
3. After changing files, click the reload icon on the extension's card, then reload the console tab.

Only one copy should be enabled at a time — disable the store version while testing a local one.
</details>

## Usage

1. In the Firebase console, open **Realtime Database → Data** and click into the node you want to edit.
2. Click the **Tree editor** tab next to *Data*. The extension's toolbar icon also toggles it.
3. Edit. The toolbar shows the number of unpublished changes in amber.
4. **Publish** (or ⌘/Ctrl+S), check the change list, and confirm. The *Data* tab shows the result live.
5. To undo a publish, click **Roll back** in the message that appears right after publishing, or open **History**, **Load** a snapshot, and **Publish** it.

Switching to *Data*, *Rules* or another tab hides the editor but keeps your edits. Open **Tree editor** again to continue. If you open it on a different node while you still have unpublished edits, those edits stay, and a message offers to load the new node.

The badge at the top right shows **Console session** when the editor has your session. Nothing needs to be set up: if the editor hasn't seen the session yet, it briefly makes the console's database connection reconnect, which takes a second or two. If it still can't get one, it shows **Reload page** and **Copy details** buttons; the details don't include credentials.

If the console's layout changes and the tab can't be added, a floating **{ } Tree editor** button appears at the bottom right instead.

Shortcuts: ⌘/Ctrl+Z undo · ⇧⌘Z / Ctrl+Y redo · ⌘/Ctrl+S publish.

## Live sync

The editor stays in step with Firebase:

- The **Live** chip in the toolbar means auto-sync is on. Changes made elsewhere (the console's *Data* tab, your app, a teammate) appear in the tree within a second, and the changed lines glow.
- If you have **unpublished edits**, they are never overwritten. A yellow bar says the node changed in Firebase, and you choose **Load latest** (discard your edits) or **Keep editing**. Publishing in that state shows the "changed on the server" warning, as before.
- If live updates aren't available, the chip shows **Auto-sync · 10 s** and the editor checks Firebase every 10 seconds instead.
- Click the chip to turn auto-sync off or on; the choice is remembered. **↻ Sync** (next to the path) refreshes immediately.

## How the session works

The console talks to Realtime Database with your signed-in credential. The extension looks **only at traffic going to `*.firebaseio.com` / `*.firebasedatabase.app`**, picks that credential up, and uses it for its own REST calls to the same database.

- The token is kept in `chrome.storage.session`. That is memory only: it's cleared when the browser closes, never written to disk, and never sent anywhere except your database.
- **Where it looks:** the session is picked up from the console's database connection inside the page, and from any request the console sends to the database hosts (seen by the background worker).
- **Expiry:** tokens expire after about an hour. When one expires, the editor gets a fresh one from the console automatically and retries.

## Snapshots (rollback)

- **When:** a snapshot of the server's data at the path is saved **before every publish**. That includes rollbacks, so you can roll forward again.
- **Where:** in the extension's local storage on this computer. They aren't synced or shared.
- **How many:** the newest 30 per database path are kept. Older ones are dropped automatically.
- **Using them:** History → **Load** puts a snapshot in the editor without publishing, so you can review it first. You can also **Download** a snapshot as a .json file or delete it.
- **Exact path only:** a snapshot covers only the path it was taken at. Rolling back `/users` does not touch `/config`.

## Notes

- **Publish replaces the whole node** at the path (HTTP `PUT`). Edit the smallest node you need: on the database root, publish replaces the entire database. The preview warns about this.
- **The server tidies data:** RTDB doesn't store empty objects/arrays or `null` values. After publishing, the editor reloads what the server actually stored and tells you if it differs.
- **Key rules:** Firebase keys can't contain `. # $ [ ] /`, and the editor blocks renames that use them.
- **Region:** if the database is outside us-central1, the URL is corrected automatically.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest |
| `session-capture.js` | Runs in the console page; picks up the console's RTDB session; can ask the connection to reconnect |
| `content.js/.css` | Adds the *Tree editor* tab to the console and places the editor under the tab bar; reads the DB URL and current path; relays the session |
| `background.js` | Watches requests to the DB hosts for the session; stores it in memory; sends the REST requests for the editor; toolbar icon |
| `panel.js/.css` | Editor UI (inside a shadow root on the console page): fetch, publish, conflicts, snapshots/rollback, settings |
| `tree-editor.js` | Tree component (duplicate, remove, edit, fold, undo/redo, animations) |
