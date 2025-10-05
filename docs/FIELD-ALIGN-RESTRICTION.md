# 字段对齐限制修复

## 问题描述

用户要求字段对齐功能应该仅在 `typedef struct {}` 内生效，而不应该在任何 inline struct 或其他地方进行字段对齐。

**现状问题**：
- `typedef struct {}` 内的字段被对齐 ✅ （正确）
- `input struct {}` 内的字段也被对齐 ❌ （不应该）
- `output struct {}` 内的字段也被对齐 ❌ （不应该）
- 任何其他 inline struct 的字段都被对齐 ❌ （不应该）

**用户需求**：字段对齐应该**仅仅用于 typedef struct {}**。

## 问题分析

原始代码的上下文跟踪逻辑过于简单：

```typescript
// 问题代码：无法区分 typedef struct 和 inline struct
if (line.includes("struct")) {
  currentContext.push("struct");  // 所有 struct 都被标记为相同类型
}

// 导致所有 struct 内的字段都被对齐
if (isInStructOrEnum(currentContext) && formatSettings.alignFields) {
  const formattedField = formatFieldDefinition(line, indent);  // 错误地对齐了所有字段
}
```

## 修复方案

### 1. 细化上下文跟踪

区分不同类型的结构体定义：

```typescript
// 修复后：精确区分不同类型的 struct
if (line.includes("struct")) {
  if (line.startsWith("typedef struct")) {
    currentContext.push("typedef-struct");     // 需要字段对齐
  } else {
    currentContext.push("inline-struct");      // 不需要字段对齐
  }
}
```

**新的上下文类型：**
- `typedef-struct` - typedef struct {} 定义（需要对齐）
- `inline-struct` - input/output struct {} 等（不对齐）
- `typedef-enum` - typedef enum {} 定义
- `inline-enum` - 其他 enum 定义

### 2. 精确的对齐判断

创建专门的函数来判断是否应该对齐：

```typescript
// 新增函数：仅检查是否在 typedef struct 内
function isInTypedefStruct(context: string[]): boolean {
  return (
    context.length > 0 &&
    context[context.length - 1] === "typedef-struct"
  );
}

// 修改字段对齐条件
if (isInTypedefStruct(currentContext) && formatSettings.alignFields) {
  // 仅在 typedef struct 内对齐字段
}
```

### 3. 保持向后兼容

更新 `isInStructOrEnum` 函数以支持新的上下文类型：

```typescript
function isInStructOrEnum(context: string[]): boolean {
  return context.length > 0 && [
    "struct", "enum",                    // 旧类型（兼容性）
    "typedef-struct", "typedef-enum",    // 新类型
    "inline-struct", "inline-enum"       // 新类型
  ].includes(context[context.length - 1]);
}
```

## 修复效果

### ✅ typedef struct（应该对齐）

**修复前和修复后都正确：**
```api
typedef struct {
  id           int      // ✅ 对齐
  name         string   // ✅ 对齐
  email        string   // ✅ 对齐
} User
```

### ✅ inline struct（修复：不再对齐）

**修复前（错误对齐）：**
```api
api "create" {
  input struct {
    id           int      // ❌ 错误：被对齐了
    name         string   // ❌ 错误：被对齐了
    email        string   // ❌ 错误：被对齐了
  }
}
```

**修复后（正确不对齐）：**
```api
api "create" {
  input struct {
    id int             // ✅ 正确：不对齐
    name string        // ✅ 正确：不对齐
    email string       // ✅ 正确：不对齐
  }
}
```

### ✅ 所有 inline struct 场景

以下场景的字段都不再被错误对齐：

```api
// API 输入输出
input struct { ... }        // ✅ 不对齐
output struct { ... }       // ✅ 不对齐

// 嵌套结构
api "test" {
  input struct { ... }      // ✅ 不对齐
  output struct { ... }     // ✅ 不对齐
}

// apilist 中的结构
apilist "users" {
  api "create" {
    input struct { ... }    // ✅ 不对齐
    output struct { ... }   // ✅ 不对齐
  }
}
```

## 测试验证

创建了 `tests/field-align-test.api` 包含：

1. **typedef struct** - 字段应该对齐 ✅
2. **typedef enum** - 值应该对齐 ✅
3. **apilist 中的 input/output struct** - 字段不应该对齐 ✅
4. **独立 API 中的 input/output struct** - 字段不应该对齐 ✅
5. **复杂嵌套场景** - 验证上下文跟踪正确性 ✅

## 兼容性

- ✅ 保持 `typedef struct {}` 的字段对齐功能
- ✅ 保持所有其他格式化功能不变
- ✅ 不影响缩进逻辑
- ✅ 向后兼容现有配置选项
- ✅ 上下文跟踪逻辑保持健壮

## 配置控制

字段对齐仍然可以通过配置控制：

```json
{
  "apiLanguageServer.format.alignFields": true   // 启用（仅 typedef struct）
  "apiLanguageServer.format.alignFields": false  // 完全禁用
}
```

但现在即使启用，也只会在 `typedef struct {}` 内生效。

## 技术细节

**上下文类型映射：**
- `typedef struct {}` → `"typedef-struct"` → 对齐字段
- `input struct {}` → `"inline-struct"` → 不对齐字段
- `output struct {}` → `"inline-struct"` → 不对齐字段
- 其他 `xxx struct {}` → `"inline-struct"` → 不对齐字段

这个修复确保了字段对齐功能的精确控制，只在真正需要的地方（正式的类型定义）进行字段对齐。