"""
邮件读取工具 — 从 Gmail 下载 Excel 订单附件

使用 config/settings.py 中的凭据配置。
"""

import imaplib
import email
import os
import sys
import time
from email.header import decode_header

# 确保从任何目录运行都能找到项目模块
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.settings import EMAIL_USER, EMAIL_PASS, IMAP_SERVER, INCOMING_ORDERS_DIR
from config.logger import get_logger

log = get_logger("email_reader")

SAVE_DIR = str(INCOMING_ORDERS_DIR)


def download_excel_attachments():

    os.makedirs(SAVE_DIR, exist_ok=True)

    log.info("连接 Gmail...")
    mail = imaplib.IMAP4_SSL(IMAP_SERVER)

    log.info("登录 Gmail...")
    mail.login(EMAIL_USER, EMAIL_PASS)

    log.info("登录成功")

    mail.select("inbox")

    log.info("搜索未读邮件...")
    status, messages = mail.search(None, '(UNSEEN)')
    email_ids = messages[0].split()

    log.info(f"找到未读邮件数量: {len(email_ids)}")

    # 只读取最新5封邮件（推荐）
    email_ids = email_ids[-5:]

    downloaded = []

    for email_id in email_ids:

        status, msg_data = mail.fetch(email_id, "(RFC822)")

        for response_part in msg_data:

            if isinstance(response_part, tuple):

                msg = email.message_from_bytes(response_part[1])

                subject, encoding = decode_header(msg["Subject"])[0]
                if isinstance(subject, bytes):
                    subject = subject.decode(encoding or "utf-8")

                log.info(f"处理邮件: {subject}")

                for part in msg.walk():

                    content_disposition = str(part.get("Content-Disposition"))

                    if "attachment" in content_disposition:

                        filename = part.get_filename()

                        if filename:

                            decoded_name, enc = decode_header(filename)[0]

                            if isinstance(decoded_name, bytes):
                                filename = decoded_name.decode(enc or "utf-8")
                            else:
                                filename = decoded_name

                            # 只下载 Excel 文件
                            if filename.lower().endswith(".xlsx"):

                                # 保持原始文件名，不再添加时间戳前缀
                                filepath = os.path.join(SAVE_DIR, filename)

                                with open(filepath, "wb") as f:
                                    f.write(part.get_payload(decode=True))

                                downloaded.append(filepath)

                                log.info(f"下载订单: {filepath}")

    mail.logout()

    log.info("邮件处理完成")

    return downloaded


if __name__ == "__main__":

    files = download_excel_attachments()

    print("下载文件列表:")
    print(files)