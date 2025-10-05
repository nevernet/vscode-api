# 重复符号创建修复

## 问题描述

用户报告了一个严重的重复定义检查错误：

```
错误提示消息：
Duplicate definition of 'CustomerCategoryParentInfo.name'. First defined at line 3.

结构体定义：
typedef struct {
  id           int
  code         string [[基于ssId， 5位顺序码递增]]
  name         string [[类型名称]]
} CustomerAreaCategoryListData
```

问题是不同结构体中的同名字段被错误地标记为重复定义，这不应该发生。

## 问题根源分析

通过代码分析发现，问题的根源是**重复创建符号**：

### 1. 字段符号被创建了两次

在 `visitTypedefStatement` 方法中：

```typescript
// 第一次创建：通过 walkAST(node.structDef, this)
walkAST(node.structDef, this);  // 这会调用独立的 visitFieldDefinition

// 第二次创建：通过手动遍历字段
for (const field of node.structDef.fields) {
  walkAST(field, {
    visitFieldDefinition: (fieldNode: FieldDefinition) => {
      // 又创建了一次字段符号！
      const fieldSymbol: Symbol = { ... };
      this.symbolTable.addSymbol(fieldSymbol);
    },
  });
}
```

### 2. 枚举值符号也被创建了两次

同样的问题也存在于枚举值的处理中：

```typescript
// 第一次：walkAST(node.enumDef, this) 调用 visitEnumValue
// 第二次：手动遍历 enumValue 又创建一次
```

### 3. 导致符号覆盖和错误的重复检查

由于符号被创建两次，后创建的符号会覆盖先创建的符号，导致重复定义检查逻辑出现混乱。

## 修复方案

### 删除重复的符号创建逻辑

**修复前（有重复创建）：**
```typescript
visitTypedefStatement(node: TypedefStatement): void {
  if (node.structDef) {
    // 创建结构体符号
    this.symbolTable.addSymbol(symbol);
    
    // 第一次：通过 walkAST 创建字段符号
    walkAST(node.structDef, this);
    
    // 第二次：又手动创建字段符号（重复！）
    for (const field of node.structDef.fields) {
      walkAST(field, {
        visitFieldDefinition: (fieldNode: FieldDefinition) => {
          const fieldSymbol: Symbol = { ... };
          this.symbolTable.addSymbol(fieldSymbol);  // 重复创建！
        },
      });
    }
  }
}
```

**修复后（单次创建）：**
```typescript
visitTypedefStatement(node: TypedefStatement): void {
  if (node.structDef) {
    this.typedefContext = node.name.name;
    
    // 创建结构体符号
    this.symbolTable.addSymbol(symbol);
    
    // 只通过 walkAST 创建字段符号，会自动调用 visitFieldDefinition
    walkAST(node.structDef, this);
    
    this.typedefContext = null;
  }
}

// 独立的访问器方法（只会被调用一次）
visitFieldDefinition(node: FieldDefinition): void {
  if (this.typedefContext) {
    const fieldSymbol: Symbol = { ... };
    this.symbolTable.addSymbol(fieldSymbol);
  }
}
```

## 修复效果

### ✅ 修复前的错误行为

```api
typedef struct {
  name string
} CustomerCategoryParentInfo

typedef struct {
  name string
} CustomerAreaCategoryListData
```

**错误提示**：`Duplicate definition of 'CustomerCategoryParentInfo.name'. First defined at line 3.`

### ✅ 修复后的正确行为

```api
typedef struct {
  name string
} CustomerCategoryParentInfo     // ✅ 正常

typedef struct {
  name string  
} CustomerAreaCategoryListData   // ✅ 正常，不报重复错误
```

### ✅ 仍然正确检查同结构体内重复

```api
typedef struct {
  id int
  name string
  name int       // ❌ 正确报错：同一结构体内重复字段
} TestStruct
```

## 技术细节

### 符号唯一性保证

修复后，每个字段符号只被创建一次：
- `CustomerCategoryParentInfo.name` → 创建一次
- `CustomerAreaCategoryListData.name` → 创建一次
- 不会相互覆盖，不会触发错误的重复检查

### 重复检查逻辑保持不变

重复定义检查的核心逻辑没有改变：
```typescript
if (symbol.kind === SymbolKind.Field && existing.kind === SymbolKind.Field) {
  if (existing.parent === symbol.parent) {  // 只检查同一父级内的重复
    // 添加到重复检查
  }
}
```

但现在由于符号不会被重复创建，这个逻辑能够正确工作。

## 测试验证

### 编译测试
```bash
npm run package  # ✅ 编译成功，打包成功
```

### 功能测试

创建了 `tests/cross-struct-field-test.api` 验证：
1. ✅ 跨结构体同名字段不报错
2. ✅ 同结构体内重复字段仍报错
3. ✅ 跨枚举同名值不报错
4. ✅ 同枚举内重复值仍报错

## 重要性

这是一个**关键性修复**，因为：
- 解决了假阳性的重复定义错误
- 确保了重复检查的准确性
- 维护了符号表的数据完整性
- 提升了用户体验（不再有误报）

这个修复确保了重复定义检查功能按预期工作：**仅在同一个 typedef struct/enum 内检查重复，不会跨结构体误报**。