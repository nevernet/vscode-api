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
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
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

// 创建服务器连接
const connection = createConnection(ProposedFeatures.all);

// 创建文档管理器
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// 全局符号表
const globalSymbolTable = new SymbolTable();

// 配置接口
interface ApiLanguageServerSettings {
  maxNumberOfProblems: number;
}

// 默认设置
const defaultSettings: ApiLanguageServerSettings = { maxNumberOfProblems: 100 };
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
    });
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
});

// 文档内容变更时验证
documents.onDidChangeContent((change) => {
  validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const settings = await getDocumentSettings(textDocument.uri);
  const text = textDocument.getText();

  const diagnostics: Diagnostic[] = [];

  try {
    // 解析文档
    const lexer = new ApiLexer(text);
    const parser = new ApiParser(lexer);
    const ast = parser.parse(text);

    // 收集符号
    const collector = new SymbolCollector(globalSymbolTable, textDocument.uri);
    collector.collect(ast);

    // 检查重复定义
    const duplicates = globalSymbolTable.getDuplicates();
    for (const [name, symbols] of duplicates) {
      if (symbols.length > 1) {
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
    }
  }

  // 限制诊断数量
  if (diagnostics.length > settings.maxNumberOfProblems) {
    diagnostics.splice(settings.maxNumberOfProblems);
  }

  // 发送诊断结果
  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

// 代码补全
connection.onCompletion(
  (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    const items: CompletionItem[] = [];

    // 添加关键字补全
    for (const keyword of KEYWORDS) {
      items.push({
        label: keyword,
        kind: CompletionItemKind.Keyword,
        detail: `keyword`,
        documentation: `API language keyword: ${keyword}`,
      });
    }

    // 添加常量补全
    for (const constant of CONSTANTS) {
      items.push({
        label: constant,
        kind: CompletionItemKind.Constant,
        detail: `constant`,
        documentation: `API language constant: ${constant}`,
      });
    }

    // 添加内置类型补全
    const builtinSymbols = getBuiltinSymbols();
    for (const symbol of builtinSymbols) {
      items.push({
        label: symbol.name,
        kind: CompletionItemKind.TypeParameter,
        detail: symbol.detail,
        documentation: symbol.documentation,
      });
    }

    // 添加用户定义的符号补全
    const userSymbols = globalSymbolTable.getAllSymbols();
    for (const symbol of userSymbols) {
      let kind: CompletionItemKind;
      switch (symbol.kind) {
        case SymbolKind.Struct:
          kind = CompletionItemKind.Struct;
          break;
        case SymbolKind.Field:
          kind = CompletionItemKind.Field;
          break;
        case SymbolKind.Enum:
          kind = CompletionItemKind.Enum;
          break;
        case SymbolKind.EnumValue:
          kind = CompletionItemKind.EnumMember;
          break;
        case SymbolKind.Api:
          kind = CompletionItemKind.Function;
          break;
        default:
          kind = CompletionItemKind.Text;
      }

      items.push({
        label: symbol.name,
        kind,
        detail: symbol.detail,
        documentation: symbol.documentation,
      });
    }

    return items;
  }
);

// 补全项解析
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  return item;
});

// 跳转到定义
connection.onDefinition(
  (params: TextDocumentPositionParams): Location[] | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return null;
    }

    // 获取当前位置的词
    const text = document.getText();
    const offset = document.offsetAt(params.position);

    // 简单的词边界检测
    let start = offset;
    let end = offset;

    // 向前查找词的开始
    while (start > 0 && /[a-zA-Z0-9_]/.test(text[start - 1])) {
      start--;
    }

    // 向后查找词的结束
    while (end < text.length && /[a-zA-Z0-9_]/.test(text[end])) {
      end++;
    }

    const word = text.substring(start, end);
    if (!word) {
      return null;
    }

    // 查找符号定义
    const symbol = globalSymbolTable.getSymbol(word);
    if (symbol) {
      return [symbol.location];
    }

    return null;
  }
);

// 查找引用
connection.onReferences((params): Location[] => {
  const locations: Location[] = [];
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return locations;
  }

  // 获取当前位置的词
  const text = document.getText();
  const offset = document.offsetAt(params.position);

  let start = offset;
  let end = offset;

  while (start > 0 && /[a-zA-Z0-9_]/.test(text[start - 1])) {
    start--;
  }

  while (end < text.length && /[a-zA-Z0-9_]/.test(text[end])) {
    end++;
  }

  const word = text.substring(start, end);
  if (!word) {
    return locations;
  }

  // 在当前文档中查找所有引用
  const lines = text.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    let match;
    const regex = new RegExp(`\\b${word}\\b`, "g");

    while ((match = regex.exec(line)) !== null) {
      const location: Location = {
        uri: params.textDocument.uri,
        range: {
          start: { line: lineIndex, character: match.index },
          end: { line: lineIndex, character: match.index + word.length },
        },
      };
      locations.push(location);
    }
  }

  return locations;
});

// 悬停信息
connection.onHover((params): { contents: string } | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  // 获取当前位置的词
  const text = document.getText();
  const offset = document.offsetAt(params.position);

  let start = offset;
  let end = offset;

  while (start > 0 && /[a-zA-Z0-9_]/.test(text[start - 1])) {
    start--;
  }

  while (end < text.length && /[a-zA-Z0-9_]/.test(text[end])) {
    end++;
  }

  const word = text.substring(start, end);
  if (!word) {
    return null;
  }

  // 查找符号信息
  const symbol = globalSymbolTable.getSymbol(word);
  if (symbol) {
    return {
      contents: `**${symbol.detail}**\n\n${symbol.documentation || ""}`,
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
});

// 让文档管理器监听连接
documents.listen(connection);

// 监听连接
connection.listen();
