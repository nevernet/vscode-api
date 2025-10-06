import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  InitializeResult,
  Location,
  Position,
  Range,
  DocumentFormattingParams,
  TextEdit,
  DocumentSymbol,
  SymbolKind as LSPSymbolKind,
  DocumentSymbolParams,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ApiLexer } from "./lexer";
import { ApiParser, ParseError } from "./parser";
import {
  SymbolTable,
  SymbolCollector,
  Symbol,
  SymbolKind,
  getBuiltinSymbols,
  KEYWORDS,
  CONSTANTS,
} from "./symbols";
import {
  CompletionIndex,
  analyzeCompletionContext as analyzeSmartCompletionContext,
} from "./completion-index";

// 进程监控和唯一性检查
const PROCESS_START_TIME = Date.now();
const PROCESS_PID = process.pid;

console.log(
  `[PROCESS] API语言服务器启动 - PID: ${PROCESS_PID}, 启动时间: ${new Date().toISOString()}`
);

// 检查并杀死其他API语言服务器进程
async function enforceProcessUniqueness() {
  try {
    const { exec } = require("child_process");

    // 使用更精确的进程查找命令
    const searchPatterns = [
      'ps aux | grep "dist/server/server.js"',
      'ps aux | grep "api.*language.*server"',
    ];

    for (const pattern of searchPatterns) {
      try {
        const result = await new Promise<string>((resolve, reject) => {
          exec(pattern, { timeout: 5000 }, (error: any, stdout: string) => {
            if (error && error.code !== 1) {
              // code 1 means no matches, which is ok
              reject(error);
            } else {
              resolve(stdout || "");
            }
          });
        });

        const lines = result
          .split("\n")
          .filter(
            (line) =>
              line.length > 0 &&
              !line.includes("grep") &&
              !line.includes(`${PROCESS_PID}`) &&
              (line.includes("server.js") ||
                line.includes("api") ||
                line.includes("language"))
          );

        if (lines.length > 0) {
          console.log(
            `[PROCESS] 发现 ${lines.length} 个可能的其他API语言服务器进程`
          );

          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length > 1) {
              const pid = parseInt(parts[1]);
              if (pid && pid !== PROCESS_PID && !isNaN(pid)) {
                console.log(`[PROCESS] 尝试杀死旧进程 PID: ${pid}`);
                try {
                  // 先尝试SIGTERM，给进程机会优雅退出
                  process.kill(pid, "SIGTERM");

                  // 500毫秒后使用SIGKILL强制杀死
                  setTimeout(() => {
                    try {
                      process.kill(pid, 0); // 检查进程是否还存在
                      console.log(
                        `[PROCESS] 进程 ${pid} 未响应SIGTERM，使用SIGKILL`
                      );
                      process.kill(pid, "SIGKILL");
                    } catch (e) {
                      // 进程已经退出，这是期望的结果
                    }
                  }, 500);
                } catch (e) {
                  console.log(`[PROCESS] 进程 ${pid} 可能已经退出`);
                }
              }
            }
          }
        } else {
          console.log(
            `[PROCESS] 未发现其他API语言服务器进程，当前PID: ${PROCESS_PID}`
          );
        }
      } catch (error) {
        // 继续下一个搜索模式
        console.log(`[PROCESS] 搜索模式 "${pattern}" 失败:`, error);
      }
    }
  } catch (error) {
    console.log(`[PROCESS] 进程唯一性检查失败:`, error);
  }
}

// 启动时执行进程唯一性检查
enforceProcessUniqueness();

// 监控进程状态
let processShutdownInitiated = false;
function logProcessInfo() {
  const uptime = Date.now() - PROCESS_START_TIME;
  const memUsage = process.memoryUsage();
  console.log(
    `[PROCESS] PID: ${PROCESS_PID}, 运行时间: ${Math.round(
      uptime / 1000
    )}s, 内存: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`
  );
}

// 每30秒记录一次进程状态
setInterval(logProcessInfo, 30000);

// 检查是否有其他同类进程
function checkForDuplicateProcesses() {
  try {
    const { execSync } = require("child_process");
    const result = execSync(
      'ps aux | grep "api.*language.*server" | grep -v grep',
      { encoding: "utf8" }
    );
    const lines = result
      .trim()
      .split("\n")
      .filter((line: string) => line.length > 0);

    if (lines.length > 1) {
      console.warn(`[PROCESS] 检测到 ${lines.length} 个API语言服务器进程:`);
      lines.forEach((line: string) => console.warn(`[PROCESS] ${line}`));
    }
  } catch (error) {
    // 忽略错误，进程检查失败不影响正常运行
  }
}

// 启动时检查重复进程
setTimeout(checkForDuplicateProcesses, 2000);

// 配置接口
interface ApiLanguageServerSettings {
  maxNumberOfProblems: number;
  format: {
    enable: boolean;
    indentSize: number;
    alignFields: boolean;
  };
}

// 创建服务器连接
const connection = createConnection(ProposedFeatures.all);

// 创建文档管理器
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// 全局符号表
const globalSymbolTable = new SymbolTable();

// 代码补全索引
const completionIndex = new CompletionIndex(globalSymbolTable);

// 缓存配置
let workspaceRoot: string | null = null;
const CACHE_VERSION = "1.0.0"; // 缓存版本，用于兼容性检查

// 索引进度跟踪
let processedFiles: string[] = []; // 已处理的文件列表
let failedFiles: string[] = []; // 失败的文件列表

// 获取缓存目录和文件路径
function getCachePaths() {
  if (!workspaceRoot) {
    return null;
  }
  const CACHE_DIR = path.join(workspaceRoot, ".api");
  const SYMBOL_CACHE_FILE = path.join(CACHE_DIR, "symbols.cache.index");
  const COMPLETION_CACHE_FILE = path.join(CACHE_DIR, "completions.cache.index");

  return {
    CACHE_DIR,
    SYMBOL_CACHE_FILE,
    COMPLETION_CACHE_FILE,
  };
}

// 默认设置
const defaultSettings: ApiLanguageServerSettings = {
  maxNumberOfProblems: 100,
  format: {
    enable: true,
    indentSize: 2,
    alignFields: true,
  },
};
let globalSettings: ApiLanguageServerSettings = defaultSettings;

// 文档设置缓存
const documentSettings: Map<
  string,
  Thenable<ApiLanguageServerSettings>
> = new Map();

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  // 设置工作区根路径
  if (params.workspaceFolders && params.workspaceFolders.length > 0) {
    workspaceRoot = params.workspaceFolders[0].uri.replace("file://", "");
  } else if (params.rootUri) {
    workspaceRoot = params.rootUri.replace("file://", "");
  } else if (params.rootPath) {
    workspaceRoot = params.rootPath;
  }

  // 检查客户端是否支持工作区配置
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // 告诉客户端服务器支持代码补全
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: [".", " "],
      },
      // 支持跳转到定义
      definitionProvider: true,
      // 支持查找引用
      referencesProvider: true,
      // 支持悬停信息
      hoverProvider: true,
      // 支持文档格式化
      documentFormattingProvider: true,
      // 支持文档符号（Go to Symbol）
      documentSymbolProvider: true,
    },
  };

  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }

  return result;
});

connection.onInitialized(() => {
  try {
    console.log(`[INIT] 索引系统状态: ${INDEXING_ENABLED ? "启用" : "禁用"}`);

    if (hasConfigurationCapability) {
      // 注册配置变更
      connection.client.register(
        DidChangeConfigurationNotification.type,
        undefined
      );
    }
    if (hasWorkspaceFolderCapability) {
      connection.workspace.onDidChangeWorkspaceFolders((_event) => {
        connection.console.log("Workspace folder change event received.");
        // 工作区变更时重新索引所有文档
        if (INDEXING_ENABLED) {
          try {
            createManagedTimeout(() => {
              indexAllDocuments();
            }, 1000); // 延迟1秒，确保文档已加载
          } catch (error) {
            console.error("[INIT] 工作区变更处理失败:", error);
          }
        } else {
          console.log("[INIT] 索引系统已禁用，跳过工作区索引");
        }
      });
    }

    // 初始化时先尝试加载缓存，如果失败再索引所有已打开的文档
    if (INDEXING_ENABLED) {
      createManagedTimeout(async () => {
        try {
          console.log("[INIT] 开始加载缓存或索引工作区...");
          const cacheLoaded = await loadCacheFromFile();
          if (!cacheLoaded) {
            console.log("[INIT] 缓存未找到或已过期，开始全量索引...");
            indexAllDocuments();
          } else {
            console.log("[INIT] 缓存加载成功，代码补全已可用");
            notifyIndexingStatus("idle", "缓存加载完成，代码补全已就绪");
          }
        } catch (error) {
          console.error("[INIT] 缓存加载失败:", error);
          // 即使缓存加载失败，也尝试索引
          try {
            indexAllDocuments();
          } catch (indexError) {
            console.error("[INIT] 索引失败:", indexError);
          }
        }
      }, 500); // 减少延迟到500ms，更快开始索引
    } else {
      console.log("[INIT] 索引系统已禁用，跳过初始索引");
      notifyIndexingStatus("idle", "索引系统已禁用");
    }
  } catch (error) {
    console.error("[INIT] 初始化失败:", error);
  }
});

// 配置变更处理
connection.onDidChangeConfiguration((change) => {
  if (hasConfigurationCapability) {
    // 重置所有缓存的文档设置
    documentSettings.clear();
  } else {
    globalSettings = <ApiLanguageServerSettings>(
      (change.settings.apiLanguageServer || defaultSettings)
    );
  }

  // 重新验证所有打开的文档
  documents.all().forEach(validateTextDocument);

  // 重新索引所有文档，确保符号表是最新的
  if (INDEXING_ENABLED) {
    createManagedTimeout(() => {
      indexAllDocuments();
    }, 500);
  } else {
    console.log("[CONFIG] 索引系统已禁用，跳过配置变更后的索引");
  }
});

function getDocumentSettings(
  resource: string
): Thenable<ApiLanguageServerSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings);
  }
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: "apiLanguageServer",
    });
    documentSettings.set(resource, result);
  }
  return result;
}

// 文档关闭时清理设置
documents.onDidClose((e) => {
  documentSettings.delete(e.document.uri);

  // 清理该文档的定时器
  const existingTimer = documentIndexTimers.get(e.document.uri);
  if (existingTimer) {
    clearTimeout(existingTimer);
    documentIndexTimers.delete(e.document.uri);
  }

  // 清理保存状态
  savingDocuments.delete(e.document.uri);

  console.log(`[DOC_CLOSE] 清理文档资源: ${e.document.uri}`);
});

// 追踪保存状态，避免在保存期间进行索引
let savingDocuments = new Set<string>();

// 追踪文档索引定时器，避免重复索引
let documentIndexTimers = new Map<string, NodeJS.Timeout>();

// 追踪全局定时器，用于清理
let globalTimers = new Set<NodeJS.Timeout>();

// 清理所有定时器的函数
function clearAllTimers() {
  console.log(`[CLEANUP] 开始清理所有定时器和异步任务...`);

  // 1. 清理全局定时器
  console.log(`[CLEANUP] 清理 ${globalTimers.size} 个全局定时器`);
  globalTimers.forEach((timer) => clearTimeout(timer));
  globalTimers.clear();

  // 2. 清理文档索引定时器
  console.log(`[CLEANUP] 清理 ${documentIndexTimers.size} 个文档定时器`);
  documentIndexTimers.forEach((timer) => clearTimeout(timer));
  documentIndexTimers.clear();

  // 3. 停止正在运行的索引进程
  if (isIndexing) {
    console.log(`[CLEANUP] 检测到正在运行的索引进程，设置取消标志`);
    indexingCanceled = true;
    // 注意：不直接设置 isIndexing = false，让索引任务自己检测并停止
    // 这样可以确保任务有机会清理自己的状态
  }

  console.log(`[CLEANUP] 定时器和异步任务清理完成`);
}

// 强制清理所有运行中的任务和状态（用于紧急停止）
function forceCleanupAll() {
  console.log(`[FORCE_CLEANUP] 开始强制清理所有任务和状态...`);

  // 1. 先调用常规清理
  clearAllTimers();

  // 2. 强制停止索引进程（不等待任务自己停止）
  if (isIndexing) {
    console.log(`[FORCE_CLEANUP] 强制停止索引进程`);
    isIndexing = false;
    indexingCanceled = false; // 重置取消标志
  }

  // 3. 清理进度跟踪
  if (processedFiles.length > 0 || failedFiles.length > 0) {
    console.log(
      `[FORCE_CLEANUP] 清理进度跟踪 (已处理: ${processedFiles.length}, 失败: ${failedFiles.length})`
    );
    processedFiles = [];
    failedFiles = [];
  }

  console.log(`[FORCE_CLEANUP] 强制清理完成`);
}

// 创建可追踪的setTimeout
function createManagedTimeout(
  callback: () => void,
  delay: number
): NodeJS.Timeout {
  const timer = setTimeout(() => {
    callback();
    globalTimers.delete(timer);
  }, delay);
  globalTimers.add(timer);
  return timer;
}

// 文档内容变更时验证和索引
documents.onDidChangeContent((change) => {
  // 如果文档正在保存，跳过索引
  if (savingDocuments.has(change.document.uri)) {
    console.log(`[INDEX_DOC] 跳过保存中的文档索引: ${change.document.uri}`);
    return;
  }

  // 清除该文档之前的索引定时器
  const existingTimer = documentIndexTimers.get(change.document.uri);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // 自动索引文档（异步，不阻塞）
  const timer = setTimeout(() => {
    // 再次检查是否在保存中
    if (!savingDocuments.has(change.document.uri)) {
      indexDocument(change.document);
    }
    // 清除已完成的定时器
    documentIndexTimers.delete(change.document.uri);
  }, 100); // 延迟100ms，避免频繁的输入导致性能问题

  // 保存新的定时器
  documentIndexTimers.set(change.document.uri, timer);

  validateTextDocument(change.document);
});

// 文档保存开始时
documents.onWillSave((event) => {
  console.log(`[DOC_SAVE] 文档开始保存: ${event.document.uri}`);
  savingDocuments.add(event.document.uri);
});

// 文档保存完成后
documents.onDidSave?.((event) => {
  console.log(`[DOC_SAVE] 文档保存完成: ${event.document.uri}`);
  savingDocuments.delete(event.document.uri);

  // 保存完成后重新索引
  if (INDEXING_ENABLED) {
    createManagedTimeout(() => {
      indexDocument(event.document);
    }, 50);
  } else {
    console.log(`[DOC_SAVE] 索引系统已禁用，跳过索引`);
  }
});

// 文档打开时索引
documents.onDidOpen((event) => {
  // 立即索引新打开的文档
  if (INDEXING_ENABLED) {
    indexDocument(event.document);
  } else {
    console.log(`[DOC_OPEN] 索引系统已禁用，跳过索引: ${event.document.uri}`);
  }
  // 始终进行语法检查
  validateTextDocument(event.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  try {
    const settings = await getDocumentSettings(textDocument.uri);
    const text = textDocument.getText();

    const diagnostics: Diagnostic[] = [];

    try {
      // 解析文档
      const lexer = new ApiLexer(text);
      const parser = new ApiParser(lexer);

      // 添加语法分析超时保护（缩短超时时间）
      const ast = (await Promise.race([
        Promise.resolve(parser.parse(text)),
        new Promise(
          (_, reject) =>
            setTimeout(() => reject(new Error("语法分析超时")), 5000) // 5秒超时
        ),
      ])) as any;

      // 检查是否取消
      if (indexingCanceled) {
        console.log("[VALIDATE_DOC] 检测到取消信号，停止验证");
        return;
      }

      // 使用临时符号表来验证当前文档，避免跨文件污染
      const tempSymbolTable = new SymbolTable();
      const collector = new SymbolCollector(tempSymbolTable, textDocument.uri);
      collector.collect(ast);

      // 同时也更新全局符号表（用于跨文件功能如跳转定义）
      const globalCollector = new SymbolCollector(
        globalSymbolTable,
        textDocument.uri
      );
      globalCollector.collect(ast);

      // 只检查当前文档内的重复定义（使用临时符号表）
      const duplicates = tempSymbolTable.getDuplicates();
      for (const [name, symbols] of duplicates) {
        if (symbols.length > 1) {
          // 确保所有重复定义都在当前文档中
          const allInCurrentDoc = symbols.every(
            (s) => s.location.uri === textDocument.uri
          );

          if (allInCurrentDoc) {
            for (let i = 1; i < symbols.length; i++) {
              const symbol = symbols[i];
              const diagnostic: Diagnostic = {
                severity: DiagnosticSeverity.Error,
                range: symbol.location.range,
                message: `Duplicate definition of '${name}'. First defined at line ${
                  symbols[0].location.range.start.line + 1
                }.`,
                source: "api-language",
              };

              if (hasDiagnosticRelatedInformationCapability) {
                diagnostic.relatedInformation = [
                  {
                    location: symbols[0].location,
                    message: "First definition here",
                  },
                ];
              }

              diagnostics.push(diagnostic);
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof ParseError) {
        const diagnostic: Diagnostic = {
          severity: DiagnosticSeverity.Error,
          range: error.token
            ? {
                start: {
                  line: error.token.line - 1,
                  character: error.token.column - 1,
                },
                end: {
                  line: error.token.line - 1,
                  character: error.token.column - 1 + error.token.value.length,
                },
              }
            : {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
              },
          message: error.message,
          source: "api-language",
        };
        diagnostics.push(diagnostic);
      } else {
        // 其他类型的错误（如超时错误）
        const diagnostic: Diagnostic = {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          message: `文档验证错误: ${(error as Error).message}`,
          source: "api-language",
        };
        diagnostics.push(diagnostic);
      }
    }

    // 限制诊断数量
    if (diagnostics.length > settings.maxNumberOfProblems) {
      diagnostics.splice(settings.maxNumberOfProblems);
    }

    // 发送诊断结果
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
  } catch (outerError) {
    // 捕获外层错误，防止验证失败导致服务器崩溃
    console.error("[VALIDATE] 文档验证过程失败:", outerError);
    // 发送一个错误诊断
    try {
      connection.sendDiagnostics({
        uri: textDocument.uri,
        diagnostics: [
          {
            severity: DiagnosticSeverity.Error,
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            message: `文档验证失败: ${(outerError as Error).message}`,
            source: "api-language",
          },
        ],
      });
    } catch (diagError) {
      console.error("[VALIDATE] 发送诊断失败:", diagError);
    }
  }
}

// 智能代码补全 - 使用索引系统
connection.onCompletion(
  (textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    try {
      const document = documents.get(textDocumentPosition.textDocument.uri);
      if (!document) {
        return [];
      }

      const text = document.getText();

      // 性能保护：对于超大文档，返回基础补全
      if (text.length > 50000) {
        console.warn("Document too large for smart completion:", text.length);
        return completionIndex.getBasicCompletions();
      }

      const position = textDocumentPosition.position;
      const lines = text.split("\n");
      const currentLine = lines[position.line] || "";

      // 使用智能上下文分析
      const context = analyzeSmartCompletionContext(
        currentLine,
        lines,
        position
      );

      // 根据上下文获取智能补全建议
      const contextualItems = completionIndex.getContextualCompletions(context);

      // 如果上下文补全项为空，提供基础补全
      if (contextualItems.length === 0) {
        return completionIndex.getBasicCompletions();
      }

      return contextualItems;
    } catch (error) {
      console.error("Completion error:", error);
      // 错误时返回基础补全而不是空数组
      return completionIndex.getBasicCompletions();
    }
  }
);

// 文档索引功能
async function indexDocument(
  document: TextDocument,
  fromBatchIndex: boolean = false
) {
  try {
    // 检查全局索引状态，批量索引进行时跳过单文档索引（除非是批量索引内部调用）
    if (isIndexing && !fromBatchIndex) {
      console.log(
        `[INDEX_DOC] 批量索引进行中，跳过单文档索引: ${document.uri}`
      );
      return;
    }

    // 检查文档是否正在保存
    if (savingDocuments.has(document.uri)) {
      console.log(`[INDEX_DOC] 跳过保存中的文档: ${document.uri}`);
      return;
    }

    console.log(`[INDEX_DOC] 开始索引文档: ${document.uri}`);
    const text = document.getText();
    console.log(`[INDEX_DOC] 文档长度: ${text.length} 字符`);

    const lexer = new ApiLexer(text);
    const parser = new ApiParser(lexer);

    // 添加语法分析超时保护（缩短超时时间）
    const ast = (await Promise.race([
      Promise.resolve(parser.parse(text)),
      new Promise(
        (_, reject) => setTimeout(() => reject(new Error("语法分析超时")), 5000) // 5秒超时
      ),
    ])) as any;

    // 检查是否取消
    if (indexingCanceled && fromBatchIndex) {
      console.log("[INDEX_DOC] 检测到取消信号，停止索引");
      return;
    }

    // 收集符号
    const collector = new SymbolCollector(globalSymbolTable, document.uri);
    const symbolsBeforeCount = globalSymbolTable.getAllSymbols().length;
    collector.collect(ast);
    const symbolsAfterCount = globalSymbolTable.getAllSymbols().length;

    // 刷新补全索引
    completionIndex.refresh();

    console.log(`[INDEX_DOC] 文档索引完成: ${document.uri}`);
    console.log(
      `[INDEX_DOC] 符号数变化: ${symbolsBeforeCount} -> ${symbolsAfterCount} (+${
        symbolsAfterCount - symbolsBeforeCount
      })`
    );
  } catch (error) {
    // 解析错误不影响自动完成功能
    console.warn(
      `[INDEX_DOC] 文档索引失败: ${document.uri}`,
      (error as Error).message
    );
  }
}

// 问题文件黑名单（已知会导致卡死的文件）
const problematicFiles = new Set<string>();

// 检查文件是否在黑名单中
function isProblematicFile(fileUri: string): boolean {
  // 检查文件名是否包含已知问题模式
  const fileName = fileUri.toLowerCase();
  if (fileName.includes("enum.api")) {
    return true;
  }

  // 检查是否在黑名单中
  return problematicFiles.has(fileUri);
}

// 将文件添加到黑名单
function addToProblematicFiles(fileUri: string) {
  problematicFiles.add(fileUri);
  console.log(`[BLACKLIST] 添加问题文件到黑名单: ${fileUri}`);
}

// 安全的文档索引函数（跳过问题文件）
async function safeIndexDocument(
  document: TextDocument,
  fromBatchIndex: boolean = false
) {
  // 检查是否是问题文件
  if (isProblematicFile(document.uri)) {
    console.log(`[SAFE_INDEX] 跳过问题文件: ${document.uri}`);
    return;
  }

  try {
    await indexDocument(document, fromBatchIndex);
  } catch (error) {
    console.error(`[SAFE_INDEX] 文档索引失败: ${document.uri}`, error);

    // 如果是超时或特定错误，添加到黑名单
    const errorMessage = (error as Error).message;
    if (errorMessage.includes("超时") || errorMessage.includes("timeout")) {
      addToProblematicFiles(document.uri);
    }
  }
}

// 索引工作区中的所有文档
function indexAllDocuments() {
  // 检查全局索引状态，避免重复索引
  if (isIndexing) {
    console.log("[INDEX_ALL] 正在索引中，跳过重复索引请求");
    return;
  }

  // 异步执行，避免阻塞
  setImmediate(async () => {
    try {
      // 设置索引状态
      isIndexing = true;
      indexingCanceled = false;

      console.log("[INDEX_ALL] 开始索引工作区中的所有文档...");
      notifyIndexingStatus("indexing", "正在扫描工作区文件...");

      // 首先索引已打开的文档
      const openDocuments = documents.all();
      console.log(`[INDEX_ALL] 找到 ${openDocuments.length} 个已打开的文档`);

      let indexedCount = 0;
      let failedCount = 0;
      let totalFiles = 0;

      // // 索引已打开的文档
      // for (const document of openDocuments) {
      //   if (document.uri.endsWith(".api")) {
      //     console.log(`[INDEX_ALL] 索引已打开文档: ${document.uri}`);
      //     indexDocument(document, true);
      //     indexedCount++;
      //     totalFiles++;

      //     // 每处理一个文档就让出执行权，并检查取消状态
      //     await new Promise((resolve) => setImmediate(resolve));

      //     // 额外的取消检查
      //     if (indexingCanceled) {
      //       console.log("[INDEX_ALL] 在文档处理后检测到取消信号");
      //       return;
      //     }
      //   }
      // }

      // 然后扫描工作区文件系统中的所有 .api 文件
      if (workspaceRoot) {
        console.log(`[INDEX_ALL] 开始扫描工作区文件系统: ${workspaceRoot}`);
        notifyIndexingStatus("indexing", "正在扫描工作区中的 .api 文件...");

        const workspaceApiFiles = await scanWorkspaceForApiFiles(workspaceRoot);
        console.log(
          `[INDEX_ALL] 工作区中找到 ${workspaceApiFiles.length} 个 .api 文件`
        );
        totalFiles += workspaceApiFiles.length;

        notifyIndexingStatus(
          "indexing",
          `找到 ${totalFiles} 个文件，开始索引...`
        );

        for (let i = 0; i < workspaceApiFiles.length; i++) {
          // 检查是否取消
          if (indexingCanceled) {
            console.log("[INDEX_ALL] 索引已被取消");
            notifyIndexingStatus("idle", "索引已取消");
            return;
          }

          const filePath = workspaceApiFiles[i];
          // 检查文件是否已经作为打开文档被处理过
          const fileUri = `file://${filePath}`;
          const isAlreadyOpen = openDocuments.some(
            (doc) => doc.uri === fileUri
          );

          if (!isAlreadyOpen) {
            console.log(
              `[INDEX_ALL] 索引工作区文件 (${i + 1}/${
                workspaceApiFiles.length
              }): ${filePath}`
            );
            notifyIndexingStatus(
              "indexing",
              `正在索引 ${i + 1}/${workspaceApiFiles.length}: ${path.basename(
                filePath
              )}`
            );

            try {
              await indexWorkspaceFile(filePath);
              indexedCount++;
              processedFiles.push(filePath);
              console.log(
                `[INDEX_ALL] 文件索引成功: ${path.basename(filePath)}`
              );
            } catch (error) {
              // 检查是否是取消错误
              if ((error as Error).message === "索引已取消") {
                console.log(
                  `[INDEX_ALL] 索引在处理文件 ${path.basename(
                    filePath
                  )} 时被取消`
                );
                // 取消错误应该中断整个索引流程
                // throw error;
                // notifyIndexingStatus("idle", "索引已取消");
                // return;
              }

              failedCount++;
              failedFiles.push(filePath);
              console.error(
                `[INDEX_ALL] 文件索引失败: ${path.basename(filePath)}`,
                (error as Error).message
              );
              // 不增加 indexedCount，但继续处理下一个文件
              console.log(
                `[INDEX_ALL] 继续处理下一个文件... (失败: ${failedCount})`
              );
            }
          } else {
            console.log(`[INDEX_ALL] 跳过已打开的文件: ${filePath}`);
            continue;
          }

          // 检查取消状态
          if (indexingCanceled) {
            console.log("[INDEX_ALL] 在文件处理后检测到取消信号");
            notifyIndexingStatus("idle", "索引已取消");
            return;
          }
        }
      } else {
        console.log("[INDEX_ALL] 没有工作区根路径，只索引已打开的文档");
        notifyIndexingStatus("indexing", "没有工作区，只索引已打开的文档");
      }

      console.log(
        `[INDEX_ALL] 索引完成 - 成功: ${indexedCount} 个，失败: ${failedCount} 个，总符号数: ${
          globalSymbolTable.getAllSymbols().length
        }`
      );

      // 刷新补全索引
      console.log("[INDEX_ALL] 刷新补全索引");
      notifyIndexingStatus("indexing", "正在更新补全索引...");
      completionIndex.refresh();

      // 保存缓存到文件
      console.log("[INDEX_ALL] 保存缓存");
      notifyIndexingStatus("indexing", "正在保存缓存...");
      saveCacheToFile();

      console.log("[INDEX_ALL] 所有文档索引完成");

      // 统计符号信息
      const totalSymbols = globalSymbolTable.getAllSymbols().length;
      const structs = globalSymbolTable.getSymbolsOfKind(
        SymbolKind.Struct
      ).length;
      const enums = globalSymbolTable.getSymbolsOfKind(SymbolKind.Enum).length;
      const apis = globalSymbolTable.getSymbolsOfKind(SymbolKind.Api).length;

      const statusMessage =
        failedCount > 0
          ? `索引完成：${indexedCount} 成功，${failedCount} 失败，${totalSymbols} 个符号 (${structs} 结构体, ${enums} 枚举, ${apis} API)`
          : `索引完成：${indexedCount} 个文件，${totalSymbols} 个符号 (${structs} 结构体, ${enums} 枚举, ${apis} API)`;
      console.log(`[INDEX_ALL] ${statusMessage}`);
      console.log(`[INDEX_ALL] ✅ 全局代码补全已可用！`);

      notifyIndexingStatus("idle", statusMessage);
    } catch (error) {
      console.error("[INDEX_ALL] 索引所有文档失败:", error);
      notifyIndexingStatus("error", `索引失败: ${error}`);
    } finally {
      // 确保在任何情况下都重置索引状态
      isIndexing = false;
      console.log("[INDEX_ALL] 索引状态已重置");
    }
  });
}

// 安全的索引所有文档函数（跳过问题文件）
function safeIndexAllDocuments() {
  console.log("[SAFE_INDEX_ALL] 开始安全索引，跳过已知问题文件");

  // 检查全局索引状态，避免重复索引
  if (isIndexing) {
    console.log("[SAFE_INDEX_ALL] 正在索引中，跳过重复索引请求");
    return;
  }

  // 异步执行，避免阻塞
  setImmediate(async () => {
    // 整体超时保护：5分钟
    const timeoutHandle = setTimeout(() => {
      console.error("[SAFE_INDEX_ALL] 索引超时（5分钟），强制停止");
      indexingCanceled = true;
      isIndexing = false;
      notifyIndexingStatus("error", "索引超时，已强制停止");
    }, 5 * 60 * 1000); // 5分钟

    try {
      // 设置索引状态
      isIndexing = true;
      indexingCanceled = false;

      console.log("[SAFE_INDEX_ALL] 开始安全索引工作区中的所有文档...");
      notifyIndexingStatus("indexing", "正在安全扫描工作区文件...");

      // 首先索引已打开的文档（但跳过问题文件）
      const openDocuments = documents.all();
      let indexedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;

      console.log(
        `[SAFE_INDEX_ALL] 发现 ${openDocuments.length} 个已打开的文档`
      );

      // 安全地索引已打开的文档
      for (const document of openDocuments) {
        // 检查取消和超时
        if (indexingCanceled) {
          console.log("[SAFE_INDEX_ALL] 检测到取消信号，停止索引");
          throw new Error("索引已取消");
        }

        if (document.uri.endsWith(".api")) {
          if (isProblematicFile(document.uri)) {
            console.log(`[SAFE_INDEX_ALL] 跳过问题文件: ${document.uri}`);
            skippedCount++;
          } else {
            console.log(`[SAFE_INDEX_ALL] 安全索引已打开文档: ${document.uri}`);
            try {
              await safeIndexDocument(document, true);
              indexedCount++;
            } catch (error) {
              console.error(
                `[SAFE_INDEX_ALL] 文档索引失败: ${document.uri}`,
                error
              );
              failedCount++;
            }
          }
        }
      }

      // 扫描工作区文件（如果有工作区）
      if (workspaceRoot) {
        console.log(`[SAFE_INDEX_ALL] 扫描工作区: ${workspaceRoot}`);
        notifyIndexingStatus("indexing", "正在安全扫描工作区文件...");

        const workspaceApiFiles = await scanWorkspaceForApiFiles(workspaceRoot);
        console.log(
          `[SAFE_INDEX_ALL] 发现 ${workspaceApiFiles.length} 个工作区文件`
        );

        // 安全地索引工作区文件
        for (let i = 0; i < workspaceApiFiles.length; i++) {
          if (indexingCanceled) {
            console.log("[SAFE_INDEX_ALL] 检测到取消信号，停止索引");
            throw new Error("索引已取消");
          }

          const filePath = workspaceApiFiles[i];
          const fileUri = `file://${filePath}`;

          // 检查是否是已打开的文档
          const isAlreadyOpen = openDocuments.some(
            (doc) => doc.uri === fileUri
          );

          if (!isAlreadyOpen) {
            if (isProblematicFile(fileUri)) {
              console.log(`[SAFE_INDEX_ALL] 跳过问题文件: ${filePath}`);
              skippedCount++;
            } else {
              console.log(
                `[SAFE_INDEX_ALL] 安全索引工作区文件 (${i + 1}/${
                  workspaceApiFiles.length
                }): ${filePath}`
              );
              notifyIndexingStatus(
                "indexing",
                `正在安全索引 ${i + 1}/${
                  workspaceApiFiles.length
                }: ${path.basename(filePath)}`
              );

              try {
                await indexWorkspaceFile(filePath);
                indexedCount++;
              } catch (error) {
                console.error(
                  `[SAFE_INDEX_ALL] 工作区文件索引失败: ${filePath}`,
                  error
                );
                failedCount++;

                // 如果是超时错误，添加到黑名单
                const errorMessage = (error as Error).message;
                if (
                  errorMessage.includes("超时") ||
                  errorMessage.includes("timeout")
                ) {
                  addToProblematicFiles(fileUri);
                }
              }
            }
          }
        }
      }

      // 检查最后一次取消状态
      if (indexingCanceled) {
        console.log("[SAFE_INDEX_ALL] 索引被取消");
        throw new Error("索引已取消");
      }

      // 刷新补全索引
      console.log("[SAFE_INDEX_ALL] 刷新补全索引");
      completionIndex.refresh();

      console.log("[SAFE_INDEX_ALL] 安全索引完成");
      const statusMessage = `安全索引完成：${indexedCount} 成功，${failedCount} 失败，${skippedCount} 跳过，${
        globalSymbolTable.getAllSymbols().length
      } 个符号`;

      notifyIndexingStatus("idle", statusMessage);

      // 清除超时定时器
      clearTimeout(timeoutHandle);
    } catch (error) {
      console.error("[SAFE_INDEX_ALL] 安全索引失败:", error);
      notifyIndexingStatus("error", `安全索引失败: ${error}`);

      // 清除超时定时器
      clearTimeout(timeoutHandle);
    } finally {
      // 确保在任何情况下都重置索引状态
      isIndexing = false;
      console.log("[SAFE_INDEX_ALL] 安全索引状态已重置");
    }
  });
}

// 扫描工作区中的所有 .api 文件
async function scanWorkspaceForApiFiles(
  workspaceRoot: string,
  maxDepth: number = 10
): Promise<string[]> {
  const apiFiles: string[] = [];
  const MAX_FILES = 10000; // 限制最大文件数量
  const startTime = Date.now();
  const SCAN_TIMEOUT = 30000; // 30秒扫描超时

  async function scanDirectory(
    dirPath: string,
    currentDepth: number
  ): Promise<void> {
    // 检查是否取消
    if (indexingCanceled) {
      console.log("[SCAN] 扫描已被取消");
      throw new Error("扫描已取消");
    }

    // 检查扫描超时
    if (Date.now() - startTime > SCAN_TIMEOUT) {
      console.log("[SCAN] 扫描超时，停止扫描");
      throw new Error("扫描超时");
    }

    // 检查文件数量限制
    if (apiFiles.length >= MAX_FILES) {
      console.log(`[SCAN] 已达到最大文件数量 ${MAX_FILES}，停止扫描`);
      return;
    }

    if (currentDepth > maxDepth) {
      console.log(`[SCAN] 达到最大深度 ${maxDepth}，跳过目录: ${dirPath}`);
      return;
    }

    try {
      // 添加目录读取超时
      const entries = await Promise.race([
        fs.promises.readdir(dirPath, { withFileTypes: true }),
        new Promise<any[]>((_, reject) =>
          setTimeout(() => reject(new Error("目录读取超时")), 5000)
        ),
      ]);

      for (const entry of entries) {
        // 检查是否取消
        if (indexingCanceled) {
          console.log("[SCAN] 扫描已被取消");
          throw new Error("扫描已取消");
        }

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // 跳过常见的忽略目录
          if (shouldSkipDirectory(entry.name)) {
            continue;
          }

          await scanDirectory(fullPath, currentDepth + 1);
        } else if (
          entry.isFile() &&
          entry.name.endsWith(".api") &&
          entry.name !== "__debug.api"
        ) {
          // 在添加到列表前，验证文件确实存在且可读
          try {
            await fs.promises.access(fullPath, fs.constants.R_OK);
            apiFiles.push(fullPath);
          } catch (error) {
            // 文件可能已被删除或无法读取，跳过
            console.log(`[SCAN] 跳过无法访问的文件: ${fullPath}`);
          }
        }
      }
    } catch (error) {
      const errorMsg = (error as Error).message;
      if (errorMsg === "扫描已取消" || errorMsg === "扫描超时") {
        throw error;
      }
      console.warn(`[SCAN] 无法读取目录 ${dirPath}:`, error);
    }
  }

  console.log(
    `[SCAN] 开始扫描工作区 (最大深度: ${maxDepth}): ${workspaceRoot}`
  );

  try {
    await scanDirectory(workspaceRoot, 0);
  } catch (error) {
    const errorMsg = (error as Error).message;
    if (errorMsg === "扫描已取消") {
      console.log(`[SCAN] 扫描被取消，找到 ${apiFiles.length} 个 .api 文件`);
    } else if (errorMsg === "扫描超时") {
      console.log(`[SCAN] 扫描超时，找到 ${apiFiles.length} 个 .api 文件`);
    }
  }

  console.log(`[SCAN] 扫描完成，共找到 ${apiFiles.length} 个 .api 文件`);

  return apiFiles;
}

// 判断是否应该跳过某个目录
function shouldSkipDirectory(dirName: string): boolean {
  const skipDirs = [
    "node_modules",
    ".git",
    ".vscode",
    "dist",
    "build",
    "out",
    "target",
    ".idea",
    "__pycache__",
    ".cache",
    "tmp",
    "temp",
    ".api", // 跳过我们自己的缓存目录
  ];

  return skipDirs.includes(dirName) || dirName.startsWith(".");
}

// 索引工作区中的单个文件
async function indexWorkspaceFile(filePath: string): Promise<void> {
  try {
    // 检查是否取消
    if (indexingCanceled) {
      console.log("[INDEX_FILE] 索引已被取消");
      throw new Error("索引已取消"); // 抛出错误以便上层捕获
    }

    console.log(`[INDEX_FILE] 开始索引工作区文件: ${filePath}`);

    // 首先检查文件是否存在
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
    } catch (error) {
      console.warn(`[INDEX_FILE] 文件不存在，跳过: ${filePath}`);
      throw new Error(`文件不存在: ${filePath}`);
    }

    // 添加文件读取超时保护，防止卡在特定文件（缩短超时时间）
    const fileContent = await Promise.race([
      fs.promises.readFile(filePath, "utf8"),
      new Promise<string>(
        (_, reject) => setTimeout(() => reject(new Error("文件读取超时")), 5000) // 5秒超时
      ),
    ]);

    console.log(`[INDEX_FILE] 文件长度: ${fileContent.length} 字符`);

    // 如果文件过大，跳过或警告
    if (fileContent.length > 500000) {
      console.warn(
        `[INDEX_FILE] 文件过大 (${fileContent.length} 字符)，跳过: ${filePath}`
      );
      return;
    }

    // 再次检查是否取消，避免在文件读取后继续处理
    if (indexingCanceled) {
      console.log("[INDEX_FILE] 在文件读取后检测到取消信号");
      throw new Error("索引已取消");
    }

    // 创建一个临时的 TextDocument 对象用于索引
    const fileUri = `file://${filePath}`;
    // const tempDocument = {
    //   uri: fileUri,
    //   getText: () => fileContent,
    //   lineCount: fileContent.split("\n").length,
    //   offsetAt: (position: any) => {
    //     const lines = fileContent.split("\n");
    //     let offset = 0;
    //     for (let i = 0; i < position.line && i < lines.length; i++) {
    //       offset += lines[i].length + 1; // +1 for newline
    //     }
    //     return offset + position.character;
    //   },
    // } as TextDocument;

    console.log(`[INDEX_FILE] 开始词法分析: ${filePath}`);
    const lexer = new ApiLexer(fileContent);

    console.log(`[INDEX_FILE] 开始语法分析: ${filePath}`);
    const parser = new ApiParser(lexer);
    console.log(`[INDEX_FILE] 初始化ApiParser: ${filePath}`);

    // 检查是否取消
    if (indexingCanceled) {
      console.log("[INDEX_FILE] 在语法分析前检测到取消信号");
      throw new Error("索引已取消");
    }

    // 添加语法分析超时保护，防止在特定语法结构上陷入死循环（缩短超时时间）
    const ast = (await Promise.race([
      Promise.resolve(parser.parse(fileContent)),
      new Promise(
        (_, reject) => setTimeout(() => reject(new Error("语法分析超时")), 8000) // 8秒超时
      ),
    ])) as any; // 类型断言解决Promise.race的类型问题

    console.log(`[INDEX_FILE] 开始符号收集: ${filePath}`);

    // 收集符号
    const symbolsBeforeCount = globalSymbolTable.getAllSymbols().length;
    const collector = new SymbolCollector(globalSymbolTable, fileUri);

    // 检查是否取消
    if (indexingCanceled) {
      console.log("[INDEX_FILE] 在符号收集前检测到取消信号");
      throw new Error("索引已取消");
    }

    // 添加符号收集超时保护（缩短超时时间）
    await Promise.race([
      Promise.resolve(collector.collect(ast)),
      new Promise(
        (_, reject) => setTimeout(() => reject(new Error("符号收集超时")), 5000) // 5秒超时
      ),
    ]);

    const symbolsAfterCount = globalSymbolTable.getAllSymbols().length;

    console.log(`[INDEX_FILE] 文件索引完成: ${filePath}`);
    console.log(
      `[INDEX_FILE] 符号数变化: ${symbolsBeforeCount} -> ${symbolsAfterCount} (+${
        symbolsAfterCount - symbolsBeforeCount
      })`
    );
  } catch (error) {
    const errorMsg = (error as Error).message;

    // 对文件不存在的错误进行特殊处理，不打印堆栈
    if (errorMsg.includes("文件不存在") || errorMsg.includes("ENOENT")) {
      console.log(`[INDEX_FILE] 跳过不存在的文件: ${filePath}`);
    } else {
      console.warn(`[INDEX_FILE] 工作区文件索引失败: ${filePath}`, errorMsg);
    }

    // 重新抛出错误以便上层处理
    throw error;
  }
}

// 缓存管理函数
async function ensureCacheDirectory(): Promise<boolean> {
  try {
    const cachePaths = getCachePaths();
    if (!cachePaths) {
      console.warn("No workspace root found, cannot create cache directory");
      return false;
    }

    if (!fs.existsSync(cachePaths.CACHE_DIR)) {
      await fs.promises.mkdir(cachePaths.CACHE_DIR, { recursive: true });
    }
    return true;
  } catch (error) {
    console.warn("Failed to create cache directory:", error);
    return false;
  }
}

function saveCacheToFile() {
  // 异步执行，避免阻塞
  setImmediate(async () => {
    try {
      console.log("[CACHE] 开始保存缓存");
      const cachePaths = getCachePaths();
      if (!cachePaths) {
        console.warn("[CACHE] 无法保存缓存: 没有工作区");
        return;
      }

      const cacheDirectoryCreated = await ensureCacheDirectory();
      if (!cacheDirectoryCreated) {
        console.warn("[CACHE] 无法保存缓存: 缓存目录创建失败");
        return;
      }

      // 保存符号表
      const symbols = globalSymbolTable.getAllSymbols();
      console.log(`[CACHE] 准备保存 ${symbols.length} 个符号`);

      const symbolData = {
        version: CACHE_VERSION,
        timestamp: Date.now(),
        symbols: symbols.map((symbol) => ({
          name: symbol.name,
          kind: symbol.kind,
          location: symbol.location,
          documentation: symbol.documentation,
          detail: symbol.detail,
        })),
      };

      console.log(`[CACHE] 写入缓存文件: ${cachePaths.SYMBOL_CACHE_FILE}`);

      // 使用异步写入，避免阻塞主线程
      await fs.promises.writeFile(
        cachePaths.SYMBOL_CACHE_FILE,
        JSON.stringify(symbolData, null, 2),
        "utf8"
      );

      console.log(
        `[CACHE] 成功保存 ${symbolData.symbols.length} 个符号到缓存: ${cachePaths.SYMBOL_CACHE_FILE}`
      );
    } catch (error) {
      console.error("[CACHE] 保存缓存失败:", error);
    }
  });
}

async function loadCacheFromFile(): Promise<boolean> {
  try {
    const cachePaths = getCachePaths();
    if (!cachePaths) {
      console.warn("No workspace root found, cannot load cache");
      return false;
    }

    if (!fs.existsSync(cachePaths.SYMBOL_CACHE_FILE)) {
      console.log("No cache file found");
      return false;
    }

    const cacheContent = await fs.promises.readFile(
      cachePaths.SYMBOL_CACHE_FILE,
      "utf8"
    );
    const cacheData = JSON.parse(cacheContent);

    // 检查缓存版本
    if (cacheData.version !== CACHE_VERSION) {
      console.log("Cache version mismatch, ignoring cache");
      return false;
    }

    // 检查缓存时间（24小时过期）
    const cacheAge = Date.now() - cacheData.timestamp;
    if (cacheAge > 24 * 60 * 60 * 1000) {
      console.log("Cache expired, ignoring cache");
      return false;
    }

    // 加载符号到全局符号表
    if (cacheData.symbols && Array.isArray(cacheData.symbols)) {
      for (const symbolData of cacheData.symbols) {
        globalSymbolTable.addSymbol({
          name: symbolData.name,
          kind: symbolData.kind,
          location: symbolData.location,
          documentation: symbolData.documentation,
          detail: symbolData.detail,
        });
      }

      // 刷新补全索引
      completionIndex.refresh();

      console.log(
        `Loaded ${cacheData.symbols.length} symbols from cache: ${cachePaths.SYMBOL_CACHE_FILE}`
      );
      return true;
    }
  } catch (error) {
    console.warn("Failed to load cache:", error);
  }

  return false;
}

function clearCache() {
  try {
    const cachePaths = getCachePaths();
    if (!cachePaths) {
      console.warn("No workspace root found, cannot clear cache");
      return;
    }

    if (fs.existsSync(cachePaths.SYMBOL_CACHE_FILE)) {
      fs.unlinkSync(cachePaths.SYMBOL_CACHE_FILE);
      console.log(`Cleared symbol cache: ${cachePaths.SYMBOL_CACHE_FILE}`);
    }
    if (fs.existsSync(cachePaths.COMPLETION_CACHE_FILE)) {
      fs.unlinkSync(cachePaths.COMPLETION_CACHE_FILE);
      console.log(
        `Cleared completion cache: ${cachePaths.COMPLETION_CACHE_FILE}`
      );
    }
    console.log("Cache cleared");
  } catch (error) {
    console.warn("Failed to clear cache:", error);
  }
}

// 分析补全上下文
function analyzeCompletionContext(
  currentLineToPosition: string,
  lines: string[],
  position: Position
) {
  const line = currentLineToPosition.trim();

  // 最简单的上下文判断，避免复杂逻辑

  // 检查是否在 input 或 output 语句中
  if (line.includes("input ") || line.includes("output ")) {
    return { type: "struct-reference" };
  }

  // 简化：只检查当前行和前几行，减少处理量
  const checkLines = Math.min(5, position.line + 1); // 最多检查5行

  let inStructDefinition = false;
  let inApiDefinition = false;

  // 从当前行往前检查少量行数
  for (
    let i = Math.max(0, position.line - checkLines);
    i <= position.line;
    i++
  ) {
    const lineText = lines[i] || "";

    // 简单的检查，避免复杂的大括号计算
    if (lineText.includes("struct {")) {
      inStructDefinition = true;
    }
    if (lineText.includes("api ") && lineText.includes("{")) {
      inApiDefinition = true;
    }
    if (lineText.includes("apilist ") && lineText.includes("{")) {
      inApiDefinition = true;
    }
  }

  // 简化的上下文判断
  if (inStructDefinition) {
    return { type: "field-definition" };
  }

  if (inApiDefinition) {
    return { type: "api-definition" };
  }

  return { type: "global-scope" };
} // 添加结构体补全 - 简化版
function addStructCompletions(items: CompletionItem[]) {
  // 暂时使用静态的常见结构体，避免复杂的符号表查询
  const commonStructs = ["User", "Response", "Request"];
  for (const structName of commonStructs) {
    items.push({
      label: structName,
      kind: CompletionItemKind.Struct,
    });
  }
}

// 添加类型补全 - 精简版
function addTypeCompletions(items: CompletionItem[]) {
  // 只提供最基本的类型，减少处理
  const basicTypes = ["int", "string", "bool"];
  for (const type of basicTypes) {
    items.push({
      label: type,
      kind: CompletionItemKind.TypeParameter,
    });
  }
}

// 添加API体关键字 - 精简版
function addApiBodyKeywords(items: CompletionItem[]) {
  const basicKeywords = ["input", "output"];
  for (const keyword of basicKeywords) {
    items.push({
      label: keyword,
      kind: CompletionItemKind.Keyword,
    });
  }
}

// 添加全局关键字 - 精简版
function addGlobalKeywords(items: CompletionItem[]) {
  const globalKeywords = ["struct", "api"];
  for (const keyword of globalKeywords) {
    items.push({
      label: keyword,
      kind: CompletionItemKind.Keyword,
    });
  }
}

// 添加所有补全（回退选项）- 精简版
function addAllCompletions(items: CompletionItem[]) {
  // 只添加最基本的关键字，避免复杂查询
  const basicItems = [
    { label: "struct", kind: CompletionItemKind.Keyword },
    { label: "api", kind: CompletionItemKind.Keyword },
    { label: "int", kind: CompletionItemKind.TypeParameter },
    { label: "string", kind: CompletionItemKind.TypeParameter },
    { label: "bool", kind: CompletionItemKind.TypeParameter },
  ];

  items.push(...basicItems);
}

// 补全项解析
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  return item;
});

// 跳转到定义
connection.onDefinition(
  (params: TextDocumentPositionParams): Location[] | null => {
    try {
      const document = documents.get(params.textDocument.uri);
      if (!document) {
        return null;
      }

      const text = document.getText();

      // 性能保护：限制文档大小
      if (text.length > 500000) {
        console.warn("Document too large for definition lookup:", text.length);
        return null;
      }

      const offset = document.offsetAt(params.position);

      // 安全的词边界检测
      let start = offset;
      let end = offset;

      // 向前查找词的开始（限制搜索范围）
      const maxSearchBack = 50; // 最多向前搜索50个字符
      while (
        start > Math.max(0, offset - maxSearchBack) &&
        start > 0 &&
        /[a-zA-Z0-9_]/.test(text[start - 1])
      ) {
        start--;
      }

      // 向后查找词的结束（限制搜索范围）
      const maxSearchForward = 50; // 最多向后搜索50个字符
      while (
        end < Math.min(text.length, offset + maxSearchForward) &&
        end < text.length &&
        /[a-zA-Z0-9_]/.test(text[end])
      ) {
        end++;
      }

      const word = text.substring(start, end);
      if (!word || word.length > 100) {
        // 防止异常长的词
        return null;
      }

      // 查找符号定义
      const symbol = globalSymbolTable.getSymbol(word);

      if (symbol) {
        return [symbol.location];
      }

      return null;
    } catch (error) {
      console.error("Definition lookup error:", error);
      return null;
    }
  }
);

// 查找引用
connection.onReferences((params): Location[] => {
  try {
    const locations: Location[] = [];
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return locations;
    }

    const text = document.getText();

    // 性能保护：限制文档大小
    if (text.length > 200000) {
      console.warn("Document too large for reference search:", text.length);
      return locations;
    }

    const offset = document.offsetAt(params.position);

    // 安全的词边界检测（同定义查找）
    let start = offset;
    let end = offset;
    const maxSearchBack = 50;
    const maxSearchForward = 50;

    while (
      start > Math.max(0, offset - maxSearchBack) &&
      start > 0 &&
      /[a-zA-Z0-9_]/.test(text[start - 1])
    ) {
      start--;
    }

    while (
      end < Math.min(text.length, offset + maxSearchForward) &&
      end < text.length &&
      /[a-zA-Z0-9_]/.test(text[end])
    ) {
      end++;
    }

    const word = text.substring(start, end);
    if (!word || word.length > 100) {
      return locations;
    }

    // 限制搜索行数，避免大文档卡死
    const lines = text.split("\n");
    const maxLines = Math.min(lines.length, 10000); // 最多搜索10000行

    for (let lineIndex = 0; lineIndex < maxLines; lineIndex++) {
      const line = lines[lineIndex];

      // 避免在非常长的行上进行正则搜索
      if (line.length > 1000) {
        continue;
      }

      let match;
      const regex = new RegExp(
        `\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "g"
      );

      while ((match = regex.exec(line)) !== null) {
        const location: Location = {
          uri: params.textDocument.uri,
          range: {
            start: { line: lineIndex, character: match.index },
            end: { line: lineIndex, character: match.index + word.length },
          },
        };
        locations.push(location);

        // 防止找到过多引用导致性能问题
        if (locations.length > 1000) {
          console.warn("Too many references found, limiting results");
          return locations;
        }
      }
    }

    return locations;
  } catch (error) {
    console.error("Reference search error:", error);
    return [];
  }
});

// 悬停信息
connection.onHover((params): { contents: string } | null => {
  try {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return null;
    }

    const text = document.getText();

    // 性能保护：限制文档大小
    if (text.length > 500000) {
      console.warn("Document too large for hover lookup:", text.length);
      return null;
    }

    const offset = document.offsetAt(params.position);

    // 安全的词边界检测（同定义查找）
    let start = offset;
    let end = offset;
    const maxSearchBack = 50;
    const maxSearchForward = 50;

    while (
      start > Math.max(0, offset - maxSearchBack) &&
      start > 0 &&
      /[a-zA-Z0-9_]/.test(text[start - 1])
    ) {
      start--;
    }

    while (
      end < Math.min(text.length, offset + maxSearchForward) &&
      end < text.length &&
      /[a-zA-Z0-9_]/.test(text[end])
    ) {
      end++;
    }

    const word = text.substring(start, end);
    if (!word || word.length > 100) {
      return null;
    }

    // 查找符号信息
    const symbol = globalSymbolTable.getSymbol(word);
    if (symbol) {
      return {
        contents: `**${symbol.detail || symbol.name}**\n\n${
          symbol.documentation || ""
        }`,
      };
    }

    // 检查是否是内置类型或关键字
    if (KEYWORDS.includes(word)) {
      return {
        contents: `**Keyword**: ${word}\n\nAPI language keyword`,
      };
    }

    if (CONSTANTS.includes(word)) {
      return {
        contents: `**Constant**: ${word}\n\nAPI language constant`,
      };
    }

    const builtinSymbols = getBuiltinSymbols();
    const builtin = builtinSymbols.find((s) => s.name === word);
    if (builtin) {
      return {
        contents: `**${builtin.detail}**\n\n${builtin.documentation}`,
      };
    }

    return null;
  } catch (error) {
    console.error("Hover lookup error:", error);
    return null;
  }
});

// 文档格式化
connection.onDocumentFormatting(
  async (params: DocumentFormattingParams): Promise<TextEdit[]> => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return [];
    }

    try {
      // 获取文档设置
      const settings = await getDocumentSettings(document.uri);

      // 检查格式化是否启用
      if (!settings.format.enable) {
        return [];
      }

      const text = document.getText();

      // 性能保护：限制文档大小
      if (text.length > 100000) {
        // 100KB限制
        console.warn("[FORMAT] 文档过大，无法格式化:", text.length);
        return [];
      }

      // 性能保护：限制行数
      const lineCount = document.lineCount;
      if (lineCount > 10000) {
        // 10000行限制
        console.warn("[FORMAT] 文档行数过多，无法格式化:", lineCount);
        return [];
      }

      // 添加格式化超时保护 - 3秒超时
      const formattedText = await Promise.race([
        Promise.resolve(formatApiDocument(text, settings.format)),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("格式化超时")), 3000)
        ),
      ]);

      return [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: document.lineCount, character: 0 },
          },
          newText: formattedText,
        },
      ];
    } catch (error) {
      const errorMsg = (error as Error).message;
      if (errorMsg.includes("格式化超时")) {
        console.error("[FORMAT] 格式化超时，文档过于复杂");
      } else {
        console.error("[FORMAT] 格式化错误:", error);
      }
      // 确保即使出错也返回空数组，而不是未定义的值
      return [];
    }
  }
);

function formatApiDocument(
  text: string,
  formatSettings: { indentSize: number; alignFields: boolean }
): string {
  try {
    // 输入验证
    if (!text || typeof text !== "string") {
      console.warn("[FORMAT] 无效的文本输入");
      return text || "";
    }

    if (!formatSettings || typeof formatSettings.indentSize !== "number") {
      console.warn("[FORMAT] 无效的格式化设置");
      return text;
    }

    const lines = text.split("\n");
    const formattedLines: string[] = [];
    let indentLevel = 0;
    const indentSize = Math.max(0, formatSettings.indentSize); // 确保缩进大小不为负数
    let currentContext: string[] = []; // 跟踪当前上下文

    // 性能保护：添加迭代次数限制
    const MAX_ITERATIONS = 50000; // 最大处理50000行
    let iterations = 0;

    for (let i = 0; i < lines.length; i++) {
      // 检查迭代次数
      if (++iterations > MAX_ITERATIONS) {
        console.error("[FORMAT] 超过最大迭代次数，可能文档过大或存在问题");
        throw new Error("格式化操作超过最大迭代次数");
      }

      const line = lines[i].trim();

      // 处理空行
      if (!line) {
        formattedLines.push(line);
        continue;
      }

      // 处理注释 - 需要根据当前缩进级别来缩进注释
      if (line.startsWith("//")) {
        const commentIndent = " ".repeat(indentLevel * indentSize);
        formattedLines.push(commentIndent + line);
        continue;
      }

      // 特殊处理：检查是否是结构体定义的结束行（如 "} StructName"）
      const isStructEndWithName = line.match(/^\}\s+[a-zA-Z_][a-zA-Z0-9_]*$/);

      // 减少缩进的情况
      if (line === "}" || isStructEndWithName) {
        indentLevel = Math.max(0, indentLevel - 1);
        currentContext.pop();
      }

      // 计算缩进 - 顶层声明通常不缩进，但要考虑上下文
      let indent = "";
      const isTopLevelDeclaration =
        line.startsWith("typedef") ||
        line.startsWith("struct ") ||
        line.startsWith("enum ");

      // api 和 apilist 的特殊处理：如果在 apilist 内部，api 应该缩进
      const isApiDeclaration = line.startsWith("api ");
      const isApiListDeclaration = line.startsWith("apilist ");
      const isInApiList =
        currentContext.length > 0 &&
        currentContext[currentContext.length - 1] === "apilist";

      // 判断是否应该缩进：
      // 1. 不是顶层声明的普通行应该缩进
      // 2. 在 apilist 内部的 api 声明应该缩进
      // 3. 结构体结束行不缩进
      const shouldIndent =
        (!isTopLevelDeclaration &&
          !isApiListDeclaration &&
          !isStructEndWithName) ||
        (isApiDeclaration && isInApiList);

      if (shouldIndent) {
        indent = " ".repeat(indentLevel * indentSize);
      }

      // 特殊处理字段定义 - 仅在 typedef struct 内进行对齐
      if (
        isFieldDefinition(line) &&
        isInTypedefStruct(currentContext) &&
        formatSettings.alignFields
      ) {
        const formattedField = formatFieldDefinition(line, indent);
        formattedLines.push(formattedField);
      } else {
        formattedLines.push(indent + line);
      }

      // 增加缩进的情况
      if (line.endsWith("{")) {
        indentLevel++;
        // 跟踪当前上下文 - 区分 typedef struct 和 inline struct
        if (line.includes("struct")) {
          // 检查是否是 typedef struct（需要字段对齐）
          if (line.startsWith("typedef struct")) {
            currentContext.push("typedef-struct");
          } else {
            // inline struct（如 input struct, output struct 等，不需要字段对齐）
            currentContext.push("inline-struct");
          }
        } else if (line.includes("enum")) {
          // 检查是否是 typedef enum
          if (line.startsWith("typedef enum")) {
            currentContext.push("typedef-enum");
          } else {
            currentContext.push("inline-enum");
          }
        } else if (line.includes("apilist")) {
          currentContext.push("apilist");
        } else {
          currentContext.push("block");
        }
      }
    }

    return formattedLines.join("\n");
  } catch (error) {
    console.error("Format document internal error:", error);
    // 如果格式化失败，返回原始文本
    return text;
  }
}

function isFieldDefinition(line: string): boolean {
  // 检查是否是字段定义
  const fieldPattern = /^[a-zA-Z_][a-zA-Z0-9_]*\s+[a-zA-Z\[\]]+/;
  return (
    fieldPattern.test(line) && !line.includes("{") && !line.includes("typedef")
  );
}

function isInStructOrEnum(context: string[]): boolean {
  return (
    context.length > 0 &&
    (context[context.length - 1] === "struct" ||
      context[context.length - 1] === "enum" ||
      context[context.length - 1] === "typedef-struct" ||
      context[context.length - 1] === "typedef-enum" ||
      context[context.length - 1] === "inline-struct" ||
      context[context.length - 1] === "inline-enum")
  );
}

function isInTypedefStruct(context: string[]): boolean {
  return context.length > 0 && context[context.length - 1] === "typedef-struct";
}

function formatFieldDefinition(line: string, indent: string): string {
  // 简单的字段格式化：确保字段名和类型之间有适当的空格
  const parts = line.split(/\s+/);
  if (parts.length >= 2) {
    const fieldName = parts[0];
    const fieldType = parts.slice(1).join(" ");
    return `${indent}${fieldName.padEnd(12)} ${fieldType}`;
  }
  return indent + line;
}

// 文档符号提供（Go to Symbol）
connection.onDocumentSymbol(
  (params: DocumentSymbolParams): DocumentSymbol[] => {
    try {
      const document = documents.get(params.textDocument.uri);
      if (!document) {
        return [];
      }

      const text = document.getText();

      // 性能保护：限制文档大小
      if (text.length > 500000) {
        console.warn("Document too large for symbol lookup:", text.length);
        return [];
      }

      // 解析文档并收集符号
      try {
        const lexer = new ApiLexer(text);
        const parser = new ApiParser(lexer);
        const ast = parser.parse(text);

        // 收集符号到临时符号表
        const tempSymbolTable = new SymbolTable();
        const collector = new SymbolCollector(
          tempSymbolTable,
          params.textDocument.uri
        );
        collector.collect(ast);

        // 获取所有符号
        const allSymbols = tempSymbolTable.getAllSymbols();

        // 构建文档符号树
        const documentSymbols: DocumentSymbol[] = [];

        // 映射符号类型到LSP符号类型
        const mapSymbolKind = (kind: SymbolKind): LSPSymbolKind => {
          switch (kind) {
            case SymbolKind.ApiList:
              return LSPSymbolKind.Class; // apilist 作为类
            case SymbolKind.Api:
              return LSPSymbolKind.Method; // api 作为方法
            case SymbolKind.Struct:
              return LSPSymbolKind.Struct;
            case SymbolKind.Enum:
              return LSPSymbolKind.Enum;
            case SymbolKind.Field:
              return LSPSymbolKind.Field;
            case SymbolKind.EnumValue:
              return LSPSymbolKind.EnumMember;
            case SymbolKind.Type:
              return LSPSymbolKind.TypeParameter;
            default:
              return LSPSymbolKind.Variable;
          }
        };

        // 首先处理 apilist（顶层符号）
        const apiLists = allSymbols.filter(
          (s) => s.kind === SymbolKind.ApiList
        );
        const apisInLists = new Set<string>(); // 跟踪已经添加到 apilist 中的 api

        for (const apiList of apiLists) {
          // 查找属于这个 apilist 的 api
          const childApis = allSymbols.filter(
            (s) => s.kind === SymbolKind.Api && s.parent === apiList.name
          );

          // 记录这些 api
          childApis.forEach((api) => apisInLists.add(api.name));

          // 创建 apilist 符号
          const apiListSymbol: DocumentSymbol = {
            name: apiList.name,
            detail: apiList.detail || `apilist "${apiList.name}"`,
            kind: mapSymbolKind(apiList.kind),
            range: apiList.location.range,
            selectionRange: apiList.location.range,
            children: childApis.map((api) => ({
              name: api.name,
              detail: api.detail || `api "${api.name}"`,
              kind: mapSymbolKind(api.kind),
              range: api.location.range,
              selectionRange: api.location.range,
            })),
          };

          documentSymbols.push(apiListSymbol);
        }

        // 然后添加独立的 api（不属于任何 apilist）
        const standaloneApis = allSymbols.filter(
          (s) => s.kind === SymbolKind.Api && !apisInLists.has(s.name)
        );

        for (const api of standaloneApis) {
          const apiSymbol: DocumentSymbol = {
            name: api.name,
            detail: api.detail || `api "${api.name}"`,
            kind: mapSymbolKind(api.kind),
            range: api.location.range,
            selectionRange: api.location.range,
          };
          documentSymbols.push(apiSymbol);
        }

        // 添加其他顶层符号（struct, enum）
        const otherSymbols = allSymbols.filter(
          (s) =>
            s.kind !== SymbolKind.ApiList &&
            s.kind !== SymbolKind.Api &&
            !s.parent && // 只添加顶层符号
            s.name &&
            s.name.trim() !== "" // 过滤掉空名称的符号（如内联枚举）
        );

        for (const symbol of otherSymbols) {
          const docSymbol: DocumentSymbol = {
            name: symbol.name,
            detail: symbol.detail || symbol.name,
            kind: mapSymbolKind(symbol.kind),
            range: symbol.location.range,
            selectionRange: symbol.location.range,
          };
          documentSymbols.push(docSymbol);
        }

        return documentSymbols;
      } catch (parseError) {
        console.error("Document symbol parse error:", parseError);
        return [];
      }
    } catch (error) {
      console.error("Document symbol error:", error);
      return [];
    }
  }
);

// ========================================
// 索引系统总开关 - 设置为 false 完全禁用索引
// ========================================
const INDEXING_ENABLED = true; // ⚠️ 设置为 true 启用索引，false 禁用

// 索引状态管理
let isIndexing = false;
let indexingCanceled = false;

// 强制取消索引的函数
async function forceCancelIndexing(): Promise<void> {
  console.log("[FORCE_CANCEL] 开始强制取消索引操作");

  if (!isIndexing) {
    console.log("[FORCE_CANCEL] 当前没有索引操作在进行");
    return;
  }

  console.log("[FORCE_CANCEL] 设置取消标志");
  indexingCanceled = true;
  notifyIndexingStatus("idle", "正在强制取消索引...");

  // 等待最多3秒让索引操作自然停止
  const maxWait = 3000;
  const startTime = Date.now();
  let waitTime = 0;

  while (isIndexing && waitTime < maxWait) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    waitTime = Date.now() - startTime;

    if (waitTime % 500 === 0) {
      console.log(`[FORCE_CANCEL] 等待索引停止... ${waitTime}ms`);
    }
  }

  // 如果等待后仍在索引，强制停止
  if (isIndexing) {
    console.log("[FORCE_CANCEL] 等待超时，强制停止索引操作");
    isIndexing = false;
    indexingCanceled = false;
    notifyIndexingStatus("idle", "索引已强制取消");
  } else {
    console.log("[FORCE_CANCEL] 索引已正常停止");
    indexingCanceled = false;
  }
}

// 发送状态更新通知到客户端
function notifyIndexingStatus(status: string, message: string) {
  console.log(`[STATUS] 发送状态通知: ${status} - ${message}`);

  try {
    connection.sendNotification("api/indexingStatus", {
      status,
      message,
      timestamp: Date.now(),
      isIndexing: isIndexing,
      indexingCanceled: indexingCanceled,
    });
    console.log(`[STATUS] 状态通知发送成功`);
  } catch (error) {
    console.error(`[STATUS] 发送状态通知失败:`, error);
  }
}

// 以下命令已删除，只保留 absoluteRestart
// 如需重新索引，请使用 api.absoluteRestart

/*
// 处理重新索引请求
connection.onRequest("api/reindexAll", async () => {
  console.log("[REINDEX] 收到重新索引请求");

  if (isIndexing) {
    console.log("[REINDEX] 检测到正在进行的索引操作，先取消当前索引");
    await forceCancelIndexing();
    console.log("[REINDEX] 当前索引已取消，开始新的索引");
  }

  console.log("[REINDEX] ===== 开始完全重新索引流程 =====");
  console.log("[REINDEX] 这将清除所有现有索引，从第一个文件开始重新索引");
  isIndexing = true;
  indexingCanceled = false;
  notifyIndexingStatus("indexing", "正在重新索引所有文档...");

  try {
    // 异步执行索引操作，避免阻塞
    await new Promise<void>((resolve, reject) => {
      // 使用 setImmediate 让操作异步执行
      setImmediate(async () => {
        try {
          console.log("[REINDEX] ===== 完全重置索引状态 =====");
          console.log("[REINDEX] 清空现有索引");
          // 清空现有索引
          globalSymbolTable.clear();
          completionIndex.clear();

          // 强制重置所有计数器和状态
          console.log("[REINDEX] 重置所有状态变量");
          console.log("[REINDEX] 索引将从头开始，不保留任何之前的进度");

          // 重置进度跟踪列表
          processedFiles = [];
          failedFiles = [];

          // 首先索引已打开的文档
          const openDocuments = documents.all();
          let indexedCount = 0;
          console.log(`[REINDEX] 找到 ${openDocuments.length} 个已打开的文档`);

          for (const document of openDocuments) {
            // 每处理一个文档后检查取消状态
            if (indexingCanceled) {
              console.log("[REINDEX] 检测到取消信号，停止索引");
              notifyIndexingStatus("idle", "索引已取消");
              isIndexing = false;
              resolve();
              return;
            }

            if (document.uri.endsWith(".api")) {
              console.log(`[REINDEX] 索引已打开文档: ${document.uri}`);
              indexDocument(document, true);
              indexedCount++;

              // 更新进度
              const progress = `已索引 ${indexedCount} 个已打开文档`;
              console.log(`[REINDEX] ${progress}`);
              notifyIndexingStatus("indexing", progress);
            }
          }

          // 然后扫描工作区文件系统中的所有 .api 文件
          if (workspaceRoot) {
            console.log(`[REINDEX] 开始扫描工作区文件系统: ${workspaceRoot}`);
            notifyIndexingStatus("indexing", "正在扫描工作区中的 .api 文件...");

            const workspaceApiFiles = await scanWorkspaceForApiFiles(
              workspaceRoot
            );
            console.log(
              `[REINDEX] 工作区中找到 ${workspaceApiFiles.length} 个 .api 文件`
            );
            console.log(
              `[REINDEX] ===== 开始处理工作区文件，从第1个文件开始 =====`
            );

            for (let i = 0; i < workspaceApiFiles.length; i++) {
              // 检查是否取消
              if (indexingCanceled) {
                console.log("[REINDEX] 检测到取消信号，停止索引");
                notifyIndexingStatus("idle", "索引已取消");
                isIndexing = false;
                resolve();
                return;
              }

              const filePath = workspaceApiFiles[i];
              const fileUri = `file://${filePath}`;
              const isAlreadyOpen = openDocuments.some(
                (doc) => doc.uri === fileUri
              );

              if (!isAlreadyOpen) {
                console.log(
                  `[REINDEX] 索引工作区文件 (${i + 1}/${
                    workspaceApiFiles.length
                  }): ${filePath}`
                );
                console.log(
                  `[REINDEX] 当前处理: 第${
                    i + 1
                  }个文件，文件名: ${path.basename(filePath)}`
                );
                notifyIndexingStatus(
                  "indexing",
                  `正在索引 ${i + 1}/${
                    workspaceApiFiles.length
                  }: ${path.basename(filePath)}`
                );

                try {
                  await indexWorkspaceFile(filePath);
                  indexedCount++;
                  processedFiles.push(filePath);
                  console.log(
                    `[REINDEX] 文件索引成功: ${path.basename(filePath)}`
                  );
                } catch (error) {
                  // 检查是否是取消错误
                  if ((error as Error).message === "索引已取消") {
                    console.log(
                      `[REINDEX] 索引在处理文件 ${path.basename(
                        filePath
                      )} 时被取消`
                    );
                    notifyIndexingStatus("idle", "索引已取消");
                    isIndexing = false;
                    resolve();
                    return;
                  }

                  failedFiles.push(filePath);
                  console.error(
                    `[REINDEX] 文件索引失败: ${path.basename(filePath)}`,
                    error
                  );
                  // 继续处理下一个文件
                }
              } else {
                console.log(`[REINDEX] 跳过已打开文件: ${filePath}`);
              }
            }
          }

          // 检查是否被取消
          if (indexingCanceled) {
            console.log("[REINDEX] 在刷新索引前检测到取消信号");
            notifyIndexingStatus("idle", "索引已取消");
            isIndexing = false;
            resolve();
            return;
          }

          console.log("[REINDEX] 刷新补全索引");
          // 刷新补全索引
          completionIndex.refresh();

          // 检查是否被取消
          if (indexingCanceled) {
            console.log("[REINDEX] 在保存缓存前检测到取消信号");
            notifyIndexingStatus("idle", "索引已取消");
            isIndexing = false;
            resolve();
            return;
          }

          console.log("[REINDEX] 保存缓存");
          // 保存到缓存
          saveCacheToFile();

          console.log(`[REINDEX] 索引完成，共处理 ${indexedCount} 个文档`);
          notifyIndexingStatus(
            "ready",
            `索引完成：${indexedCount} 个文件，${
              globalSymbolTable.getAllSymbols().length
            } 个符号`
          );
          isIndexing = false;
          resolve();
        } catch (error) {
          console.error("[REINDEX] 索引过程中发生错误:", error);

          // 检查是否是取消错误
          if ((error as Error).message === "索引已取消") {
            console.log("[REINDEX] 索引已被取消");
            notifyIndexingStatus("idle", "索引已取消");
          } else {
            notifyIndexingStatus("error", `索引失败: ${error}`);
          }

          isIndexing = false;
          reject(error);
        }
      });
    });
  } catch (error) {
    console.error("[REINDEX] 重新索引失败:", error);

    // 检查是否是取消错误
    if ((error as Error).message === "索引已取消") {
      console.log("[REINDEX] 重新索引已被取消");
      notifyIndexingStatus("idle", "重新索引已取消");
    } else {
      notifyIndexingStatus("error", `索引失败: ${error}`);
      throw error;
    }
  }
});
*/

/*
// 处理取消索引请求
connection.onRequest("api/cancelIndexing", async () => {
  console.log("[CANCEL] 收到取消索引请求");
  console.log(
    `[CANCEL] 当前索引状态: isIndexing=${isIndexing}, indexingCanceled=${indexingCanceled}`
  );

  if (!isIndexing) {
    console.log("[CANCEL] 当前没有索引操作在进行");
    notifyIndexingStatus("idle", "当前没有索引操作在进行");
    return;
  }

  // 使用强制取消函数
  await forceCancelIndexing();
  console.log("[CANCEL] 索引取消完成");
});
*/

/*
// 处理清空索引请求
connection.onRequest("api/clearIndex", async () => {
  console.log("[CLEAR] 收到清空索引请求");
  console.log(
    `[CLEAR] 当前索引状态: isIndexing=${isIndexing}, indexingCanceled=${indexingCanceled}`
  );

  if (isIndexing) {
    console.log("[CLEAR] 索引正在进行中，先取消索引");
    await forceCancelIndexing();
  }

  console.log("[CLEAR] 清空符号表和补全索引");
  globalSymbolTable.clear();
  completionIndex.clear();

  console.log("[CLEAR] 清理缓存文件");
  clearCache(); // 清理缓存文件

  console.log("[CLEAR] 清空操作完成");
  notifyIndexingStatus("idle", "索引和缓存已清空");
});
*/

/*
// 处理强制重置并重新索引请求
connection.onRequest("api/forceResetAndReindex", async () => {
  console.log("[FORCE_RESET] 收到强制重置并重新索引请求");

  try {
    console.log("[FORCE_RESET] ===== 执行绝对强制重置 =====");

    // 立即无条件重置所有状态，不等待任何操作
    isIndexing = false;
    indexingCanceled = true;

    // 清理所有定时器
    clearAllTimers();

    // 重置进度跟踪列表
    processedFiles = [];
    failedFiles = [];

    // 清空所有数据结构
    console.log("[FORCE_RESET] 清空符号表和补全索引");
    globalSymbolTable.clear();
    completionIndex.clear();

    // 清理缓存文件
    console.log("[FORCE_RESET] 清理缓存文件");
    clearCache();

    // 等待短暂时间确保所有异步操作有机会响应取消信号
    console.log("[FORCE_RESET] 等待 1 秒确保清理完成...");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 重置取消标志并开始新的索引
    indexingCanceled = false;
    console.log("[FORCE_RESET] 状态重置完成，开始重新索引...");
    notifyIndexingStatus("indexing", "状态重置完成，正在重新索引...");

    // 重新开始索引，使用 setImmediate 确保异步执行
    setImmediate(() => {
      indexAllDocuments();
    });

    return "强制重置并重新索引已启动（绝对重置模式）";
  } catch (error) {
    console.error("[FORCE_RESET] 强制重置过程中发生错误:", error);

    // 确保状态被重置
    isIndexing = false;
    indexingCanceled = false;
    notifyIndexingStatus("error", "强制重置失败");

    throw error;
  }
});
*/

// ============================================
// 唯一保留的索引命令：绝对重启
// ============================================
// 处理绝对重启请求（杀死一切，从零开始）
connection.onRequest("api/absoluteRestart", async () => {
  console.log("[ABSOLUTE_RESTART] 收到绝对重启请求");
  console.log(
    `[ABSOLUTE_RESTART] 索引系统状态: ${INDEXING_ENABLED ? "启用" : "禁用"}`
  );

  try {
    console.log("[ABSOLUTE_RESTART] ===== 执行绝对重启 =====");

    // 强制清理所有任务和状态
    console.log("[ABSOLUTE_RESTART] 强制清理所有定时器和异步任务");
    forceCleanupAll();

    // 清空所有数据结构
    console.log("[ABSOLUTE_RESTART] 清空所有数据结构");
    globalSymbolTable.clear();
    completionIndex.clear();

    // 清理缓存
    console.log("[ABSOLUTE_RESTART] 清理所有缓存");
    clearCache();

    // 清理文档设置缓存
    console.log("[ABSOLUTE_RESTART] 清理文档设置缓存");
    documentSettings.clear();

    if (!INDEXING_ENABLED) {
      console.log("[ABSOLUTE_RESTART] 索引系统已禁用，只清理状态，不启动索引");
      notifyIndexingStatus("idle", "已清理状态（索引系统已禁用）");
      return "已清理状态（索引系统已禁用）";
    }

    console.log("[ABSOLUTE_RESTART] 清理完成，准备重新索引");
    // notifyIndexingStatus("indexing", "清理完成，准备重新索引...");
    notifyIndexingStatus("idle", "已清理状态");

    // 立即在后台启动安全索引，不要阻塞请求返回
    // setImmediate(() => {
    //   console.log("[ABSOLUTE_RESTART] 启动安全索引进程");
    //   try {
    //     safeIndexAllDocuments();
    //   } catch (error) {
    //     console.error("[ABSOLUTE_RESTART] 启动安全索引失败:", error);
    //     notifyIndexingStatus("error", "启动索引失败");
    //   }
    // });

    console.log("[ABSOLUTE_RESTART] 绝对重启命令已完成，索引在后台运行");
    return "绝对重启完成，索引已在后台启动";
  } catch (error) {
    console.error("[ABSOLUTE_RESTART] 绝对重启失败:", error);

    // 确保状态被完全清理
    forceCleanupAll();
    notifyIndexingStatus("error", "绝对重启失败");

    throw error;
  }
});

/*
// 处理紧急停止请求（立即重置所有状态）
connection.onRequest("api/emergencyStop", async () => {
  console.log("[EMERGENCY] 收到紧急停止请求");

  // 立即重置所有状态，不等待任何操作
  console.log("[EMERGENCY] 立即重置所有状态");
  isIndexing = false;
  indexingCanceled = false;

  // 重置进度跟踪
  processedFiles = [];
  failedFiles = [];

  // 清空数据结构
  globalSymbolTable.clear();
  completionIndex.clear();

  // 设置为空闲状态
  notifyIndexingStatus("idle", "紧急停止完成");

  console.log("[EMERGENCY] 紧急停止完成");
  return "所有索引操作已紧急停止";
});
*/

/*
// 处理获取索引状态请求（调试用）
connection.onRequest("api/getIndexStatus", async () => {
  console.log("[DEBUG] 收到获取索引状态请求");

  const status = {
    isIndexing: isIndexing,
    indexingCanceled: indexingCanceled,
    totalSymbols: globalSymbolTable.getAllSymbols().length,
    processedFilesCount: processedFiles.length,
    failedFilesCount: failedFiles.length,
    processedFiles: processedFiles.map((f) => path.basename(f)),
    failedFiles: failedFiles.map((f) => path.basename(f)),
    lastProcessedFile:
      processedFiles.length > 0
        ? path.basename(processedFiles[processedFiles.length - 1])
        : null,
    lastFailedFile:
      failedFiles.length > 0
        ? path.basename(failedFiles[failedFiles.length - 1])
        : null,
  };

  console.log("[DEBUG] 当前索引状态:", JSON.stringify(status, null, 2));
  return status;
});
*/

// 让文档管理器监听连接
documents.listen(connection);

// 添加进程退出时的清理
process.on("SIGTERM", () => {
  console.log("[CLEANUP] 收到 SIGTERM，开始清理资源");
  clearAllTimers();

  // 设置强制退出超时
  setTimeout(() => {
    console.log("[CLEANUP] SIGTERM处理超时，强制退出");
    process.exit(0);
  }, 100);

  process.exit(0);
});

process.on("exit", (code) => {
  console.log(`[CLEANUP] 进程退出，退出码: ${code}，清理剩余资源`);
  clearAllTimers();
});

// 添加连接关闭处理
connection.onShutdown(() => {
  console.log("[CLEANUP] 收到关闭信号，准备清理资源");

  // 强制取消正在进行的索引操作
  if (isIndexing) {
    console.log("[CLEANUP] 强制取消正在进行的索引操作");
    indexingCanceled = true;
    isIndexing = false;
  }

  // 清理所有定时器
  clearAllTimers();

  console.log("[CLEANUP] 关闭信号处理完成");
});

connection.onExit(() => {
  console.log("[CLEANUP] 连接退出，立即清理所有资源");

  // 强制取消正在进行的索引操作
  if (isIndexing) {
    console.log("[CLEANUP] 强制取消正在进行的索引操作");
    indexingCanceled = true;
    isIndexing = false;
  }

  // 清理所有定时器
  clearAllTimers();

  console.log("[CLEANUP] 连接退出处理完成，立即强制退出进程");

  // 多层保险机制，确保进程一定会退出

  // 第一层：立即尝试退出
  process.nextTick(() => {
    console.log("[CLEANUP] nextTick强制退出");
    process.exit(0);
  });

  // 第二层：使用setImmediate
  setImmediate(() => {
    console.log("[CLEANUP] setImmediate强制退出");
    process.exit(0);
  });

  // 第三层：30ms后强制退出
  setTimeout(() => {
    console.log("[CLEANUP] 30ms超时强制退出");
    process.exit(0);
  }, 30);

  // 第四层：100ms后使用SIGKILL
  setTimeout(() => {
    console.log("[CLEANUP] 100ms超时SIGKILL强制退出");
    try {
      process.kill(process.pid, "SIGKILL");
    } catch (e) {
      process.exit(1);
    }
  }, 100);
});

// 添加进程信号处理，确保异常退出时也能清理资源
function gracefulShutdown(signal: string) {
  console.log(
    `[CLEANUP] 收到${signal}信号，开始清理资源 (PID: ${PROCESS_PID})`
  );

  // 防止重复调用
  if (processShutdownInitiated) {
    console.log("[CLEANUP] 关闭已在进行中，立即退出");
    process.exit(0);
    return;
  }
  processShutdownInitiated = true;

  // 强制取消正在进行的索引操作
  if (isIndexing) {
    console.log("[CLEANUP] 强制取消正在进行的索引操作");
    indexingCanceled = true;
    isIndexing = false;
  }

  // 清理所有定时器
  try {
    clearAllTimers();
  } catch (e) {
    console.error("[CLEANUP] 清理定时器失败:", e);
  }

  console.log("[CLEANUP] 资源清理完成，立即强制退出进程");

  // 多层强制退出保险
  process.nextTick(() => {
    console.log("[CLEANUP] nextTick强制退出");
    process.exit(0);
  });

  setImmediate(() => {
    console.log("[CLEANUP] setImmediate强制退出");
    process.exit(0);
  });

  // 50ms后使用SIGKILL
  setTimeout(() => {
    console.log("[CLEANUP] 50ms超时SIGKILL");
    try {
      process.kill(process.pid, "SIGKILL");
    } catch (e) {
      process.exit(1);
    }
  }, 50);

  // 立即尝试退出
  process.exit(0);
} // 监听常见的退出信号（移除重复处理）
// process.on("SIGINT", ...) 等在上面的保险机制中已经处理

// 添加其他信号处理
process.on("SIGPIPE", () => gracefulShutdown("SIGPIPE"));
process.on("SIGUSR1", () => gracefulShutdown("SIGUSR1"));
process.on("SIGUSR2", () => gracefulShutdown("SIGUSR2"));

// 添加未捕获异常和未处理的 Promise 拒绝处理
process.on("uncaughtException", (error) => {
  console.error("[ERROR] 未捕获的异常:", error);
  console.error("[ERROR] 堆栈:", error.stack);

  // 不要立即退出，尝试恢复
  try {
    // 重置索引状态，防止卡住
    if (isIndexing) {
      console.log("[ERROR] 重置索引状态");
      isIndexing = false;
      indexingCanceled = false;
    }

    // 清理定时器
    clearAllTimers();

    console.log("[ERROR] 服务器状态已重置，继续运行");
  } catch (recoveryError) {
    console.error("[ERROR] 恢复失败，准备退出:", recoveryError);
    // 只有在恢复失败时才退出
    setTimeout(() => {
      gracefulShutdown("uncaughtException");
    }, 1000);
  }
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[ERROR] 未处理的 Promise 拒绝:", reason);
  console.error("[ERROR] Promise:", promise);

  // 不要立即退出，记录错误但继续运行
  try {
    // 如果是索引相关的错误，重置状态
    if (isIndexing) {
      console.log("[ERROR] 索引过程中发生Promise拒绝，重置索引状态");
      isIndexing = false;
      indexingCanceled = false;
      notifyIndexingStatus("error", "索引过程中发生错误");
    }
  } catch (recoveryError) {
    console.error("[ERROR] 处理Promise拒绝时发生错误:", recoveryError);
  }
});

// 添加绝对退出保险机制
let shutdownInitiated = false;
function forceExitAfterDelay() {
  if (shutdownInitiated) return;
  shutdownInitiated = true;
  processShutdownInitiated = true;

  console.log("[CLEANUP] 启动1秒强制退出保险机制");

  // 缩短超时时间，更快退出
  setTimeout(() => {
    console.log("[CLEANUP] 1秒保险机制触发，使用SIGKILL强制退出进程");
    try {
      process.kill(process.pid, "SIGKILL");
    } catch (e) {
      process.exit(1);
    }
  }, 1000);
}

// 监听所有可能的退出信号，触发保险机制
process.on("SIGINT", () => {
  forceExitAfterDelay();
  gracefulShutdown("SIGINT");
});
process.on("SIGTERM", () => {
  forceExitAfterDelay();
  gracefulShutdown("SIGTERM");
});
process.on("SIGHUP", () => {
  forceExitAfterDelay();
  gracefulShutdown("SIGHUP");
});
process.on("SIGQUIT", () => {
  forceExitAfterDelay();
  gracefulShutdown("SIGQUIT");
});

// 监听连接
connection.listen();
