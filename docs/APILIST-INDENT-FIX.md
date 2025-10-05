# ApiList 内 API 定义缩进修复

## 问题描述

用户报告在 apilist 内部的 api 定义没有正确缩进：

```api
[[企业的社会化信息]]
apilist "cardsocialinfo" {
  [[]]
api "addoredit" {      <-- 应该缩进两格，但现在顶格显示
```

## 问题分析

原始的格式化逻辑中，所有以 `api ` 开头的行都被认为是顶层声明，因此不会被缩进：

```typescript
// 问题代码
const isTopLevelDeclaration = 
  line.startsWith("api ") ||     // 这里导致所有 api 都不缩进
  line.startsWith("apilist ") ||
  // ...
```

但是在实际使用中，api 定义的缩进应该根据上下文决定：
- **顶层的 api 定义**：不应该缩进
- **apilist 内部的 api 定义**：应该缩进

## 修复方案

### 1. 分离 API 和 ApiList 的判断逻辑

```typescript
// 修复后的代码
const isTopLevelDeclaration =
  line.startsWith("typedef") ||
  line.startsWith("struct ") ||
  line.startsWith("enum ");

// api 和 apilist 的特殊处理
const isApiDeclaration = line.startsWith("api ");
const isApiListDeclaration = line.startsWith("apilist ");
const isInApiList = currentContext.length > 0 && 
                   currentContext[currentContext.length - 1] === "apilist";
```

### 2. 基于上下文的缩进决策

```typescript
// 判断是否应该缩进：
const shouldIndent = (!isTopLevelDeclaration && !isApiListDeclaration && !isStructEndWithName) ||
                    (isApiDeclaration && isInApiList);
```

**缩进规则：**
- ✅ 普通行：根据嵌套层级缩进
- ✅ 顶层声明（typedef, struct, enum）：不缩进
- ✅ apilist 声明：不缩进（顶层）
- ✅ **api 声明在 apilist 内**：缩进 ⭐ **修复重点**
- ✅ api 声明在顶层：不缩进

## 修复效果

### ✅ 修复前（错误）：
```api
apilist "cardsocialinfo" {
  [[]]
api "addoredit" {           // ❌ 错误：顶格显示
  input struct {
    field1 int
  }
}
api "delete" {              // ❌ 错误：顶格显示
  input struct {
    id int
  }
}
}
```

### ✅ 修复后（正确）：
```api
apilist "cardsocialinfo" {
  [[]]
  api "addoredit" {         // ✅ 正确：缩进两格
    input struct {
      field1 int
    }
  }
  api "delete" {            // ✅ 正确：缩进两格
    input struct {
      id int
    }
  }
}
```

### ✅ 顶层 API 保持不变（正确）：
```api
api "standalone" {          // ✅ 正确：顶层不缩进
  input struct {
    data string
  }
}
```

## 测试验证

创建了 `tests/apilist-indent-test.api` 包含：
- ✅ apilist 内部的多个 api 定义（应该缩进）
- ✅ 顶层的 api 定义（应该不缩进）
- ✅ 嵌套的 struct 定义（验证层级缩进）
- ✅ 注释和空行处理

## 兼容性

- ✅ 保持顶层 api 定义的不缩进行为
- ✅ 保持 apilist 定义本身的不缩进行为
- ✅ 保持 struct/enum 等其他定义的缩进行为
- ✅ 不影响字段对齐功能
- ✅ 上下文追踪逻辑保持完整

## 版本信息

- 修复版本：0.0.6
- 打包文件：`api-0.0.6.vsix`
- 编译状态：✅ 成功
- 测试状态：✅ 已验证

这个修复精确解决了 apilist 内部 api 定义的缩进问题，同时保持了所有其他格式化行为的正确性。