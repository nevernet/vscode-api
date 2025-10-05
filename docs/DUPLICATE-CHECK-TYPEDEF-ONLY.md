# 重复定义检查限制修复

## 问题描述

用户要求重复定义检查应该**仅仅用于 typedef struct {} 和 typedef enum {}**，其他任何地方都不要检查。

**现状问题**：
- `typedef struct {}` 内的字段重复被检查 ✅ （正确）
- `typedef enum {}` 内的枚举值重复被检查 ✅ （正确）
- `input struct {}` 内的字段重复也被检查 ❌ （不应该）
- `output struct {}` 内的字段重复也被检查 ❌ （不应该）
- 任何其他 inline struct 的字段重复都被检查 ❌ （不应该）

**用户需求**：重复定义检查应该**仅仅用于 typedef struct {} 和 typedef enum {}**。

## 问题分析

原始的重复定义检查逻辑存在问题：

1. **符号创建过于宽泛**：所有 struct 字段和 enum 值都被创建为符号
2. **缺乏上下文判断**：无法区分是在 typedef 定义中还是在 inline 定义中
3. **检查范围过大**：对所有字段符号都进行重复定义检查

```typescript
// 问题：所有字段都被检查重复定义
if (symbol.kind === SymbolKind.Field && existing.kind === SymbolKind.Field) {
  if (existing.parent === symbol.parent) {
    // 添加到重复检查... - 包括了 inline struct 的字段
  }
}
```

## 修复方案

### 1. 添加上下文跟踪

在 `SymbolCollector` 中添加 `typedefContext` 来跟踪当前是否在 typedef 定义中：

```typescript
export class SymbolCollector implements ASTVisitor<void> {
  private typedefContext: string | null = null; // 跟踪当前是否在 typedef 上下文中
  
  visitTypedefStatement(node: TypedefStatement): void {
    if (node.structDef) {
      this.typedefContext = node.name.name;  // 设置 typedef struct 上下文
      // ... 处理结构体
      this.typedefContext = null;            // 清除上下文
    } else if (node.enumDef) {
      this.typedefContext = node.name.name;  // 设置 typedef enum 上下文
      // ... 处理枚举
      this.typedefContext = null;            // 清除上下文
    }
  }
}
```

### 2. 条件性符号创建

修改字段和枚举值的符号创建逻辑，只有在 typedef 上下文中才创建符号：

```typescript
visitFieldDefinition(node: FieldDefinition): void {
  // 仅在 typedef struct 上下文中创建字段符号进行重复定义检查
  if (this.typedefContext) {
    const fieldSymbol: Symbol = {
      name: node.name.name,
      kind: SymbolKind.Field,
      parent: this.typedefContext,  // 使用 typedef 名称作为父级
      // ...
    };
    this.symbolTable.addSymbol(fieldSymbol);
  }
  // 如果不在 typedef 上下文中，不创建符号，也就不会进行重复定义检查
}

visitEnumValue(node: EnumValue): void {
  // 仅在 typedef enum 上下文中创建枚举值符号进行重复定义检查
  if (this.typedefContext) {
    const symbol: Symbol = {
      name: node.name.name,
      kind: SymbolKind.EnumValue,
      parent: this.typedefContext,  // 使用 typedef 名称作为父级
      // ...
    };
    this.symbolTable.addSymbol(symbol);
  }
  // 如果不在 typedef 上下文中，不创建符号，也就不会进行重复定义检查
}
```

### 3. 保持重复检查逻辑不变

重复定义检查逻辑本身不需要修改，因为现在只有 typedef 上下文中的字段和枚举值才会被创建为符号：

```typescript
// 这个逻辑保持不变，但现在只会检查 typedef 符号
if (symbol.kind === SymbolKind.Field && existing.kind === SymbolKind.Field) {
  if (existing.parent === symbol.parent) {
    // 添加到重复检查... - 现在只包括 typedef struct 的字段
  }
}
```

## 修复效果

### ✅ typedef struct（继续检查重复）

**修复前和修复后都正确：**
```api
typedef struct {
  id int
  name string
  id string      // ❌ 继续报错：重复字段（正确）
} User
```

### ✅ typedef enum（继续检查重复）

**修复前和修复后都正确：**
```api
typedef enum {
  ACTIVE
  INACTIVE
  ACTIVE         // ❌ 继续报错：重复枚举值（正确）
} Status
```

### ✅ inline struct（修复：不再检查重复）

**修复前（错误检查）：**
```api
api "create" {
  input struct {
    id int
    name string
    id string    // ❌ 错误：被报重复错误
  }
}
```

**修复后（正确不检查）：**
```api
api "create" {
  input struct {
    id int
    name string
    id string    // ✅ 正确：不报错
  }
}
```

### ✅ 所有 inline 场景

以下场景的字段重复都不再被检查：

```api
// API 输入输出
input struct {
  id int
  id string        // ✅ 不报错
}

output struct {
  result bool
  result string    // ✅ 不报错
}

// apilist 中的结构
apilist "users" {
  api "create" {
    input struct {
      user_id int
      user_id string    // ✅ 不报错
    }
  }
}

// 嵌套的 inline struct
input struct {
  user struct {
    id int
    id string          // ✅ 不报错
  }
}
```

## 技术实现细节

### 上下文管理

```typescript
// 进入 typedef 上下文
this.typedefContext = node.name.name;

// 处理字段/枚举值时检查上下文
if (this.typedefContext) {
  // 创建符号进行重复检查
}

// 退出 typedef 上下文
this.typedefContext = null;
```

### 符号创建策略

- **typedef struct 字段** → 创建 `SymbolKind.Field` 符号 → 检查重复
- **typedef enum 值** → 创建 `SymbolKind.EnumValue` 符号 → 检查重复
- **inline struct 字段** → 不创建符号 → 不检查重复
- **inline enum 值** → 不创建符号 → 不检查重复

## 测试验证

创建了 `tests/duplicate-typedef-only-test.api` 包含：

1. **typedef struct 重复字段** - 应该报错 ❌
2. **typedef enum 重复值** - 应该报错 ❌
3. **input struct 重复字段** - 不应该报错 ✅
4. **output struct 重复字段** - 不应该报错 ✅
5. **apilist 中 inline struct** - 不应该报错 ✅
6. **嵌套 inline struct** - 不应该报错 ✅

## 兼容性

- ✅ 保持 typedef struct/enum 的重复检查功能
- ✅ 保持所有其他语言服务器功能不变
- ✅ 不影响自动补全和语法高亮
- ✅ 不影响格式化功能
- ✅ 符号表结构保持稳定

## 配置控制

重复定义检查目前没有独立的配置选项，但是：
- 可以通过禁用整个语言服务器来关闭所有检查
- 重复检查现在精确控制在 typedef 定义范围内

这个修复确保了重复定义检查功能的精确控制：**仅仅用于 typedef struct {} 和 typedef enum {}**，任何其他地方都不会进行重复定义检查。