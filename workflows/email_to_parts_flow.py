import os
from tools.email_reader import download_excel_attachments
from agents.brain_agent import run as run_brain

def main():

    files = download_excel_attachments()

    if not files:
        print("没有新订单")
        return

    os.makedirs("data", exist_ok=True)

    for file in files:

        filename = os.path.basename(file)

        output = f"data/parts_{filename}"

        run_brain(file, output)

    print("自动拆单完成")

if __name__ == "__main__":
    main()