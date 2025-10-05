import {
  Program,
  TypedefStatement,
  StructDefinition,
  FieldDefinition,
  ApiDefinition,
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

    // 检查重复定义
    if (this.symbols.has(key)) {
      const existing = this.symbols.get(key)!;
      // 检查结构体重复定义
      if (symbol.kind === SymbolKind.Struct) {
        if (!this.duplicates.has(key)) {
          this.duplicates.set(key, [existing]);
        }
        this.duplicates.get(key)!.push(symbol);
      }
      // 检查字段重复定义（在同一个结构体或枚举中）
      else if (symbol.kind === SymbolKind.Field || symbol.kind === SymbolKind.EnumValue) {
        if (existing.parent === symbol.parent) {
          if (!this.duplicates.has(key)) {
            this.duplicates.set(key, [existing]);
          }
          this.duplicates.get(key)!.push(symbol);
        }
      }
    }

    this.symbols.set(key, symbol);

    // 如果是字段，也添加到结构体字段映射中
    if (symbol.kind === SymbolKind.Field && symbol.parent) {
      if (!this.structFields.has(symbol.parent)) {
        this.structFields.set(symbol.parent, new Map());
      }
      
      // 检查在同一个结构体中的字段重复
      const structFields = this.structFields.get(symbol.parent)!;
      if (structFields.has(symbol.name)) {
        const duplicateKey = `${symbol.parent}.${symbol.name}`;
        const existing = structFields.get(symbol.name)!;
        if (!this.duplicates.has(duplicateKey)) {
          this.duplicates.set(duplicateKey, [existing]);
        }
        this.duplicates.get(duplicateKey)!.push(symbol);
      }
      
      structFields.set(symbol.name, symbol);
    }
  }

  public getSymbol(name: string, parent?: string): Symbol | undefined {
    const key = parent ? `${parent}.${name}` : name;
    return this.symbols.get(key) || this.symbols.get(name);
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

      // 收集结构体字段
      walkAST(node.structDef, this);

      // 为字段设置父结构体
      for (const field of node.structDef.fields) {
        walkAST(field, {
          visitFieldDefinition: (fieldNode: FieldDefinition) => {
            const fieldSymbol: Symbol = {
              name: fieldNode.name.name,
              kind: SymbolKind.Field,
              location: {
                uri: this.currentUri,
                range: {
                  start: {
                    line: fieldNode.line - 1,
                    character: fieldNode.column - 1,
                  },
                  end: {
                    line: fieldNode.line - 1,
                    character: fieldNode.column - 1 + fieldNode.name.name.length,
                  },
                },
              },
              detail: `${fieldNode.fieldType.name} ${fieldNode.name.name}`,
              documentation: `Field ${fieldNode.name.name} of type ${fieldNode.fieldType.name}`,
              parent: node.name.name,
              type: fieldNode.fieldType.name,
            };

            this.symbolTable.addSymbol(fieldSymbol);
          },
        });
      }
    } else if (node.enumDef) {
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

      // 收集枚举值
      walkAST(node.enumDef, this);

      // 为枚举值设置父枚举
      for (const enumValue of node.enumDef.values) {
        walkAST(enumValue, {
          visitEnumValue: (enumValueNode: EnumValue) => {
            const enumValueSymbol: Symbol = {
              name: enumValueNode.name.name,
              kind: SymbolKind.EnumValue,
              location: {
                uri: this.currentUri,
                range: {
                  start: {
                    line: enumValueNode.line - 1,
                    character: enumValueNode.column - 1,
                  },
                  end: {
                    line: enumValueNode.line - 1,
                    character: enumValueNode.column - 1 + enumValueNode.name.name.length,
                  },
                },
              },
              detail: `${enumValueNode.name.name}${enumValueNode.value ? ` = ${enumValueNode.value.value}` : ''}`,
              documentation: `Enum value ${enumValueNode.name.name}`,
              parent: node.name.name,
            };

            this.symbolTable.addSymbol(enumValueSymbol);
          },
        });
      }
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

  visitEnumDefinition(node: EnumDefinition): void {
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

    // 收集枚举值
    for (const value of node.values) {
      walkAST(value, this);
    }
  }

  visitEnumValue(node: EnumValue): void {
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
      type: node.value ? node.value.value.toString() : undefined,
    };

    this.symbolTable.addSymbol(symbol);
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
