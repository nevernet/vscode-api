import * as path from "path";
import {
  workspace,
  ExtensionContext,
  window,
  commands,
  StatusBarAlignment,
  StatusBarItem,
} from "vscode";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient;
let statusBarItem: StatusBarItem;

export function activate(context: ExtensionContext) {
  // 创建状态栏项
  statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 100);
  statusBarItem.text = "$(sync~spin) API索引: 初始化中...";
  statusBarItem.tooltip = "点击打开索引管理菜单";
  statusBarItem.command = "api.showIndexMenu";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // 服务器模块路径
  const serverModule = context.asAbsolutePath(
    path.join("dist", "server", "server.js")
  );

  // 调试选项
  const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

  // 服务器选项
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions,
    },
  };

  // 客户端选项
  const clientOptions: LanguageClientOptions = {
    // 为API文档注册服务器
    documentSelector: [{ scheme: "file", language: "api" }],
    synchronize: {
      // 当工作区中的'.api'文件发生变化时通知服务器
      fileEvents: workspace.createFileSystemWatcher("**/.api"),
    },
  };

  // 创建语言客户端
  client = new LanguageClient(
    "apiLanguageServer",
    "API Language Server",
    serverOptions,
    clientOptions
  );

  // 注册命令 - 直接触发绝对重启
  const showIndexMenuCommand = commands.registerCommand(
    "api.showIndexMenu",
    async () => {
      // 确认重启
      const confirm = await window.showWarningMessage(
        "这将彻底重启索引系统，清除所有状态和缓存，然后重新开始索引。是否继续？",
        { modal: true },
        "是的，重启索引",
        "取消"
      );

      if (confirm === "是的，重启索引") {
        commands.executeCommand("api.absoluteRestart");
      }
    }
  );

  const absoluteRestartCommand = commands.registerCommand(
    "api.absoluteRestart",
    async () => {
      const confirm = await window.showWarningMessage(
        "这将彻底重启索引系统，清除所有状态和缓存，然后重新开始索引。这是最强的重置选项。是否继续？",
        { modal: true },
        "是的，绝对重启",
        "取消"
      );
      if (confirm === "是的，绝对重启") {
        try {
          updateStatusBar("indexing", "正在执行绝对重启...");
          await client.sendRequest("api/absoluteRestart");
          updateStatusBar("indexing", "绝对重启完成，正在重新索引");
          window.showInformationMessage("绝对重启完成，系统正在重新索引");
        } catch (error) {
          updateStatusBar("error", "绝对重启失败");
          window.showErrorMessage(`绝对重启失败: ${error}`);
        }
      }
    }
  );

  context.subscriptions.push(showIndexMenuCommand, absoluteRestartCommand);

  // 启动客户端并设置监听器
  client.start().then(() => {
    updateStatusBar("ready", "服务器已就绪");

    // 监听索引状态通知
    client.onNotification("api/indexingStatus", (params: any) => {
      updateStatusBar(params.status, params.message);
    });
  });
}

function updateStatusBar(status: string, message: string) {
  if (!statusBarItem) return;

  let icon = "$(search)";
  let color = "";

  switch (status) {
    case "indexing":
      icon = "$(sync~spin)";
      color = "#ffcc00";
      break;
    case "ready":
      icon = "$(check)";
      color = "#00ff00";
      break;
    case "error":
      icon = "$(error)";
      color = "#ff0000";
      break;
    case "idle":
      icon = "$(dash)";
      color = "#888888";
      break;
  }

  statusBarItem.text = `${icon} API索引: ${message}`;
  statusBarItem.color = color;
}

export function deactivate(): Thenable<void> | undefined {
  console.log("[CLIENT] 插件停用，开始清理资源");

  if (statusBarItem) {
    statusBarItem.dispose();
  }

  if (!client) {
    return undefined;
  }

  // 设置5秒超时，强制关闭客户端
  return Promise.race([
    client.stop(),
    new Promise<void>((resolve) => {
      setTimeout(() => {
        console.log("[CLIENT] 客户端停止超时，强制退出");
        resolve();
      }, 5000);
    }),
  ])
    .then(() => {
      console.log("[CLIENT] 客户端已停止");
    })
    .catch((error) => {
      console.error("[CLIENT] 停止客户端失败:", error);
    });
}
