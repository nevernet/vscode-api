import { SymbolTable, Symbol, SymbolKind } from "./symbols";
import { CompletionItem, CompletionItemKind } from "vscode-languageserver/node";

/**
 * 代码补全索引系统
 * 专门为代码提示提供快速的符号索引和补全建议
 */
export class CompletionIndex {
  private symbolTable: SymbolTable;
  private cachedCompletions: Map<string, CompletionItem[]> = new Map();
  private lastUpdateTime: number = 0;
  private cacheExpireTime: number = 30000; // 30秒缓存过期

  constructor(symbolTable: SymbolTable) {
    this.symbolTable = symbolTable;
  }

  /**
   * 获取结构体补全项
   */
  public getStructCompletions(): CompletionItem[] {
    const cacheKey = "structs";
    if (this.isCacheValid(cacheKey)) {
      return this.cachedCompletions.get(cacheKey) || [];
    }

    const items: CompletionItem[] = [];
    const structs = this.symbolTable.getSymbolsOfKind(SymbolKind.Struct);

    for (const struct of structs) {
      items.push({
        label: struct.name,
        kind: CompletionItemKind.Struct,
        detail: `struct ${struct.name}`,
        documentation: struct.documentation || `结构体定义: ${struct.name}`,
        insertText: struct.name,
      });
    }

    this.cachedCompletions.set(cacheKey, items);
    return items;
  }

  /**
   * 获取枚举补全项
   */
  public getEnumCompletions(): CompletionItem[] {
    const cacheKey = "enums";
    if (this.isCacheValid(cacheKey)) {
      return this.cachedCompletions.get(cacheKey) || [];
    }

    const items: CompletionItem[] = [];
    const enums = this.symbolTable.getSymbolsOfKind(SymbolKind.Enum);

    for (const enumSymbol of enums) {
      items.push({
        label: enumSymbol.name,
        kind: CompletionItemKind.Enum,
        detail: `enum ${enumSymbol.name}`,
        documentation:
          enumSymbol.documentation || `枚举定义: ${enumSymbol.name}`,
        insertText: enumSymbol.name,
      });
    }

    this.cachedCompletions.set(cacheKey, items);
    return items;
  }

  /**
   * 获取枚举值补全项
   */
  public getEnumValueCompletions(): CompletionItem[] {
    const cacheKey = "enumValues";
    if (this.isCacheValid(cacheKey)) {
      return this.cachedCompletions.get(cacheKey) || [];
    }

    const items: CompletionItem[] = [];
    const enumValues = this.symbolTable.getSymbolsOfKind(SymbolKind.EnumValue);

    for (const enumValue of enumValues) {
      items.push({
        label: enumValue.name,
        kind: CompletionItemKind.EnumMember,
        detail: `${enumValue.parent}.${enumValue.name}`,
        documentation: enumValue.documentation || `枚举值: ${enumValue.name}`,
        insertText: enumValue.name,
      });
    }

    this.cachedCompletions.set(cacheKey, items);
    return items;
  }

  /**
   * 获取API补全项
   */
  public getApiCompletions(): CompletionItem[] {
    const cacheKey = "apis";
    if (this.isCacheValid(cacheKey)) {
      return this.cachedCompletions.get(cacheKey) || [];
    }

    const items: CompletionItem[] = [];
    const apis = this.symbolTable.getSymbolsOfKind(SymbolKind.Api);

    for (const api of apis) {
      items.push({
        label: api.name,
        kind: CompletionItemKind.Function,
        detail: `api "${api.name}"`,
        documentation: api.documentation || `API定义: ${api.name}`,
        insertText: `"${api.name}"`,
      });
    }

    this.cachedCompletions.set(cacheKey, items);
    return items;
  }

  /**
   * 获取字段补全项（用于结构体内部）
   */
  public getFieldCompletions(structName?: string): CompletionItem[] {
    const cacheKey = `fields_${structName || "all"}`;
    if (this.isCacheValid(cacheKey)) {
      return this.cachedCompletions.get(cacheKey) || [];
    }

    const items: CompletionItem[] = [];
    let fields: Symbol[];

    if (structName) {
      // 获取特定结构体的字段
      fields = this.symbolTable.getStructFields(structName);
    } else {
      // 获取所有字段
      fields = this.symbolTable.getSymbolsOfKind(SymbolKind.Field);
    }

    for (const field of fields) {
      items.push({
        label: field.name,
        kind: CompletionItemKind.Field,
        detail: `${field.name}: ${field.type || "unknown"}`,
        documentation: field.documentation || `字段: ${field.name}`,
        insertText: field.name,
      });
    }

    this.cachedCompletions.set(cacheKey, items);
    return items;
  }

  /**
   * 获取所有类型补全项（结构体 + 枚举 + 基础类型）
   */
  public getAllTypeCompletions(): CompletionItem[] {
    const cacheKey = "allTypes";
    if (this.isCacheValid(cacheKey)) {
      return this.cachedCompletions.get(cacheKey) || [];
    }

    const items: CompletionItem[] = [];

    // 添加基础类型
    const basicTypes = [
      { name: "int", detail: "整数类型" },
      { name: "string", detail: "字符串类型" },
      { name: "bool", detail: "布尔类型" },
      { name: "float", detail: "浮点类型" },
      { name: "double", detail: "双精度浮点类型" },
    ];

    for (const type of basicTypes) {
      items.push({
        label: type.name,
        kind: CompletionItemKind.TypeParameter,
        detail: type.detail,
        insertText: type.name,
      });
    }

    // 添加用户定义的结构体
    items.push(...this.getStructCompletions());

    // 添加用户定义的枚举
    items.push(...this.getEnumCompletions());

    this.cachedCompletions.set(cacheKey, items);
    return items;
  }

  /**
   * 根据上下文获取智能补全建议
   */
  public getContextualCompletions(
    context: CompletionContext
  ): CompletionItem[] {
    const items: CompletionItem[] = [];

    switch (context.type) {
      case "struct-field-type":
        // 结构体字段类型位置
        items.push(...this.getAllTypeCompletions());
        break;

      case "api-input-output":
        // API的input/output位置
        items.push(...this.getStructCompletions());
        break;

      case "enum-value":
        // 枚举值位置
        items.push(...this.getEnumValueCompletions());
        break;

      case "global-scope":
        // 全局作用域
        items.push(...this.getGlobalKeywords());
        items.push(...this.getStructCompletions());
        items.push(...this.getApiCompletions());
        break;

      case "struct-reference":
        // 引用结构体的位置
        items.push(...this.getStructCompletions());
        break;

      default:
        // 默认补全
        items.push(...this.getBasicCompletions());
        break;
    }

    // 限制返回数量，避免过多选项影响性能
    return items.slice(0, 50);
  }

  /**
   * 获取基础关键字补全
   */
  public getGlobalKeywords(): CompletionItem[] {
    return [
      {
        label: "typedef",
        kind: CompletionItemKind.Keyword,
        detail: "类型定义关键字",
      },
      {
        label: "struct",
        kind: CompletionItemKind.Keyword,
        detail: "结构体关键字",
      },
      { label: "enum", kind: CompletionItemKind.Keyword, detail: "枚举关键字" },
      {
        label: "api",
        kind: CompletionItemKind.Keyword,
        detail: "API定义关键字",
      },
      {
        label: "apilist",
        kind: CompletionItemKind.Keyword,
        detail: "API列表关键字",
      },
      {
        label: "input",
        kind: CompletionItemKind.Keyword,
        detail: "输入参数关键字",
      },
      {
        label: "output",
        kind: CompletionItemKind.Keyword,
        detail: "输出参数关键字",
      },
    ];
  }

  /**
   * 获取基础补全项
   */
  public getBasicCompletions(): CompletionItem[] {
    const items: CompletionItem[] = [];
    items.push(...this.getGlobalKeywords());
    items.push(...this.getAllTypeCompletions().slice(0, 10)); // 限制类型数量
    return items;
  }

  /**
   * 清除缓存
   */
  public clearCache(): void {
    this.cachedCompletions.clear();
    this.lastUpdateTime = 0;
  }

  /**
   * 清空索引（重置所有状态）
   */
  public clear(): void {
    this.cachedCompletions.clear();
    this.lastUpdateTime = 0;
  }

  /**
   * 强制刷新索引
   */
  public refresh(): void {
    this.clearCache();
    this.lastUpdateTime = Date.now();
  }

  /**
   * 检查缓存是否有效
   */
  private isCacheValid(cacheKey: string): boolean {
    const now = Date.now();
    if (now - this.lastUpdateTime > this.cacheExpireTime) {
      return false;
    }
    return this.cachedCompletions.has(cacheKey);
  }
}

/**
 * 补全上下文接口
 */
export interface CompletionContext {
  type:
    | "struct-field-type"
    | "api-input-output"
    | "enum-value"
    | "global-scope"
    | "struct-reference"
    | "unknown";
  structName?: string;
  enumName?: string;
  line?: string;
  position?: { line: number; character: number };
}

/**
 * 分析当前位置的补全上下文
 */
export function analyzeCompletionContext(
  currentLine: string,
  lines: string[],
  position: { line: number; character: number }
): CompletionContext {
  const line = currentLine.trim().toLowerCase();
  const lineToPosition = currentLine
    .substring(0, position.character)
    .trim()
    .toLowerCase();

  // 检查是否在结构体字段类型位置
  if (lineToPosition.match(/^\s*\w+\s+$/) && isInStruct(lines, position.line)) {
    return { type: "struct-field-type", line: currentLine, position };
  }

  // 检查是否在API的input/output位置
  if (line.includes("input ") || line.includes("output ")) {
    return { type: "api-input-output", line: currentLine, position };
  }

  // 检查是否在枚举值位置
  if (isInEnum(lines, position.line)) {
    return { type: "enum-value", line: currentLine, position };
  }

  // 检查是否在结构体引用位置
  if (lineToPosition.includes("input") || lineToPosition.includes("output")) {
    return { type: "struct-reference", line: currentLine, position };
  }

  // 检查是否在全局作用域
  if (!isInAnyBlock(lines, position.line)) {
    return { type: "global-scope", line: currentLine, position };
  }

  return { type: "unknown", line: currentLine, position };
}

/**
 * 检查是否在结构体内部
 */
function isInStruct(lines: string[], currentLineIndex: number): boolean {
  let braceCount = 0;
  let inStruct = false;

  for (let i = 0; i <= currentLineIndex; i++) {
    const line = lines[i] || "";

    if (line.includes("struct {")) {
      inStruct = true;
      braceCount = 1;
    } else if (line.includes("{")) {
      braceCount++;
    } else if (line.includes("}")) {
      braceCount--;
      if (braceCount === 0) {
        inStruct = false;
      }
    }
  }

  return inStruct && braceCount > 0;
}

/**
 * 检查是否在枚举内部
 */
function isInEnum(lines: string[], currentLineIndex: number): boolean {
  let braceCount = 0;
  let inEnum = false;

  for (let i = 0; i <= currentLineIndex; i++) {
    const line = lines[i] || "";

    if (line.includes("enum {")) {
      inEnum = true;
      braceCount = 1;
    } else if (line.includes("{")) {
      braceCount++;
    } else if (line.includes("}")) {
      braceCount--;
      if (braceCount === 0) {
        inEnum = false;
      }
    }
  }

  return inEnum && braceCount > 0;
}

/**
 * 检查是否在任何代码块内部
 */
function isInAnyBlock(lines: string[], currentLineIndex: number): boolean {
  let braceCount = 0;

  for (let i = 0; i <= currentLineIndex; i++) {
    const line = lines[i] || "";

    if (line.includes("{")) {
      braceCount++;
    } else if (line.includes("}")) {
      braceCount--;
    }
  }

  return braceCount > 0;
}
