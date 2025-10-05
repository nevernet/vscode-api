import * as path from "path";
import { workspace, ExtensionContext } from "vscode";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient;

export function activate(context: ExtensionContext) {
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

  // 创建语言客户端并启动客户端
  client = new LanguageClient(
    "apiLanguageServer",
    "API Language Server",
    serverOptions,
    clientOptions
  );

  // 启动客户端，这也会启动服务器
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
