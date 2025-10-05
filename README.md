# API Language Server Extension

这是一个为自定义API DSL语言提供智能编程支持的VS Code扩展。

## 功能特性

### ✅ 已实现的功能

1. **语法高亮** - 基于TextMate语法文件的代码高亮
2. **代码自动补全** - 智能代码补全功能，包括：
   - 关键字补全（typedef, struct, api, enum等）
   - 内置类型补全（int, string, bool等）
   - 用户定义的结构体和枚举补全
   - 常量补全（GET, SET）

3. **结构体重复定义检查** - 实时检测并报告重复定义的结构体，提供详细的错误信息

4. **跳转到定义** - 支持跳转到符号定义位置

5. **查找引用** - 查找符号在代码中的所有引用位置

6. **悬停信息** - 鼠标悬停显示符号的详细信息

## 语言语法

支持以下API DSL语法元素：

### 基础类型
```api
int, long, uint, ulong, bool, float, double, string
```

### 结构体定义
```api
typedef struct {
    int id;
    string name;
    float price;
    bool available;
} Product
```

### API定义
```api
api "product/list" {
    input User
    output Product
    extract id, name, price
}
```

### 枚举定义
```api
enum Status {
    PENDING = 1,
    CONFIRMED = 2,
    SHIPPED = 3
}
```

### 注释
```api
// 单行注释
/* 多行注释 */
[[ 内置注释 ]]
```

## 技术架构

### Language Server Protocol (LSP)
本扩展基于Language Server Protocol实现，包含：

- **Client Extension** - VS Code扩展客户端
- **Language Server** - 独立的语言服务进程

### 核心组件

1. **词法分析器 (Lexer)** - 将源代码转换为token流
2. **语法分析器 (Parser)** - 构建抽象语法树(AST)
3. **符号表 (Symbol Table)** - 管理所有符号信息
4. **诊断器 (Diagnostics)** - 提供错误检查和警告

## 开发和调试

### 环境要求
- Node.js 16+
- VS Code 1.74+

### 构建项目
```bash
npm install
npm run compile
```

### 快速构建和打包
```bash
# 基本构建
npm run build

# 构建并自动递增版本号
npm run build:bump

# 或使用构建脚本
node scripts/build.js --bump
```

### 安装扩展
构建完成后，可以通过以下方式安装：

```bash
# 命令行安装
code --install-extension dist/api-x.x.x.vsix

# 或在VS Code中: Ctrl+Shift+P -> "Extensions: Install from VSIX..."
```

### 调试扩展
1. 在VS Code中打开项目
2. 按F5启动Extension Development Host
3. 在新窗口中打开.api文件进行测试

### 测试解析器
```bash
node dist/test-parser.js
```

详细的构建说明请参考 [BUILD.md](BUILD.md)。

## 示例文件

查看 `example.api` 文件获取语法示例和测试用例。

## 未来规划

- [ ] 支持数组类型语法 (Product[])
- [ ] 添加语义分析
- [ ] 支持#include文件导入
- [ ] 代码格式化功能
- [ ] 更多的代码重构功能

## 贡献

欢迎提交问题和功能请求！