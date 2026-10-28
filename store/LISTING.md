# Chrome Web Store submission — RTDB Tree Editor

Everything to paste into the Developer Dashboard, tab by tab.
Package to upload: `docs/rtdb-tree-editor.zip` (run `bash build-extension.sh` first).

---

## Package tab
Upload `docs/rtdb-tree-editor.zip`. The name, version, summary and icon come from `extension/manifest.json`.

## Store listing tab

**Name** (from manifest): RTDB Tree Editor

**Summary** (from manifest, max 132 characters):
> Edit Firebase Realtime Database data as a tree right in the console: add, duplicate, reorder, live sync, publish and roll back.

**Description:**
```
RTDB Tree Editor adds a "Tree editor" tab to the Realtime Database section of the Firebase console. Open any node and edit its JSON as a clear, foldable tree — then publish it back in one click.

WHAT YOU CAN DO
• Add a key/value pair (or array item) to any object or array with the + button
• Duplicate any node as its next sibling — great for copying levels, events or config entries
• Drag array items to reorder them, with smooth animations and edge auto-scroll
• Click any key or value to edit it inline (numbers, booleans, strings, objects…)
• Remove nodes, fold/unfold, undo/redo (⌘/Ctrl+Z), switch to raw JSON text
• Upload or download the node as a .json file

SAFE BY DESIGN
• Review every change (added / modified / removed) before it is written
• Conflict protection: if someone changed the data after you loaded it, you're asked before anything is overwritten
• Automatic snapshots before every publish — roll back any change from History
• Live sync: changes made elsewhere appear in the tree instantly; your unpublished edits are never overwritten

NO SETUP, YOUR OWN PERMISSIONS
There is nothing to sign in to or configure. The editor uses your existing Firebase console session, so it can read and write exactly what you can in the console — nothing more.

PRIVATE
No analytics, no tracking, no third-party servers. Your data only travels between your browser and your own Firebase database. Snapshots are stored locally on your computer.

Works in Chrome and other Chromium browsers (Edge, Brave). Not affiliated with or endorsed by Google or Firebase.
```

**Category:** Developer Tools
**Language:** English

**Graphic assets** (all in this `store/` folder):
| Field | File |
|---|---|
| Store icon (128×128) | `store-icon-128.png` |
| Screenshots (1280×800, in this order) | `1-tree-editor.png`, `2-add-key.png`, `3-drag-reorder.png`, `4-publish-preview.png`, `5-history-rollback.png` |
| Small promo tile (440×280, optional) | `small-promo-440x280.png` |

**Additional fields**
- Homepage URL: https://syscall97.github.io/JSON-Differ/
- Support URL: https://github.com/SysCall97/JSON-Differ/issues
- Mature content: No

## Privacy practices tab

**Single purpose description:**
```
Lets users view and edit Firebase Realtime Database data as an editable tree inside the Firebase console, and publish the changes back to their own database.
```

**Permission justifications:**

`storage`
```
Stores the user's auto-sync preference and the rollback snapshots saved before each publish, locally on the user's computer. The console session credential is kept only in chrome.storage.session (memory) and cleared when the browser closes.
```

`unlimitedStorage`
```
Rollback snapshots contain the previous data of the database node being edited; for large nodes these can exceed the default local storage quota. Snapshots never leave the user's computer.
```

`webRequest`
```
Observes (does not block or modify) requests that the Firebase console itself sends to Realtime Database hosts (*.firebaseio.com, *.firebasedatabase.app) to pick up the user's existing session credential, so the editor can read and write the database with exactly the user's own console permissions without a separate sign-in.
```

Host permission `https://console.firebase.google.com/*`
```
Adds the "Tree editor" tab to the Realtime Database page of the Firebase console, reads the database URL and the path the user is viewing, and shows the editor in place of the tab content.
```

Host permissions `https://*.firebaseio.com/*`, `https://*.firebasedatabase.app/*`
```
Reads the selected database path and writes the user's edits back through the Firebase Realtime Database REST API, and receives live change notifications for that path. These are the only servers the extension contacts.
```

**Are you using remote code?** No, I am not using remote code.
(All JavaScript is included in the package; nothing is loaded from a server or evaluated at runtime.)

**Data usage — what user data does the extension collect?**
Tick:
- [x] Authentication information — the user's Firebase console session credential, used only to call the user's own Realtime Database; kept in memory, never sent to the developer.
- [x] Website content — the database data the user opens, used only to display/edit it and write it back to the same database.

Leave everything else unticked.

Tick all three certifications:
- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://syscall97.github.io/JSON-Differ/privacy.html

## Distribution tab
- Visibility: **Public**
- Regions: All regions
- Pricing: Free

## Reviewer note (optional "notes for reviewer" / test instructions)
```
The extension only works on https://console.firebase.google.com for a project that has a Realtime Database. To test: open any Firebase project you own → Build → Realtime Database → Data, then click the new "Tree editor" tab. It loads the node shown in the Data tab. No separate login or test account is needed; it uses the reviewer's own console session.
```
