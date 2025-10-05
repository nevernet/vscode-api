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

// 文档内容变更时验证和索引
documents.onDidChangeContent((change) => {
  // 自动索引文档（异步，不阻塞）
  setTimeout(() => {
    indexDocument(change.document);
  }, 100); // 延迟100ms，避免频繁的输入导致性能问题

  validateTextDocument(change.document);
});

// 文档打开时索引
documents.onDidOpen((event) => {
  // 立即索引新打开的文档
  indexDocument(event.document);
  validateTextDocument(event.document);
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

// 代码补全 - 超轻量级版本
connection.onCompletion(
  (textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    try {
      const document = documents.get(textDocumentPosition.textDocument.uri);
      if (!document) {
        return [];
      }

      const text = document.getText();

      // 严格的性能保护：对于任何较大文档，只返回最基本的补全
      if (text.length > 5000) {
        // 5KB 严格限制
        return [
          { label: "struct", kind: CompletionItemKind.Keyword },
          { label: "api", kind: CompletionItemKind.Keyword },
          { label: "int", kind: CompletionItemKind.TypeParameter },
          { label: "string", kind: CompletionItemKind.TypeParameter },
        ];
      }

      const position = textDocumentPosition.position;
      const lines = text.split("\n");
      const currentLine = lines[position.line] || "";

      // 非常简单的上下文检测 - 只检查当前行
      const line = currentLine.trim().toLowerCase();
      const items: CompletionItem[] = [];

      if (line.includes("struct")) {
        // 结构体定义
        addTypeCompletions(items);
      } else if (line.includes("api")) {
        // API定义
        addApiBodyKeywords(items);
      } else if (line.includes("input") || line.includes("output")) {
        // 输入输出
        addStructCompletions(items);
      } else {
        // 默认情况
        addGlobalKeywords(items);
      }

      // 限制返回数量，防止过多选项
      return items.slice(0, 10);
    } catch (error) {
      console.error("Completion error:", error);
      return [];
    }
  }
);

// 文档索引功能
function indexDocument(document: TextDocument) {
  try {
    const text = document.getText();
    const lexer = new ApiLexer(text);
    const parser = new ApiParser(lexer);
    const ast = parser.parse(text);

    // 收集符号
    const collector = new SymbolCollector(globalSymbolTable, document.uri);
    collector.collect(ast);
  } catch (error) {
    // 解析错误不影响自动完成功能
    console.warn("Document indexing failed:", (error as Error).message);
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
        console.warn("Document too large for formatting:", text.length);
        return [];
      }

      const formattedText = formatApiDocument(text, settings.format);

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
      console.error("Formatting error:", error);
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
    if (!text || typeof text !== 'string') {
      console.warn("Invalid text input for formatting");
      return text || '';
    }
    
    if (!formatSettings || typeof formatSettings.indentSize !== 'number') {
      console.warn("Invalid format settings");
      return text;
    }

    const lines = text.split("\n");
    const formattedLines: string[] = [];
    let indentLevel = 0;
    const indentSize = Math.max(0, formatSettings.indentSize); // 确保缩进大小不为负数
    let currentContext: string[] = []; // 跟踪当前上下文

  for (let i = 0; i < lines.length; i++) {
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

// 让文档管理器监听连接
documents.listen(connection);

// 监听连接
connection.listen();
