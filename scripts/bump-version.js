#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

// 读取package.json (从脚本所在目录的上级目录)
const packageJsonPath = path.join(__dirname, "..", "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

// 解析当前版本号
const currentVersion = packageJson.version;
const versionParts = currentVersion.split(".").map(Number);

// 递增补丁版本号 (x.y.z -> x.y.z+1)
versionParts[2] += 1;

// 生成新版本号
const newVersion = versionParts.join(".");

// 更新package.json
packageJson.version = newVersion;

// 写回package.json
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 4) + "\n");

console.log(`Version updated: ${currentVersion} -> ${newVersion}`);
console.log(`Updated package.json`);
