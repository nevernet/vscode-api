# 注释缩进修复

## 问题描述

用户报告的问题：
```api
typedef struct {
// 全局部分的配置   <- 这里的注释应该缩进两个空格，但是现在没有
  user_need_approve EnumBoolean [[用户是否需要审核]]
```

**问题**：注释不会跟随下面的代码一起缩进，导致格式不一致。

## 问题根源

在格式化函数 `formatApiDocument` 中，注释的处理逻辑有问题：

### 修复前的错误代码：
```typescript
// 处理空行和注释
if (!line || line.startsWith("//")) {
  formattedLines.push(line);  // 直接推送原始行，没有缩进！
  continue;
}
```

这个逻辑导致：
1. 注释直接以原始形式推送，没有应用当前的缩进级别
2. 不管注释在哪个上下文中（结构体内、API内等），都不会缩进
3. 多行注释也无法正确对齐

## 修复方案

### 修复后的正确代码：
```typescript
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
```

### 关键改进：
1. **分离空行和注释处理**：空行不需要缩进，注释需要缩进
2. **应用当前缩进级别**：`indentLevel * indentSize`
3. **使用配置的缩进大小**：`indentSize`（默认2个空格）

## 修复效果

### ✅ 修复前
```api
typedef struct {
// 全局部分的配置               <- 没有缩进
  user_need_approve EnumBoolean
// 另一个注释                   <- 没有缩进
  test_field String
} GroupConfigStruct
```

### ✅ 修复后
```api
typedef struct {
  // 全局部分的配置             <- 正确缩进2个空格
  user_need_approve EnumBoolean
  // 另一个注释               <- 正确缩进2个空格
  test_field String
} GroupConfigStruct
```

## 支持的缩进场景

### 1. 结构体内注释
```api
typedef struct {
  // 结构体内注释 <- 缩进2个空格
  field String
} MyStruct
```

### 2. 多行注释
```api
typedef struct {
  // 第一行注释 <- 缩进2个空格
  // 第二行注释 <- 缩进2个空格
  field String
} MyStruct
```

### 3. 嵌套结构注释
```api
apilist "test" {
  // apilist内注释 <- 缩进2个空格
  api "nested" {
    // 嵌套API注释 <- 缩进4个空格
    input MyStruct
  }
}
```

### 4. 顶层注释（不缩进）
```api
// 顶层注释 <- 不缩进
typedef struct {
  // 内部注释 <- 缩进2个空格
  field String
} MyStruct
```

## 技术细节

### 缩进计算逻辑
```typescript
const commentIndent = " ".repeat(indentLevel * indentSize);
```

- `indentLevel`：当前的缩进级别（每进入一个 `{` 增加1）
- `indentSize`：每级缩进的空格数（默认2）
- 最终缩进 = `indentLevel × indentSize` 个空格

### 上下文跟踪
注释缩进正确依赖于：
1. `indentLevel` 的正确维护
2. `{` 和 `}` 的正确识别
3. 当前上下文的准确跟踪

## 兼容性

此修复：
- ✅ **完全向后兼容**：不影响现有功能
- ✅ **保持性能**：没有增加显著的计算开销
- ✅ **配置驱动**：使用现有的 `indentSize` 配置
- ✅ **全功能**：支持所有注释场景

## 测试验证

创建了 `tests/comment-indent-test.api` 测试文件，验证：
1. ✅ 结构体内注释正确缩进
2. ✅ 多行注释对齐
3. ✅ 顶层注释不缩进
4. ✅ 嵌套结构注释缩进层级正确

## 重要性

这个修复解决了：
- **代码可读性**：注释与代码对齐，更清晰
- **格式一致性**：所有注释都遵循相同的缩进规则
- **用户体验**：格式化后代码看起来更专业
- **团队协作**：统一的代码格式标准

现在注释会**完全跟随下面的代码一起缩进**，实现了用户要求的格式化效果！