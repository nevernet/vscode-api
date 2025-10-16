# 项目级别的自定义指令

## 项目概述
这是一个为自定义API描述语言开发的VS Code扩展项目，提供完整的语言服务器功能，包括语法高亮、智能提示、错误检查和代码导航等特性。

## 技术栈
- TypeScript (语言服务器和客户端)
- VS Code Language Server Protocol (LSP)
- TextMate 语法文件 (语法高亮)
- ESLint (代码质量检查)

## 项目结构
```
├── src/
│   ├── client/          # VS Code扩展客户端
│   └── server/          # 语言服务器
├── syntaxes/           # TextMate语法文件
├── tests/             # 测试用例
├── scripts/           # 构建脚本
└── API/               # 示例和语法参考
```

## 编码规范

### 代码风格
- 使用 TypeScript 严格模式
- 使用 ESLint 进行代码质量检查
- 遵循 Airbnb JavaScript Style Guide
- 禁用 `any` 类型，使用具体的类型定义

### 文件组织
- 将相关功能组织在独立的模块中
- 保持文件大小合理 (建议不超过500行)
- 使用 barrel exports (index.ts) 简化导入

### 命名约定
- 使用 PascalCase 为类和接口命名
- 使用 camelCase 为函数和变量命名
- 使用 UPPER_CASE 为常量命名
- 使用 kebab-case 为文件和目录命名

### 错误处理
- 使用 try-catch 处理同步错误
- 对异步操作使用 Promise.catch 或 async/await with try-catch
- 不要使用 try-catch 包装整个函数体
- 在错误信息中使用中文描述，便于理解

## 开发工作流

### 构建和测试
- 使用 `npm run build` 进行完整构建
- 使用 `npm run compile` 只编译代码
- 使用 `npm run watch` 监听文件变化自动编译
- 使用 `npm run lint` 检查代码质量

### 提交规范
- 严格遵循 Angular Conventional Commits 规范，格式：<type>[optional scope]: <description>
- git 生成的提交信息必须使用中文

#### 提交类型 (type)
- `feat`: 添加新功能
- `fix`: 修复bug
- `docs`: 仅文档更改
- `style`: 不影响代码含义的更改（空格、格式化等）
- `refactor`: 既不修复bug也不添加功能的代码更改
- `perf`: 提升性能的代码更改
- `test`: 添加缺失的测试或更正现有测试
- `build`: 影响构建系统或外部依赖的更改
- `ci`: 对CI配置文件和脚本的更改
- `chore`: 其他不修改src或test文件的更改
- `revert`: 撤销之前的提交

#### 提交范围 (scope) - 可选
通常用于标识影响的具体模块/组件，例如：
- `feat(lexer)`: 词法分析器相关的新功能
- `fix(parser)`: 语法分析器相关的bug修复
- `docs(readme)`: README文档更新

#### 提交描述 (description)
- 使用祈使句语气，如"add"、"fix"、"remove"、"update"
- 首字母小写，不使用句号结尾
- 简洁明了，50个字符以内最佳

#### 示例提交信息
```
feat: 添加Go to Symbol功能支持
fix(lexer): 修复关键字识别不准确的问题
docs: 更新README安装说明
refactor(server): 重构符号表管理逻辑
perf: 优化大文件解析性能
test: 添加枚举解析测试用例
chore(deps): 升级TypeScript编译器版本
```

#### 破坏性变更 (Breaking Changes)
对于包含破坏性变更的提交，在提交信息中添加`!`标记：
```
feat!: 重构API语法支持向后不兼容
fix(parser)!: 修复字段名解析导致现有代码失效
```

并在提交描述或body中详细说明变更内容。

### LSP 开发规范
- 使用异步方法处理 LSP 请求
- 合理处理大文档，避免性能问题
- 提供详细的错误诊断信息
- 实现适当的取消机制

## 特殊考虑

### 性能优化
- 避免阻塞主线程的操作
- 对于大文件，实现增量处理
- 合理使用缓存机制
- 定期检查内存使用情况

### 兼容性
- 确保兼容 VS Code 1.74.0 及以上版本
- 测试不同操作系统上的兼容性
- 为不同文化使用中文错误信息和 documentation

### 安全性
- 不要执行外部命令，除非必要
- 验证用户输入的数据
- 不要泄露敏感信息

## 工具配置

### ESLint 配置
继承自项目根目录的 `.eslintrc.js`
使用 TypeScript 专用规则
允许适当的规则自定义以适应项目需求

### TypeScript 配置
配置在 `tsconfig.json` 中
针对客户端和服务器使用不同的配置
启用严格的类型检查

### VS Code 设置
建议的工作区设置：
- 启用代码格式化
- 配置文件关联 (`.api` 文件)
- 启用相关语言服务器功能

## 文档要求

### 内联注释
- 使用 JSDoc 格式注释函数
- 对于复杂逻辑添加解释性注释
- 保持注释简洁明了

### 外部文档
- 使用中文编写用户文档
- 更新 README.md 反映功能变更
- 提供详细的使用说明和示例

这个项目是一个专门的语言扩展，开发规则应侧重于 LSP 实现、TypeScript 最佳实践和高性能代码编写。
