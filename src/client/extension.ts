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

  // 注册命令
  const showIndexMenuCommand = commands.registerCommand(
    "api.showIndexMenu",
    async () => {
      const action = await window.showQuickPick(
        [
          {
            label: "$(sync) 重新索引所有文档",
            description: "扫描整个工作区并重新建立索引",
            action: "reindex",
          },
          {
            label: "$(refresh) 强制重置并重新索引",
            description: "强制重置所有状态，解决索引进度异常问题",
            action: "forceReset",
          },
          {
            label: "$(x) 取消当前索引",
            description: "停止正在进行的索引操作",
            action: "cancel",
          },
          {
            label: "$(trash) 清空索引缓存",
            description: "清除所有索引数据和缓存文件",
            action: "clear",
          },
          {
            label: "$(info) 查看索引状态",
            description: "显示当前索引状态和调试信息",
            action: "status",
          },
          {
            label: "$(emergency) 紧急停止",
            description: "立即停止所有索引操作（用于索引卡住时）",
            action: "emergency",
          },
          {
            label: "$(refresh) 绝对重启",
            description: "彻底重启索引系统，清除所有状态（最强重置）",
            action: "absolute",
          },
        ],
        {
          placeHolder: "选择索引操作",
          title: "API 索引管理",
        }
      );

      if (action) {
        switch (action.action) {
          case "reindex":
            // 确认重新索引
            const confirmReindex = await window.showWarningMessage(
              "重新索引将扫描整个工作区的所有 .api 文件，这可能需要一些时间。是否继续？",
              { modal: true },
              "是的，开始索引",
              "取消"
            );
            if (confirmReindex === "是的，开始索引") {
              commands.executeCommand("api.reindexAll");
            }
            break;
          case "forceReset":
            commands.executeCommand("api.forceResetAndReindex");
            break;
          case "cancel":
            commands.executeCommand("api.cancelIndexing");
            break;
          case "clear":
            // 确认清空索引
            const confirmClear = await window.showWarningMessage(
              "这将清空所有索引数据和缓存文件，您需要重新索引才能使用代码补全功能。是否继续？",
              { modal: true },
              "是的，清空索引",
              "取消"
            );
            if (confirmClear === "是的，清空索引") {
              commands.executeCommand("api.clearIndex");
            }
            break;
          case "status":
            commands.executeCommand("api.getIndexStatus");
            break;
          case "emergency":
            commands.executeCommand("api.emergencyStop");
            break;
          case "absolute":
            commands.executeCommand("api.absoluteRestart");
            break;
        }
      }
    }
  );

  const reindexCommand = commands.registerCommand(
    "api.reindexAll",
    async () => {
      updateStatusBar("indexing", "重新索引中...");
      try {
        await client.sendRequest("api/reindexAll");
        updateStatusBar("ready", "索引完成");
      } catch (error) {
        updateStatusBar("error", "索引失败");
        window.showErrorMessage(`重新索引失败: ${error}`);
      }
    }
  );

  const cancelIndexingCommand = commands.registerCommand(
    "api.cancelIndexing",
    async () => {
      try {
        await client.sendRequest("api/cancelIndexing");
        updateStatusBar("ready", "索引已取消");
      } catch (error) {
        window.showErrorMessage(`取消索引失败: ${error}`);
      }
    }
  );

  const clearIndexCommand = commands.registerCommand(
    "api.clearIndex",
    async () => {
      try {
        await client.sendRequest("api/clearIndex");
        updateStatusBar("ready", "索引已清空");
      } catch (error) {
        window.showErrorMessage(`清空索引失败: ${error}`);
      }
    }
  );

  const forceResetCommand = commands.registerCommand(
    "api.forceResetAndReindex",
    async () => {
      const confirm = await window.showWarningMessage(
        "这将强制重置所有索引状态并从头开始重新索引。如果您遇到索引进度异常的问题，请使用此功能。是否继续？",
        { modal: true },
        "是的，强制重置",
        "取消"
      );
      if (confirm === "是的，强制重置") {
        updateStatusBar("indexing", "强制重置中...");
        try {
          await client.sendRequest("api/forceResetAndReindex");
          updateStatusBar("indexing", "重置完成，正在重新索引...");
        } catch (error) {
          updateStatusBar("error", "强制重置失败");
          window.showErrorMessage(`强制重置失败: ${error}`);
        }
      }
    }
  );

  const getIndexStatusCommand = commands.registerCommand(
    "api.getIndexStatus",
    async () => {
      try {
        const status = (await client.sendRequest("api/getIndexStatus")) as any;
        const message = `
索引状态信息：
- 正在索引: ${status.isIndexing}
- 已取消: ${status.indexingCanceled}
- 总符号数: ${status.totalSymbols}
- 已处理文件: ${status.processedFilesCount}
- 失败文件: ${status.failedFilesCount}
- 最后处理: ${status.lastProcessedFile || "无"}
- 最后失败: ${status.lastFailedFile || "无"}

已处理文件（最近10个）:
${status.processedFiles?.slice(-10).join("\n") || "无"}

失败文件:
${status.failedFiles?.join("\n") || "无"}
        `;

        window.showInformationMessage("索引状态", {
          modal: true,
          detail: message.trim(),
        });
      } catch (error) {
        window.showErrorMessage(`获取索引状态失败: ${error}`);
      }
    }
  );

  const emergencyStopCommand = commands.registerCommand(
    "api.emergencyStop",
    async () => {
      const confirm = await window.showWarningMessage(
        "这将立即停止所有索引操作并重置状态。如果遇到索引卡住的问题，请使用此功能。是否继续？",
        { modal: true },
        "是的，立即停止",
        "取消"
      );
      if (confirm === "是的，立即停止") {
        try {
          await client.sendRequest("api/emergencyStop");
          updateStatusBar("idle", "紧急停止完成");
          window.showInformationMessage("所有索引操作已紧急停止");
        } catch (error) {
          updateStatusBar("error", "紧急停止失败");
          window.showErrorMessage(`紧急停止失败: ${error}`);
        }
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

  context.subscriptions.push(
    showIndexMenuCommand,
    reindexCommand,
    cancelIndexingCommand,
    clearIndexCommand,
    forceResetCommand,
    getIndexStatusCommand,
    emergencyStopCommand,
    absoluteRestartCommand
  );

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
  if (statusBarItem) {
    statusBarItem.dispose();
  }
  if (!client) {
    return undefined;
  }
  return client.stop();
}
