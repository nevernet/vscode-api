# API Language Server Extension

这是一个为自定义API描述语言开发的VS Code扩展，提供完整的语言服务器功能，包括语法高亮、智能提示、错误检查和代码导航等特性。

## 🚀 快速开始

### 安装方式

#### 方式一：从 .vsix 文件安装
1.## ⚙️ 配置与使用

### VS Code 设置
该扩展开箱即用，无需额外配置。但你可以通过以下设置来自定义体验：

```json
{
  // 启用文档格式化
  "api.format.enable": true,
  
  // 自动补全延迟 (毫秒)
  "api.completion.delay": 100,
  
  // 错误检查级别
  "api.diagnostics.level": "error"
}
```

### 键盘快捷键
| 功能       | Windows/Linux  | macOS         | 描述                 |
| ---------- | -------------- | ------------- | -------------------- |
| 跳转到定义 | `F12`          | `F12`         | 跳转到符号定义位置   |
| 查找引用   | `Shift+F12`    | `Shift+F12`   | 查找符号的所有引用   |
| 预览定义   | `Alt+F12`      | `Opt+F12`     | 在弹窗中预览定义     |
| 符号重命名 | `F2`           | `F2`          | 重命名符号           |
| 文件符号   | `Ctrl+Shift+O` | `Cmd+Shift+O` | 当前文件的符号列表   |
| 工作区符号 | `Ctrl+T`       | `Cmd+T`       | 整个工作区的符号搜索 |
| 自动补全   | `Ctrl+Space`   | `Cmd+Space`   | 触发代码补全         |

### 工作区配置
为了获得最佳体验，建议在项目根目录创建 `.vscode/settings.json`：

```json
{
  "files.associations": {
    "*.api": "api"
  },
  "editor.wordBasedSuggestions": false,
  "editor.suggest.snippetsPreventQuickSuggestions": false
}
```

## 🔧 故障排除

### 常见问题

#### 1. 扩展无法加载
**问题**: VS Code显示扩展安装成功但功能不工作
**解决方案**:
- 重启VS Code
- 检查是否有其他同类扩展冲突
- 查看开发者控制台错误信息 (`Help` > `Toggle Developer Tools`)

#### 2. 语法高亮不显示
**问题**: .api文件没有语法高亮
**解决方案**:
- 确认文件扩展名为 `.api`
- 在VS Code右下角点击语言选择器，选择 "API"
- 检查文件关联设置

#### 3. 自动补全不工作
**问题**: 没有代码提示和自动补全
**解决方案**:
- 按 `Ctrl+Space` (macOS: `Cmd+Space`) 手动触发
- 检查是否启用了 `editor.wordBasedSuggestions`
- 确认语法正确，语言服务器能正常解析文件

#### 4. 符号导航失效
**问题**: Go to Definition 或 Find References 不工作
**解决方案**:
- 确保文件已保存
- 检查结构体定义语法是否正确
- 尝试重新加载窗口 (`Ctrl+Shift+P` > "Developer: Reload Window")

### 调试模式
如果遇到问题，可以启用详细日志：

1. 打开VS Code设置 (`Ctrl+,`)
2. 搜索 "api.trace.server"
3. 设置为 "verbose"
4. 重启VS Code并查看输出面板中的语言服务器日志

## 🏗️ 架构设计

### Language Server Protocol (LSP)
本扩展基于Language Server Protocol实现，包含：

- **Client Extension** - VS Code扩展客户端，处理UI交互
- **Language Server** - 独立的语言服务进程，提供智能功能

### 核心组件

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   VS Code       │────│  LSP Protocol    │────│ Language Server │
│   Extension     │    │  (JSON-RPC)      │    │    Process      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                         │
                                   ┌─────────────────────┴─────────────────────┐
                                   │                                           │
                           ┌───────▼───────┐  ┌──────────▼──────────┐  ┌─────▼─────┐
                           │     Lexer     │  │       Parser        │  │  Symbol   │
                           │  (Tokenizer)  │  │   (AST Builder)     │  │   Table   │
                           └───────────────┘  └─────────────────────┘  └───────────┘
```

#### 详细组件说明

1. **词法分析器 (Lexer)** - 将源代码转换为token流
   - 识别关键字、标识符、类型、注释
   - 处理空白字符和换行符
   - 生成位置信息用于错误报告

2. **语法分析器 (Parser)** - 构建抽象语法树(AST)
   - 解析结构体定义和字段
   - 验证语法正确性
   - 生成语法错误诊断

3. **符号表 (Symbol Table)** - 管理所有符号信息
   - 跟踪结构体定义和字段
   - 检测重复定义
   - 提供符号查找和引用功能

4. **诊断器 (Diagnostics)** - 提供错误检查和警告
   - 语法错误检测
   - 语义错误验证
   - 实时错误高亮显示 文件从 [Releases](https://github.com/nevernet/vscode-api-language/releases)
2. 在 VS Code 中按 `Ctrl+Shift+P` (macOS: `Cmd+Shift+P`)
3. 输入并选择 "Extensions: Install from VSIX..."
4. 选择下载的 `.vsix` 文件

#### 方式二：从源码构建安装
```bash
# 克隆仓库
git clone https://github.com/nevernet/vscode-api-language.git
cd vscode-api-language

# 安装依赖
npm install

# 构建并打包
npm run build:bump

# 安装扩展
code --install-extension dist/api-*.vsix
```

### 创建你的第一个 API 文件

1. 创建一个新文件，保存为 `.api` 扩展名 (例如：`user.api`)
2. 开始编写API结构定义：

```api
// 用户信息结构
struct User {
    id: number          // 用户唯一标识
    name: string        // 用户姓名
    email: string       // 邮箱地址
    age: number         // 年龄
    isActive: boolean   // 是否激活
}

// 产品信息结构
struct Product {
    id: number
    name: string
    price: number
    description: string
    category: string
}
```

3. 享受智能提示和错误检查功能！

## 🎯 功能特性

### 核心语言功能
- **🎨 语法高亮**: 自定义API语言的语法着色
- **💡 智能提示**: 结构体字段和类型的自动补全
- **⚠️ 错误检查**: 实时语法和语义错误诊断
- **🔍 重复定义检查**: 自动检测并标记重复的结构体定义
- **📝 注释支持**: 支持单行 (`//`) 和多行 (`/* */`) 注释

### 代码导航功能
- **🎯 Go to Definition** (`F12`): 跳转到符号定义位置
- **🔎 Find All References** (`Shift+F12`): 查找符号的所有引用
- **👁️ Peek Definition** (`Alt+F12`): 预览定义而不离开当前位置
- **🗂️ Symbol Navigation** (`Ctrl+Shift+O`): 文件内符号导航
- **🌐 Workspace Symbols** (`Ctrl+T`): 工作区范围的符号搜索

### 编辑器增强
- **📋 Outline View**: 在侧边栏显示文档结构
- **🍞 Breadcrumbs**: 顶部面包屑导航
- **🏷️ Symbol Rename** (`F2`): 符号重命名支持
- **📏 Code Folding**: 代码折叠支持

## 📖 语法参考

### 结构体定义

#### 传统语法（类型 字段名）
```api
typedef struct {
    int id;
    string name;
    float price;
    bool available;
} Product
```

#### 新语法（字段名 类型）- 推荐 ✨
```api
typedef struct {
    id number          // 更自然的语法
    name string        // 字段名在前，类型在后
    price number       
    available boolean
} ProductModern
```

#### 混合使用
```api
typedef struct {
    int id             // 传统语法
    name string        // 新语法
    string email       // 传统语法  
    isActive boolean   // 新语法
} MixedSyntax
```

### 枚举定义

#### 空枚举
```api
typedef enum {} EmptyStatus
```

#### 带值枚举
```api
typedef enum {
    PENDING = 1,
    CONFIRMED = 2,
    SHIPPED = 3,
    DELIVERED = 4
} OrderStatus
```

#### 独立枚举定义
```api
enum UserRole {
    ADMIN = 1,
    USER = 2,
    GUEST = 3
}
```

### 支持的数据类型
- `int`, `long`, `uint`, `ulong` - 整数类型
- `float`, `double` - 浮点数类型
- `string` - 字符串类型
- `bool`, `boolean` - 布尔类型
- `number` - 通用数字类型 ✨

### 注释语法
```api
// 单行注释

/*
 * 多行注释
 * 可以跨越多行
 */

typedef struct {
    id number      // 字段注释
    name string    // 支持行尾注释
} User
```

### API 定义
```api
api "user/create" {
    input User
    output User
    extract id, name, email
}
```

### 错误检测

#### 重复字段检测 ⚠️
```api
typedef struct {
    id number
    name string
    id string          // ❌ 错误：重复字段
} InvalidStruct
```

#### 重复结构体检测 ⚠️
```api
typedef struct {
    id number
} User

typedef struct {       // ❌ 错误：重复定义
    name string
} User
```

### 完整示例
```api
/*
 * 电商系统API结构定义
 * 版本: 2.0 - 支持新语法特性
 */

// 用户基本信息 - 使用新语法
typedef struct {
    userId number       // 用户ID
    userName string     // 用户名
    email string        // 邮箱
    phone string        // 电话号码
    isVerified boolean  // 是否已验证
    registeredAt string // 注册时间
} User

// 商品信息 - 混合语法
typedef struct {
    number id           // 传统语法
    name string         // 新语法
    description string
    price number        // 新语法
    boolean inStock     // 传统语法
    categoryId number
} Product

// 订单状态枚举
typedef enum {
    PENDING = 1,
    CONFIRMED = 2,
    SHIPPED = 3,
    DELIVERED = 4,
    CANCELLED = 5
} OrderStatus

// 订单信息
typedef struct {
    orderId number      // 订单ID
    userId number       // 关联用户ID
    productId number    // 关联商品ID
    quantity number     // 数量
    totalPrice number   // 总价
    status string       // 订单状态
    createdAt string    // 创建时间
} Order

// API 定义
api "user/profile" {
    input User
    output User
    extract userId, userName, email
}

api "order/create" {
    input Order
    output Order
}
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

## 🛠️ 开发与构建

### 开发环境要求
- **Node.js**: >= 16.0.0 (推荐使用 LTS 版本)
- **npm**: >= 8.0.0
- **VS Code**: >= 1.74.0
- **Git**: 用于版本控制

### 快速开始开发

#### 1. 克隆并设置项目
```bash
# 克隆仓库
git clone https://github.com/nevernet/vscode-api-language.git
cd vscode-api-language

# 安装依赖
npm install

# 验证安装
npm run compile
```

#### 2. 开发模式
```bash
# 启动监视模式（自动重新编译）
npm run watch

# 在另一个终端启动调试
# 在VS Code中按 F5 或 Ctrl+Shift+D 然后选择 "Run Extension"
```

#### 3. 测试你的修改
1. 修改源代码 (在 `src/` 目录下)
2. 保存文件 (监视模式会自动重新编译)
3. 在Extension Development Host中测试
4. 重复此过程直到功能完善

### 构建命令详解

#### 基本构建命令
```bash
# 编译TypeScript代码到JavaScript
npm run compile

# 监视模式 - 文件变化时自动重新编译
npm run watch

# 清理所有构建产物
npm run clean

# 运行ESLint代码检查
npm run lint

# 自动修复ESLint问题
npm run lint:fix
```

#### 打包发布命令
```bash
# 完整构建 - 清理、编译、打包
npm run build

# 构建并自动递增版本号 (推荐)
npm run build:bump

# 手动指定版本类型
npm version patch    # 0.0.1 -> 0.0.2
npm version minor    # 0.0.1 -> 0.1.0
npm version major    # 0.0.1 -> 1.0.0
npm run build
```

#### 测试命令
```bash
# 进入测试目录
cd tests

# 运行快速功能验证测试
node final-test.mjs

# 运行格式化功能测试
node format-test.mjs

# 运行基础解析器测试
node debug-test.mjs

# 运行内联结构体测试
node inline-test.mjs

# 运行新功能测试
node test-new-features.mjs

# 注意：comprehensive-test.mjs 可能会导致内存溢出，建议使用 final-test.mjs 进行快速验证
```

### 项目结构详解
```
vscode-api-language/
├── 📁 src/                          # 源代码目录
│   ├── 📁 client/                   # VS Code扩展客户端
│   │   └── 📄 extension.ts          # 扩展主入口文件
│   └── 📁 server/                   # 语言服务器
│       ├── 📄 lexer.ts              # 词法分析器
│       ├── 📄 parser.ts             # 语法分析器  
│       ├── 📄 ast.ts                # 抽象语法树定义
│       ├── 📄 symbols.ts            # 符号表管理
│       └── 📄 server.ts             # LSP服务器实现
├── 📁 scripts/                      # 构建和工具脚本
│   ├── 📄 build.js                  # 主构建脚本
│   └── 📄 bump-version.js           # 自动版本递增
├── 📁 syntaxes/                     # TextMate语法文件
│   └── 📄 api.tmLanguage            # API语言语法定义
├── 📁 tests/                        # 测试文件目录
│   ├── 📄 *.api                     # API语法测试文件
│   ├── 📄 *.mjs                     # 测试脚本
│   └── 📄 README.md                 # 测试说明文档
├── 📁 dist/                         # 构建输出目录
│   ├── 📄 client/                   # 编译后的客户端代码
│   ├── 📄 server/                   # 编译后的服务器代码
│   └── 📦 api-x.x.x.vsix           # 打包后的扩展文件
├── 📄 package.json                  # 项目配置和依赖
├── 📄 tsconfig.json                 # TypeScript配置
├── 📄 .eslintrc.js                  # ESLint配置
├── 📄 .gitignore                    # Git忽略文件
├── 📄 .vscodeignore                 # 扩展打包忽略文件
├── 📄 language-configuration.json   # 语言配置
├── 📄 BUILD.md                      # 详细构建说明
└── 📄 README.md                     # 项目说明文档
```

### 调试与开发技巧

#### 启动调试会话
1. **打开项目**: 在VS Code中打开项目根目录
2. **安装依赖**: 运行 `npm install`
3. **启动监视**: 运行 `npm run watch`
4. **开始调试**: 按 `F5` 或使用调试面板
5. **测试扩展**: 在新的Extension Development Host窗口中创建 `.api` 文件

#### 调试技巧
- **断点调试**: 在TypeScript源码中设置断点
- **日志输出**: 使用 `console.log()` 或 `connection.console.log()`
- **LSP日志**: 在VS Code输出面板查看语言服务器日志
- **重新加载**: 使用 `Ctrl+Shift+P` > "Developer: Reload Window"

#### 常用开发工具
```bash
# 实时查看语言服务器日志
tail -f ~/.vscode/logs/*/exthost1/output_logging_*/3-api-language-server.log

# 快速重建和测试
npm run clean && npm run compile && code --install-extension dist/api-*.vsix

# 检查依赖版本
npm list
npm outdated
```

### 代码贡献指南

#### 提交代码前检查清单
- [ ] 代码通过ESLint检查 (`npm run lint`)
- [ ] 所有功能正常工作 (在Extension Development Host中测试)
- [ ] 新功能有对应的测试用例
- [ ] 更新了相关文档
- [ ] 提交信息清晰明确

#### 分支管理
```bash
# 创建功能分支
git checkout -b feature/新功能名称

# 提交代码
git add .
git commit -m "feat: 添加新功能描述"

# 推送分支
git push origin feature/新功能名称
```

#### 发布新版本
```bash
# 自动构建并发布
npm run build:bump

# 手动发布流程
npm version patch
npm run build
git add .
git commit -m "chore: bump version to $(node -p require('./package.json').version)"
git tag v$(node -p require('./package.json').version)
git push origin main --tags
```

## 📚 示例与最佳实践

### 完整项目示例
查看 `tests/example.api` 文件获取更多语法示例和最佳实践。

#### 电商系统API示例
```api
/*
 * 电商系统API结构定义
 * 版本: 2.0
 * 作者: API团队
 */

// ============ 用户相关 ============

// 用户基本信息
struct User {
    id: number              // 用户唯一标识
    username: string        // 登录用户名，3-20字符
    email: string           // 邮箱地址，用于登录和通知
    phone: string           // 手机号码，用于验证和找回密码
    firstName: string       // 名
    lastName: string        // 姓
    isEmailVerified: boolean // 邮箱是否已验证
    isPhoneVerified: boolean // 手机是否已验证
    registeredAt: string    // 注册时间，ISO 8601格式
    lastLoginAt: string     // 最后登录时间
}

// 用户地址信息
struct Address {
    id: number
    userId: number          // 关联的用户ID
    label: string           // 地址标签：home, work, other
    street: string          // 街道地址
    city: string            // 城市
    state: string           // 省/州
    zipCode: string         // 邮政编码
    country: string         // 国家代码
    isDefault: boolean      // 是否为默认地址
}

// ============ 商品相关 ============

// 商品分类
struct Category {
    id: number
    name: string            // 分类名称
    parentId: number        // 父分类ID，0表示顶级分类
    description: string     // 分类描述
    isActive: boolean       // 是否启用
    sortOrder: number       // 排序权重
}

// 商品信息
struct Product {
    id: number
    sku: string             // 商品SKU编码
    name: string            // 商品名称
    description: string     // 商品详细描述
    price: number           // 当前售价
    originalPrice: number   // 原价
    categoryId: number      // 所属分类ID
    brandId: number         // 品牌ID
    inventory: number       // 库存数量
    weight: number          // 重量（克）
    isActive: boolean       // 是否上架
    isDigital: boolean      // 是否数字商品
    createdAt: string       // 创建时间
    updatedAt: string       // 更新时间
}

// 商品变体（如不同尺寸、颜色）
struct ProductVariant {
    id: number
    productId: number       // 主商品ID
    sku: string             // 变体SKU
    name: string            // 变体名称
    price: number           // 变体价格
    inventory: number       // 变体库存
    attributes: string      // JSON格式的属性信息
}

// ============ 订单相关 ============

// 购物车项目
struct CartItem {
    id: number
    userId: number          // 用户ID
    productId: number       // 商品ID
    variantId: number       // 商品变体ID（可选）
    quantity: number        // 数量
    addedAt: string         // 加入购物车时间
}

// 订单主信息
struct Order {
    id: number
    orderNumber: string     // 订单号
    userId: number          // 用户ID
    status: string          // 订单状态：pending, paid, shipped, delivered, cancelled
    totalAmount: number     // 订单总金额
    shippingAmount: number  // 运费
    taxAmount: number       // 税费
    discountAmount: number  // 折扣金额
    paymentMethod: string   // 支付方式
    shippingAddressId: number // 收货地址ID
    billingAddressId: number  // 账单地址ID
    notes: string           // 订单备注
    createdAt: string       // 下单时间
    shippedAt: string       // 发货时间
    deliveredAt: string     // 签收时间
}

// 订单项目
struct OrderItem {
    id: number
    orderId: number         // 订单ID
    productId: number       // 商品ID
    variantId: number       // 商品变体ID
    quantity: number        // 购买数量
    unitPrice: number       // 单价
    totalPrice: number      // 小计
    productSnapshot: string // 商品快照（JSON格式）
}

// ============ 支付相关 ============

// 支付记录
struct Payment {
    id: number
    orderId: number         // 关联订单ID
    paymentMethod: string   // 支付方式：credit_card, paypal, bank_transfer
    amount: number          // 支付金额
    currency: string        // 货币代码：USD, EUR, CNY
    status: string          // 支付状态：pending, completed, failed, refunded
    transactionId: string   // 第三方交易ID
    processedAt: string     // 处理时间
    failureReason: string   // 失败原因
}

// ============ 评价系统 ============

// 商品评价
struct Review {
    id: number
    productId: number       // 商品ID
    userId: number          // 评价用户ID
    orderId: number         // 关联订单ID
    rating: number          // 评分，1-5星
    title: string           // 评价标题
    content: string         // 评价内容
    isVerifiedPurchase: boolean // 是否验证购买
    helpfulCount: number    // 有用数
    createdAt: string       // 评价时间
}

// ============ 通知系统 ============

// 通知消息
struct Notification {
    id: number
    userId: number          // 接收用户ID
    type: string            // 通知类型：order, shipping, promotion, system
    title: string           // 通知标题
    message: string         // 通知内容
    isRead: boolean         // 是否已读
    actionUrl: string       // 点击跳转URL
    createdAt: string       // 创建时间
    readAt: string          // 阅读时间
}
```

### 开发最佳实践

#### 1. 命名规范
```api
// ✅ 好的命名 - 清晰、描述性强
struct UserProfile {
    id: number
    firstName: string
    lastName: string
    emailAddress: string
}

// ❌ 避免的命名 - 模糊、缩写
struct UP {
    i: number
    fn: string
    ln: string
    ea: string
}
```

#### 2. 注释规范
```api
// ✅ 提供有价值的信息
struct Product {
    id: number              // 商品唯一标识符
    price: number           // 价格，单位：分（避免浮点数精度问题）
    status: string          // 状态：active, inactive, discontinued
}

// ❌ 重复显而易见的信息
struct Product {
    id: number              // ID
    price: number           // 价格
    status: string          // 状态
}
```

#### 3. 结构组织
```api
// ✅ 按业务领域分组
// ============ 用户管理 ============
struct User { /* ... */ }
struct UserProfile { /* ... */ }
struct UserPreferences { /* ... */ }

// ============ 商品管理 ============  
struct Product { /* ... */ }
struct Category { /* ... */ }
struct Inventory { /* ... */ }

// ============ 订单管理 ============
struct Order { /* ... */ }
struct OrderItem { /* ... */ }
struct Payment { /* ... */ }
```

#### 4. 字段设计原则
```api
// ✅ 包含必要的元数据
struct BaseEntity {
    id: number              // 主键
    createdAt: string       // 创建时间，ISO 8601格式
    updatedAt: string       // 最后更新时间
    version: number         // 版本号，用于乐观锁
}

// ✅ 使用明确的布尔字段
struct User {
    isActive: boolean       // 账户是否激活
    isEmailVerified: boolean // 邮箱是否已验证
    hasSubscription: boolean // 是否有订阅
}

// ✅ 外键关系清晰
struct OrderItem {
    orderId: number         // 关联订单表的ID
    productId: number       // 关联商品表的ID
    userId: number          // 关联用户表的ID
}
```

## 🚀 性能优化

### 大文件处理
当处理包含大量结构体定义的文件时：

1. **分模块设计**: 将相关结构体分组到不同文件
2. **合理注释**: 避免过长的注释影响解析性能
3. **定期清理**: 移除未使用的结构体定义

### 编辑器优化设置
```json
{
  "api.maxFileSize": 1000000,
  "api.parseTimeout": 5000,
  "api.incrementalParsing": true,
  "api.cacheSymbols": true
}
```

## 🔄 版本升级指南

### 从 0.0.x 升级到最新版本

1. **备份项目**: 确保代码已提交到版本控制
2. **卸载旧版本**: `code --uninstall-extension api-language`
3. **安装新版本**: 按照安装说明重新安装
4. **验证功能**: 测试所有核心功能是否正常

### 配置迁移
大多数配置向后兼容，但建议检查：
- 文件关联设置
- 自定义快捷键配置
- 工作区特定设置

## 📖 更多资源

### 相关文档
- [BUILD.md](BUILD.md) - 详细构建说明
- [Language Server Protocol 规范](https://microsoft.github.io/language-server-protocol/)
- [VS Code 扩展开发指南](https://code.visualstudio.com/api)
- [TextMate 语法参考](https://macromates.com/manual/en/language_grammars)

### 社区资源
- [GitHub Issues](https://github.com/nevernet/vscode-api-language/issues) - 问题反馈和功能请求
- [GitHub Discussions](https://github.com/nevernet/vscode-api-language/discussions) - 社区讨论
- [Wiki](https://github.com/nevernet/vscode-api-language/wiki) - 社区维护的文档

## 📝 更新日志

### v0.0.17 (最新) 🚀
- 🐛 **改进错误处理** - 单个文件索引错误不再影响整体进度
- 📊 **优化进度显示** - 显示成功和失败的文件数量统计
- 🔧 **增强容错能力** - 索引过程更加稳定可靠
- 💪 **提升用户体验** - 索引错误不会中断整个工作流程

### v0.0.16
- 🐛 **修复严重内存泄漏** - 解决多个Helper进程导致系统崩溃的问题
- ⏱️ **优化定时器管理** - 正确清理定时器避免资源泄漏
- 🔧 **改进进程清理** - 确保资源正确释放和进程退出
- 🚀 **提升系统稳定性** - 防止VS Code/Cursor启动和退出时卡死

### v0.0.15
- 🚀 **重大性能优化** - 解决索引时界面卡顿和文件无法保存问题
- ⚡ **异步文件操作** - 使用非阻塞的文件读取和处理
- 💾 **智能保存管理** - 防止索引过程中阻塞文件保存功能
- 🔄 **优化调度策略** - 改善UI响应性和用户体验

### v0.0.14
- 📁 **智能工作区扫描** - 自动发现和索引项目中所有.api文件
- 🔍 **递归目录遍历** - 支持子目录中的API文件索引
- 💾 **项目缓存系统** - 缓存存储在.api目录中便于版本控制
- ⚡ **增量索引更新** - 只重新索引修改过的文件

### v0.0.13
- 🎛️ **状态栏集成** - 实时显示索引状态和进度
- 🎮 **命令面板支持** - 添加手动索引和清理缓存命令
- 🔄 **可取消操作** - 支持中断长时间运行的索引任务
- 📊 **详细进度信息** - 显示当前处理的文件和总体进度

### v0.0.12
- 🧠 **智能补全索引** - 全局符号表和快速查找系统
- 💾 **持久化缓存** - 符号信息自动保存到本地缓存
- ⚡ **性能大幅提升** - 补全响应速度显著改善
- 🔍 **跨文件引用** - 支持在不同文件间的符号补全

### v0.0.11
- ⚡ **紧急性能修复** - 解决格式化和自动补全时系统卡死问题
- 🚀 **异步处理优化** - 防止UI线程阻塞
- 🔧 **错误处理改进** - 更好的异常处理和恢复机制
- 💪 **稳定性增强** - 显著提高扩展的可靠性

### v0.0.10
- 🎨 **文档格式化** - 智能代码格式化功能
- 📐 **字段对齐优化** - 自动对齐结构体字段提高可读性
- 🔄 **格式化配置** - 可配置的格式化选项
- ✨ **代码美化** - 一键整理API文档格式

### v0.0.9
- 🔍 **符号重命名** - 支持智能重命名结构体和字段
- 🔗 **引用更新** - 重命名时自动更新所有引用
- 💡 **重命名预览** - 重命名前预览所有将要修改的位置
- 🛡️ **安全检查** - 防止重命名导致的命名冲突

### v0.0.8
- 💡 **代码悬停提示** - 鼠标悬停显示符号详细信息
- 📖 **类型信息展示** - 显示字段类型和结构体定义
- 🎯 **精准定位** - 快速了解符号的定义和用途
- 🔍 **上下文帮助** - 提供丰富的代码上下文信息

### v0.0.7
- 🔎 **符号查找增强** - 改进的全局符号搜索功能
- 📍 **精确定位** - 更准确的符号位置定位
- 🚀 **性能优化** - 更快的符号解析和查找速度
- 🔧 **Bug修复** - 修复符号导航相关问题

### v0.0.6
- 🎯 **Peek Definition** - 快速预览符号定义而无需跳转
- 👁️ **内联查看** - 在当前位置直接查看定义内容
- ⚡ **快速导航** - 提升代码阅读和导航效率
- 🔄 **无缝体验** - 保持工作流程连续性

### v0.0.5
- ✨ **新增 typedef enum {} 语法支持** - 支持空枚举和带值枚举定义
- ✨ **新增灵活字段语法** - 支持 "id int" 和 "name string" 格式，同时保持向后兼容
- ✨ **增强重复检查** - 检测结构体和枚举中的重复字段/值定义
- ✨ **新增 number 和 boolean 类型** - 更现代化的类型支持
- 🔧 **改进解析器** - 支持两种字段定义语法的智能解析
- 📚 **更新文档和示例** - 完整展示所有新语法特性
- 🧪 **新增测试用例** - 验证所有新功能的正确性

### v0.0.4
- ✨ 新增完整的符号导航功能
- 🐛 修复重复定义检查的误报问题  
- 🔧 优化构建系统和版本管理
- 📚 完善文档和示例

### v0.0.3
- ✨ 添加 Go to Definition 功能
- ✨ 实现 Find All References
- 🔧 改进错误诊断准确性

### v0.0.2  
- ✨ 新增智能代码补全
- ✨ 添加重复定义检查
- 🐛 修复语法高亮问题

### v0.0.1
- 🎉 初始版本发布
- ✨ 基础语法高亮支持
- ✨ 基本的词法和语法分析

## 🤝 贡献

我们欢迎并感谢任何形式的贡献！

### 如何贡献

1. **报告问题**: 在 [GitHub Issues](https://github.com/nevernet/vscode-api-language/issues) 中报告bug或请求功能
2. **提交代码**: Fork项目，创建功能分支，提交Pull Request
3. **改进文档**: 帮助完善文档和示例
4. **测试反馈**: 测试新功能并提供反馈

### 贡献准则
- 遵循现有的代码风格和约定
- 为新功能添加相应的测试
- 更新相关文档
- 提交信息要清晰明确

### 开发团队
- **主要维护者**: [@nevernet](https://github.com/nevernet)
- **贡献者**: 查看 [Contributors](https://github.com/nevernet/vscode-api-language/graphs/contributors)

感谢所有为这个项目做出贡献的开发者！

---

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源许可证。

---

**享受使用 API Language Server Extension! 🎉**

如果这个扩展对你有帮助，请考虑给我们一个 ⭐ Star，这对我们来说意义重大！

有任何问题或建议，欢迎通过 [GitHub Issues](https://github.com/nevernet/vscode-api-language/issues) 联系我们。