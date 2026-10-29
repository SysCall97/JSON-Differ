// JSON Tree Editor for VS Code
// A custom text editor: the .json file stays a normal text document (save,
// dirty state, undo/redo, git all work as usual); the webview shows it as a tree.
const vscode = require('vscode');

const VIEW_TYPE = 'jsonTreeEditor.tree';

class JsonTreeEditorProvider {
  constructor(context) {
    this.context = context;
  }

  async resolveCustomTextEditor(document, panel) {
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
    panel.webview.html = this.html(panel.webview, media);

    let applying = false;   // true while we write the webview's edit into the document

    const send = () => panel.webview.postMessage({ type: 'update', text: document.getText() });

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString() || e.contentChanges.length === 0) return;
      if (!applying) send();   // changed elsewhere (text editor, undo/redo, git…)
    });

    panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'ready':
          send();
          break;
        case 'edit': {
          if (msg.text === document.getText()) return;
          const edit = new vscode.WorkspaceEdit();
          const end = document.lineAt(document.lineCount - 1).range.end;
          edit.replace(document.uri, new vscode.Range(new vscode.Position(0, 0), end), msg.text);
          applying = true;
          try { await vscode.workspace.applyEdit(edit); } finally { applying = false; }
          break;
        }
        case 'undo':
          await vscode.commands.executeCommand('undo');
          break;
        case 'redo':
          await vscode.commands.executeCommand('redo');
          break;
        case 'openAsText':
          await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default', panel.viewColumn);
          break;
      }
    });

    panel.onDidDispose(() => changeSub.dispose());
  }

  html(webview, media) {
    const uri = (f) => webview.asWebviewUri(vscode.Uri.joinPath(media, f));
    const nonce = [...Array(32)].map(() => Math.random().toString(36)[2]).join('');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}' ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${uri('editor.css')}">
  <title>JSON Tree</title>
</head>
<body>
  <div class="bar">
    <span class="info" id="info"></span>
    <span class="spacer"></span>
    <button id="expandAll" title="Unfold every node">Expand all</button>
    <button id="collapseAll" title="Fold every node">Collapse all</button>
    <button id="openText" title="Reopen this file in the normal text editor">Open as Text</button>
  </div>
  <div class="banner" id="banner"><span id="bannerText"></span><button id="bannerClose">OK</button></div>
  <div id="tree"></div>
  <div class="invalid" id="invalid">
    <h2>Can't show this file as a tree</h2>
    <div id="invalidMsg"></div>
    <button id="invalidAction">Open as Text</button>
  </div>
  <div class="toast" id="toast"><span class="toast-dot"></span><span class="toast-msg"></span><button id="toastAction"></button></div>
  <script type="module" nonce="${nonce}" src="${uri('main.js')}"></script>
</body>
</html>`;
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new JsonTreeEditorProvider(context), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand('jsonTreeEditor.openAsTree', async (uri) => {
      uri = uri || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
      if (!uri) return vscode.window.showInformationMessage('Open a .json file first.');
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    }),
    vscode.commands.registerCommand('jsonTreeEditor.openAsText', async (uri) => {
      uri = uri || activeCustomUri();
      if (uri) await vscode.commands.executeCommand('vscode.openWith', uri, 'default');
    }),
  );
}

function activeCustomUri() {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  return tab && tab.input && tab.input.uri;
}

function deactivate() {}

module.exports = { activate, deactivate };
