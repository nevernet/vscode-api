# 格式化缩进问题修复

## 问题描述

用户报告了格式化功能中的缩进问题：

```api
typedef struct {
  id           int
  } CustomerCategoryParentInfo <-- 这里不应该缩进

  typedef struct {  <-- 这里又被缩进了
```

## 问题分析

原始的格式化逻辑存在以下问题：

1. **结构体结束行错误缩进**: `} StructName` 这种行被当作普通行处理，导致缩进
2. **顶层声明被缩进**: `typedef`、`struct`、`api` 等顶层声明不应该被缩进
3. **缩进状态不正确重置**: 导致后续的 `typedef` 语句也被错误缩进

## 修复方案

### 1. 识别结构体结束模式
```typescript
// 特殊处理：检查是否是结构体定义的结束行（如 "} StructName"）
const isStructEndWithName = line.match(/^\}\s+[a-zA-Z_][a-zA-Z0-9_]*$/);
```

### 2. 正确处理缩进减少
```typescript
// 减少缩进的情况
if (line === "}" || isStructEndWithName) {
  indentLevel = Math.max(0, indentLevel - 1);
  currentContext.pop();
}
```

### 3. 顶层声明不缩进
```typescript
// 计算缩进 - 但顶层声明（typedef, struct, api 等）不应该缩进
let indent = "";
const isTopLevelDeclaration = line.startsWith("typedef") || 
                             line.startsWith("struct ") || 
                             line.startsWith("api ") || 
                             line.startsWith("apilist ") ||
                             line.startsWith("enum ");

if (!isTopLevelDeclaration && !isStructEndWithName) {
  indent = " ".repeat(indentLevel * indentSize);
}
```

## 修复效果

### 修复前：
```api
typedef struct {
  id           int
  } CustomerCategoryParentInfo  // ❌ 错误缩进

  typedef struct {              // ❌ 错误缩进
    user_id      int
```

### 修复后：
```api
typedef struct {
  id           int
} CustomerCategoryParentInfo    // ✅ 正确不缩进

typedef struct {                // ✅ 正确不缩进
  user_id      int
```

## 测试验证

1. **基本测试**: 更新了 `tests/format-test.api` 包含问题案例
2. **验证脚本**: 创建了 `tests/format-validation.mjs` 用于概念验证
3. **编译测试**: 确保代码编译无错误
4. **打包测试**: 成功打包为 `api-0.0.5.vsix`

## 兼容性

- ✅ 保持现有字段对齐功能
- ✅ 保持现有上下文追踪功能  
- ✅ 保持现有性能保护措施
- ✅ 不影响其他格式化规则

## 部署状态

- [x] 代码修复完成
- [x] 编译验证通过
- [x] 扩展打包成功
- [x] 测试文件更新
- [ ] Git 提交待完成

这个修复解决了用户报告的具体缩进问题，确保结构体定义的格式化符合预期。