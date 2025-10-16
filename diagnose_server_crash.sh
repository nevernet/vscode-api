#!/bin/bash

echo "=== LSP崩溃诊断脚本 ==="

# 检查进程状态
echo "1. 检查当前LSP进程状态:"
ps aux | grep -E "(api.*language.*server|node.*server\.js)" | grep -v grep || echo "没有找到API语言服务器进程"

# 检查内存使用情况
echo -e "\n2. 检查系统内存使用:"
echo "总内存: $(echo "scale=2; $(sysctl -n hw.memsize) / 1024 / 1024 / 1024" | bc) GB"
echo "可用内存: $(echo "scale=2; $(vm_stat | awk '/free:/{print $3 * 4096 / 1024 / 1024 / 1024}') GB")"

# 检查最近的日志
echo -e "\n3. 检查最近的错误日志:"
tail -20 logs/lsp-errors.log 2>/dev/null || echo "错误日志文件不存在"

# 检查Node.js进程限制
echo -e "\n4. 检查Node.js进程限制:"
ulimit -a | grep -E "(nofile|max memory size)"

echo -e "\n5. 检查系统负载:"
uptime
