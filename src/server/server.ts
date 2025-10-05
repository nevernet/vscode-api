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

// 代码补全
connection.onCompletion(
  (textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    const items: CompletionItem[] = [];
    const document = documents.get(textDocumentPosition.textDocument.uri);

    if (!document) {
      return items;
    }

    try {
      // 确保文档已经被索引
      indexDocument(document);

      const text = document.getText();
      const position = textDocumentPosition.position;
      const lines = text.split("\n");
      const currentLine = lines[position.line] || "";
      const currentLineToPosition = currentLine.substring(
        0,
        position.character
      );

      // 分析当前上下文（使用优化后的版本）
      const context = analyzeCompletionContext(
        currentLineToPosition,
        lines,
        position
      );

      // 根据上下文提供不同的补全建议
      switch (context.type) {
        case "struct-reference":
          // 在需要结构体引用的地方（如 input, output）
          addStructCompletions(items);
          break;
        case "field-definition":
          // 在字段定义中
          addTypeCompletions(items);
          addStructCompletions(items);
          break;
        case "api-definition":
          // 在API定义中
          addApiBodyKeywords(items);
          break;
        case "global-scope":
          // 在全局作用域
          addGlobalKeywords(items);
          break;
        default:
          // 默认补全
          addAllCompletions(items);
      }

      return items;
    } catch (error) {
      // 错误处理，避免崩溃
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

  // 检查是否在 input 或 output 语句中
  if (line.includes("input ") || line.includes("output ")) {
    return { type: "struct-reference" };
  }

  // 优化：只检查当前行附近的上下文，避免遍历整个文档
  const startLine = Math.max(0, position.line - 20); // 只检查前20行
  const endLine = Math.min(lines.length - 1, position.line + 5); // 只检查后5行

  let braceLevel = 0;
  let inApiDefinition = false;
  let inApiListDefinition = false;
  let inStructDefinition = false;

  // 从起始行开始分析上下文
  for (let i = startLine; i <= endLine; i++) {
    const lineText = lines[i];

    // 检查API定义开始
    if (lineText.includes("api ") && lineText.includes("{")) {
      inApiDefinition = true;
    }
    if (lineText.includes("apilist ") && lineText.includes("{")) {
      inApiListDefinition = true;
    }
    if (lineText.includes("struct {")) {
      inStructDefinition = true;
    }

    // 计算大括号层级（只对当前行之前的行计算）
    if (i <= position.line) {
      for (const char of lineText) {
        if (char === "{") braceLevel++;
        if (char === "}") braceLevel--;
      }
    }
  }

  // 简化的上下文判断
  if ((inApiDefinition || inApiListDefinition) && braceLevel > 0) {
    return { type: "api-definition" };
  }

  if (inStructDefinition && braceLevel > 0) {
    return { type: "field-definition" };
  }

  return { type: "global-scope" };
}

// 添加结构体补全
function addStructCompletions(items: CompletionItem[]) {
  const structSymbols = globalSymbolTable.getSymbolsOfKind(SymbolKind.Struct);
  for (const symbol of structSymbols) {
    items.push({
      label: symbol.name,
      kind: CompletionItemKind.Struct,
      detail: symbol.detail,
      documentation: symbol.documentation,
      sortText: "0" + symbol.name, // 优先显示
    });
  }
}

// 添加类型补全
function addTypeCompletions(items: CompletionItem[]) {
  // 内置类型
  const builtinTypes = [
    "int",
    "long",
    "uint",
    "ulong",
    "bool",
    "boolean",
    "float",
    "double",
    "string",
    "number",
  ];
  for (const type of builtinTypes) {
    items.push({
      label: type,
      kind: CompletionItemKind.TypeParameter,
      detail: `built-in type`,
      documentation: `Built-in type: ${type}`,
      sortText: "1" + type,
    });
  }

  // 用户定义的结构体也可以作为类型使用
  addStructCompletions(items);
}

// 添加API体关键字
function addApiBodyKeywords(items: CompletionItem[]) {
  const apiKeywords = ["input", "output", "extract"];
  for (const keyword of apiKeywords) {
    items.push({
      label: keyword,
      kind: CompletionItemKind.Keyword,
      detail: `API keyword`,
      documentation: `API body keyword: ${keyword}`,
      sortText: "0" + keyword,
    });
  }
}

// 添加全局关键字
function addGlobalKeywords(items: CompletionItem[]) {
  const globalKeywords = ["typedef", "struct", "enum", "api", "apilist"];
  for (const keyword of globalKeywords) {
    items.push({
      label: keyword,
      kind: CompletionItemKind.Keyword,
      detail: `keyword`,
      documentation: `Global keyword: ${keyword}`,
      sortText: "0" + keyword,
    });
  }
}

// 添加所有补全（回退选项）
function addAllCompletions(items: CompletionItem[]) {
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
      kind: kind,
      detail: symbol.detail,
      documentation: symbol.documentation,
    });
  }
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
      return [];
    }
  }
);

function formatApiDocument(
  text: string,
  formatSettings: { indentSize: number; alignFields: boolean }
): string {
  const lines = text.split("\n");
  const formattedLines: string[] = [];
  let indentLevel = 0;
  const indentSize = formatSettings.indentSize; // 使用配置的缩进大小
  let currentContext: string[] = []; // 跟踪当前上下文

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 处理空行和注释
    if (!line || line.startsWith("//")) {
      formattedLines.push(line);
      continue;
    }

    // 减少缩进的情况
    if (line === "}") {
      indentLevel = Math.max(0, indentLevel - 1);
      currentContext.pop();
    }

    // 添加缩进
    const indent = " ".repeat(indentLevel * indentSize);

    // 特殊处理字段定义 - 进行对齐
    if (
      isFieldDefinition(line) &&
      isInStructOrEnum(currentContext) &&
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
      // 跟踪当前上下文
      if (line.includes("struct")) {
        currentContext.push("struct");
      } else if (line.includes("enum")) {
        currentContext.push("enum");
      } else if (line.includes("apilist")) {
        currentContext.push("apilist");
      } else {
        currentContext.push("block");
      }
    }
  }

  return formattedLines.join("\n");
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
      context[context.length - 1] === "enum")
  );
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
