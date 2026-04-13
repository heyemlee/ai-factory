#!/bin/bash
# ai-factory - 自动扫描邮箱并处理订单
# 每 5 分钟运行一次

while true; do
    # 每 5 分钟检查一次（300 秒）
    sleep 300
    
    # 1. 检查是否有新邮件
    NEW_EMAIL=$(python3 email_reader.py --only-new 2>/dev/null)
    
    if [ -n "$NEW_EMAIL" ]; then
        echo "$(date +'%Y-%m-%d %H:%M:%S') - 发现新邮件：$NEW_EMAIL"
        
        # 2. 读取新邮件
        bash scripts/read_email.sh
        echo "$(date +'%Y-%m-%d %H:%M:%S') - 已读取邮件"
        
        # 3. 自动处理订单（完整 pipeline）
        bash scripts/run_pipeline.sh
        echo "$(date +'%Y-%m-%d %H:%M:%S') - 订单处理完成"
        
        # 4. 发送 Telegram 通知
        bash scripts/send_notification.sh
        echo "$(date +'%Y-%m-%d %H:%M:%S') - 已发送通知"
    fi
done
