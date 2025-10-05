# 重复定义检查修复

## 问题描述

用户报告重复定义检查存在误报问题：

1. **注释被误报**：`[[card全局参数配置]]` 注释被标记为重复定义
2. **apilist 被误报**：`apilist "cardconfig" {` 本身被标记为重复定义
3. **struct 定义被误报**：`typedef struct {` 被提示重复定义

**用户需求**：重复定义检查应该**仅仅针对 struct 里面的字段和 enum 里面的字段**。

## 问题分析

原始代码的重复定义检查过于宽泛，检查了：
- ✅ 全局结构体重复定义（不应该检查）
- ✅ 全局枚举重复定义（不应该检查）
- ✅ API 重复定义（不应该检查）
- ✅ ApiList 重复定义（不应该检查）
- ✅ 字段重复定义（应该检查）
- ✅ 枚举值重复定义（应该检查）

## 修复方案

### 修改前的逻辑：
```typescript
// 检查结构体重复定义（全局）
if (symbol.kind === SymbolKind.Struct) {
  // 添加到重复检查...
}
// 检查枚举重复定义（全局）
else if (symbol.kind === SymbolKind.Enum) {
  // 添加到重复检查...
}
// 检查API重复定义
else if (symbol.kind === SymbolKind.Api) {
  // 添加到重复检查...
}
// 检查ApiList重复定义（全局）
else if (symbol.kind === SymbolKind.ApiList) {
  // 添加到重复检查...
}
```

### 修改后的逻辑：
```typescript
// 重复定义检查仅针对 struct 字段和 enum 字段
if (this.symbols.has(key)) {
  const existing = this.symbols.get(key)!;
  
  // 只检查同一个结构体内的字段重复定义
  if (symbol.kind === SymbolKind.Field && existing.kind === SymbolKind.Field) {
    if (existing.parent === symbol.parent) {
      // 添加到重复检查...
    }
  }
  // 只检查同一个枚举内的枚举值重复定义
  else if (symbol.kind === SymbolKind.EnumValue && existing.kind === SymbolKind.EnumValue) {
    if (existing.parent === symbol.parent) {
      // 添加到重复检查...
    }
  }
  // 不检查其他类型的重复定义
}
```

## 修复效果

### ✅ 不再误报的情况：
```api
[[card全局参数配置]]           // ✅ 注释不再被检查
apilist "cardconfig" {          // ✅ apilist 不再被检查
  // ...
}

typedef struct {                // ✅ struct 定义不再被检查
  field1 int
} Struct1

typedef struct {                // ✅ 允许多个同名 struct 
  field1 int                    // ✅ 不同 struct 中的同名字段不再被检查
} Struct2
```

### ✅ 仍然正确报错的情况：
```api
typedef struct {
  field1 int
  field1 string                 // ❌ 仍然正确报错：同一 struct 内重复字段
} BadStruct

typedef enum {
  VALUE1
  VALUE1                        // ❌ 仍然正确报错：同一 enum 内重复值
} BadEnum
```

### ✅ 不再误报的跨容器情况：
```api
typedef struct {
  field1 int                    // ✅ 不报错
} Struct1

typedef struct {
  field1 int                    // ✅ 不报错：不同 struct 中允许同名字段
} Struct2

typedef enum {
  VALUE1                        // ✅ 不报错
} Enum1

typedef enum {
  VALUE1                        // ✅ 不报错：不同 enum 中允许同名值
} Enum2
```

## 测试验证

创建了 `tests/duplicate-check-test.api` 包含：
- ✅ 注释和 apilist 不被检查的案例
- ✅ 同名 struct/enum 定义不被检查的案例
- ✅ 跨 struct/enum 的同名字段不被检查的案例
- ❌ 同一 struct 内重复字段仍被检查的案例
- ❌ 同一 enum 内重复值仍被检查的案例

## 兼容性

- ✅ 保持了真正需要的重复定义检查（struct 字段、enum 值）
- ✅ 移除了不必要的全局重复检查
- ✅ 不影响其他语言服务器功能
- ✅ 向后兼容现有代码

## 部署状态

- [x] 代码修复完成
- [x] 编译验证通过  
- [x] 扩展打包成功
- [x] 测试文件创建
- [ ] Git 提交待完成

这个修复精确地解决了用户报告的误报问题，同时保持了真正有意义的重复定义检查功能。