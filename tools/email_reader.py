import imaplib
import email
import os
import time
from email.header import decode_header

EMAIL_USER = "orders@abcabinet.us"
EMAIL_PASS = "dugljgoovcoolloh"

IMAP_SERVER = "imap.gmail.com"

SAVE_DIR = "incoming_orders"


def download_excel_attachments():

    os.makedirs(SAVE_DIR, exist_ok=True)

    print("连接 Gmail...")
    mail = imaplib.IMAP4_SSL(IMAP_SERVER)

    print("登录 Gmail...")
    mail.login(EMAIL_USER, EMAIL_PASS)

    print("登录成功")

    mail.select("inbox")

    print("搜索未读邮件...")
    status, messages = mail.search(None, '(UNSEEN)')
    email_ids = messages[0].split()

    print("找到未读邮件数量:", len(email_ids))

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

                print(f"处理邮件: {subject}")

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

                                timestamp = int(time.time())
                                filename = f"{timestamp}_{filename}"

                                filepath = os.path.join(SAVE_DIR, filename)

                                with open(filepath, "wb") as f:
                                    f.write(part.get_payload(decode=True))

                                downloaded.append(filepath)

                                print(f"下载订单: {filepath}")

    mail.logout()

    print("邮件处理完成")

    return downloaded


if __name__ == "__main__":

    files = download_excel_attachments()

    print("下载文件列表:")
    print(files)