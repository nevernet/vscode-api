import {
  Program,
  TypedefStatement,
  StructDefinition,
  InlineStructDefinition,
  FieldDefinition,
  ApiDefinition,
  ApiListDefinition,
  EnumDefinition,
  EnumValue,
  TypeReference,
  Identifier,
  ASTVisitor,
  walkAST,
} from "./ast";

// 符号类型
export enum SymbolKind {
  Struct = "struct",
  Field = "field",
  Api = "api",
  ApiList = "apilist",
  Enum = "enum",
  EnumValue = "enumValue",
  Type = "type",
}

// 符号信息
export interface Symbol {
  name: string;
  kind: SymbolKind;
  location: {
    uri: string;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  };
  detail?: string;
  documentation?: string;
  parent?: string; // 父符号名称（用于字段等）
  type?: string; // 类型信息
}

// 符号表
export class SymbolTable {
  private symbols = new Map<string, Symbol>();
  private structFields = new Map<string, Map<string, Symbol>>(); // struct名 -> 字段映射
  private duplicates = new Map<string, Symbol[]>(); // 重复定义检查

  public addSymbol(symbol: Symbol): void {
    const key = symbol.parent ? `${symbol.parent}.${symbol.name}` : symbol.name;

    // 重复定义检查仅针对 struct 字段和 enum 字段
    if (this.symbols.has(key)) {
      const existing = this.symbols.get(key)!;

      // 只检查同一个结构体内的字段重复定义
      if (
        symbol.kind === SymbolKind.Field &&
        existing.kind === SymbolKind.Field
      ) {
        if (existing.parent === symbol.parent) {
          if (!this.duplicates.has(key)) {
            this.duplicates.set(key, [existing]);
          }
          this.duplicates.get(key)!.push(symbol);
        }
      }
      // 只检查同一个枚举内的枚举值重复定义
      else if (
        symbol.kind === SymbolKind.EnumValue &&
        existing.kind === SymbolKind.EnumValue
      ) {
        if (existing.parent === symbol.parent) {
          if (!this.duplicates.has(key)) {
            this.duplicates.set(key, [existing]);
          }
          this.duplicates.get(key)!.push(symbol);
        }
      }
      // 不检查其他类型的重复定义（struct, enum, api, apilist 等）
    }

    this.symbols.set(key, symbol);

    // 如果是字段，也添加到结构体字段映射中（用于快速查找）
    if (symbol.kind === SymbolKind.Field && symbol.parent) {
      if (!this.structFields.has(symbol.parent)) {
        this.structFields.set(symbol.parent, new Map());
      }
      const structFields = this.structFields.get(symbol.parent)!;
      structFields.set(symbol.name, symbol);
    }
  }

  public getSymbol(name: string, parent?: string): Symbol | undefined {
    const key = parent ? `${parent}.${name}` : name;
    return this.symbols.get(key) || this.symbols.get(name);
  }

  public getSymbolsByName(name: string): Symbol[] {
    const symbols: Symbol[] = [];
    for (const symbol of this.symbols.values()) {
      if (symbol.name === name) {
        symbols.push(symbol);
      }
    }
    return symbols;
  }

  public getAllSymbols(): Symbol[] {
    return Array.from(this.symbols.values());
  }

  public getSymbolsOfKind(kind: SymbolKind): Symbol[] {
    return Array.from(this.symbols.values()).filter((s) => s.kind === kind);
  }

  public getStructFields(structName: string): Symbol[] {
    const fields = this.structFields.get(structName);
    return fields ? Array.from(fields.values()) : [];
  }

  public getDuplicates(): Map<string, Symbol[]> {
    return this.duplicates;
  }

  public findSymbolsByPrefix(prefix: string): Symbol[] {
    return Array.from(this.symbols.values()).filter((symbol) =>
      symbol.name.toLowerCase().startsWith(prefix.toLowerCase())
    );
  }

  public clear(): void {
    this.symbols.clear();
    this.structFields.clear();
    this.duplicates.clear();
  }
}

// 符号收集器
export class SymbolCollector implements ASTVisitor<void> {
  private symbolTable: SymbolTable;
  private currentUri: string;
  private typedefContext: string | null = null; // 跟踪当前是否在 typedef 上下文中

  constructor(symbolTable: SymbolTable, uri: string) {
    this.symbolTable = symbolTable;
    this.currentUri = uri;
  }

  public collect(program: Program): void {
    this.visitProgram(program);
  }

  visitProgram(node: Program): void {
    for (const statement of node.body) {
      walkAST(statement, this);
    }
  }

  visitTypedefStatement(node: TypedefStatement): void {
    if (node.structDef) {
      // 设置 typedef struct 上下文
      this.typedefContext = node.name.name;

      // 处理结构体定义
      const symbol: Symbol = {
        name: node.name.name,
        kind: SymbolKind.Struct,
        location: {
          uri: this.currentUri,
          range: {
            start: { line: node.line - 1, character: node.column - 1 },
            end: {
              line: node.line - 1,
              character: node.column - 1 + node.name.name.length,
            },
          },
        },
        detail: `struct ${node.name.name}`,
        documentation: `Struct definition for ${node.name.name}`,
      };

      this.symbolTable.addSymbol(symbol);

      // 收集结构体字段 - walkAST 会自动调用 visitFieldDefinition
      walkAST(node.structDef, this);

      // 清除 typedef 上下文
      this.typedefContext = null;
    } else if (node.enumDef) {
      // 设置 typedef enum 上下文
      this.typedefContext = node.name.name;

      // 处理枚举定义
      const symbol: Symbol = {
        name: node.name.name,
        kind: SymbolKind.Enum,
        location: {
          uri: this.currentUri,
          range: {
            start: { line: node.line - 1, character: node.column - 1 },
            end: {
              line: node.line - 1,
              character: node.column - 1 + node.name.name.length,
            },
          },
        },
        detail: `enum ${node.name.name}`,
        documentation: `Enum definition for ${node.name.name}`,
      };

      this.symbolTable.addSymbol(symbol);

      // 收集枚举值 - walkAST 会自动调用 visitEnumValue
      walkAST(node.enumDef, this);

      // 清除 typedef 上下文
      this.typedefContext = null;
    }
  }

  visitApiDefinition(node: ApiDefinition): void {
    const symbol: Symbol = {
      name: node.uri.value,
      kind: SymbolKind.Api,
      location: {
        uri: this.currentUri,
        range: {
          start: { line: node.line - 1, character: node.column - 1 },
          end: {
            line: node.line - 1,
            character: node.column - 1 + node.uri.value.length,
          },
        },
      },
      detail: `api "${node.uri.value}"`,
      documentation: `API definition for ${node.uri.value}`,
    };

    this.symbolTable.addSymbol(symbol);

    // 收集API体内的符号
    for (const stmt of node.body) {
      walkAST(stmt, this);
    }
  }

  visitApiListDefinition(node: ApiListDefinition): void {
    const symbol: Symbol = {
      name: node.name.value,
      kind: SymbolKind.ApiList,
      location: {
        uri: this.currentUri,
        range: {
          start: { line: node.line - 1, character: node.column - 1 },
          end: {
            line: node.line - 1,
            character: node.column - 1 + node.name.value.length,
          },
        },
      },
      detail: `apilist "${node.name.value}"`,
      documentation: `API list definition for ${node.name.value}`,
    };

    this.symbolTable.addSymbol(symbol);

    // 收集API列表中的API定义，设置父级
    for (const api of node.apis) {
      const apiSymbol: Symbol = {
        name: api.uri.value,
        kind: SymbolKind.Api,
        location: {
          uri: this.currentUri,
          range: {
            start: { line: api.line - 1, character: api.column - 1 },
            end: {
              line: api.line - 1,
              character: api.column - 1 + api.uri.value.length,
            },
          },
        },
        detail: `api "${api.uri.value}"`,
        documentation: `API definition for ${api.uri.value} in ${node.name.value}`,
        parent: node.name.value, // 设置父级为ApiList名称
      };

      this.symbolTable.addSymbol(apiSymbol);

      // 收集API体内的符号
      for (const stmt of api.body) {
        walkAST(stmt, this);
      }
    }
  }

  visitInlineStructDefinition(node: InlineStructDefinition): void {
    // 内联结构体不需要符号，但需要收集其字段
    for (const field of node.fields) {
      walkAST(field, this);
    }
  }

  visitFieldDefinition(node: FieldDefinition): void {
    // 仅在 typedef struct 上下文中创建字段符号进行重复定义检查
    if (this.typedefContext) {
      const fieldSymbol: Symbol = {
        name: node.name.name,
        kind: SymbolKind.Field,
        location: {
          uri: this.currentUri,
          range: {
            start: {
              line: node.line - 1,
              character: node.column - 1,
            },
            end: {
              line: node.line - 1,
              character: node.column - 1 + node.name.name.length,
            },
          },
        },
        detail: `${node.fieldType.name} ${node.name.name}`,
        documentation: `Field ${node.name.name} of type ${node.fieldType.name}`,
        parent: this.typedefContext,
        type: node.fieldType.name,
      };

      this.symbolTable.addSymbol(fieldSymbol);
    }
    // 如果不在 typedef 上下文中，不创建符号，也就不会进行重复定义检查
  }

  visitEnumDefinition(node: EnumDefinition): void {
    // 跳过内联枚举（名称为空），它们已经在 typedef 中处理过了
    if (node.name.name && node.name.name.trim() !== "") {
      const symbol: Symbol = {
        name: node.name.name,
        kind: SymbolKind.Enum,
        location: {
          uri: this.currentUri,
          range: {
            start: { line: node.line - 1, character: node.column - 1 },
            end: {
              line: node.line - 1,
              character: node.column - 1 + node.name.name.length,
            },
          },
        },
        detail: `enum ${node.name.name}`,
        documentation: `Enum definition for ${node.name.name}`,
      };

      this.symbolTable.addSymbol(symbol);
    }

    // 收集枚举值
    for (const value of node.values) {
      walkAST(value, this);
    }
  }

  visitEnumValue(node: EnumValue): void {
    // 仅在 typedef enum 上下文中创建枚举值符号进行重复定义检查
    if (this.typedefContext) {
      const symbol: Symbol = {
        name: node.name.name,
        kind: SymbolKind.EnumValue,
        location: {
          uri: this.currentUri,
          range: {
            start: { line: node.line - 1, character: node.column - 1 },
            end: {
              line: node.line - 1,
              character: node.column - 1 + node.name.name.length,
            },
          },
        },
        detail: `enum value ${node.name.name}`,
        documentation: `Enum value ${node.name.name}`,
        parent: this.typedefContext,
        type: node.value ? node.value.value.toString() : undefined,
      };

      this.symbolTable.addSymbol(symbol);
    }
    // 如果不在 typedef 上下文中，不创建符号，也就不会进行重复定义检查
  }
}

// 内置类型和关键字
export const BUILTIN_TYPES = [
  "int",
  "long",
  "uint",
  "ulong",
  "bool",
  "float",
  "double",
  "string",
];

export const KEYWORDS = [
  "typedef",
  "struct",
  "api",
  "enum",
  "input",
  "output",
  "extract",
  "extends",
  "implements",
  "patch",
  "apilist",
  "#include",
  "#set",
];

export const CONSTANTS = ["GET", "SET"];

// 获取内置符号（用于补全）
export function getBuiltinSymbols(): Symbol[] {
  const symbols: Symbol[] = [];

  // 添加内置类型
  for (const type of BUILTIN_TYPES) {
    symbols.push({
      name: type,
      kind: SymbolKind.Type,
      location: {
        uri: "",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
      },
      detail: `builtin type ${type}`,
      documentation: `Built-in type ${type}`,
    });
  }

  return symbols;
}
