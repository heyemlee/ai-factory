import pandas as pd
import os


def run(order_path="data/order.xlsx", output_path="data/parts.xlsx"):

    print(f"开始拆单: {order_path}")

    order = pd.read_excel(order_path)

    # Drop fully empty rows (separator rows in the Excel)
    order = order.dropna(how="all")

    # Keep only rows that have the required fields
    required_cols = ["Name", "Specification", "Qty"]
    order = order.dropna(subset=required_cols)

    # Parse Specification column: "Length × Width × Thickness"
    # Split by '×', take first two values (length=height, width=width), discard thickness
    def parse_spec(spec):
        parts = str(spec).split("×")
        if len(parts) < 2:
            return None, None
        try:
            height = float(parts[0].strip())  # Length
            width  = float(parts[1].strip())  # Width
            # parts[2] is Thickness — ignored
            return height, width
        except ValueError:
            return None, None

    order[["height", "width"]] = order["Specification"].apply(
        lambda s: pd.Series(parse_spec(s))
    )

    # Drop rows where parsing failed
    order = order.dropna(subset=["height", "width"])

    # Rename and keep only the columns the cutting engine needs
    order = order.rename(columns={"Name": "part_id", "Qty": "qty"})
    order = order[["part_id", "width", "height", "qty"]]
    order = order.sort_values("width").reset_index(drop=True)

    os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else "data", exist_ok=True)

    order.to_excel(output_path, index=False)

    print(f"拆单完成，共 {len(order)} 个 parts: {output_path}")

    return output_path


if __name__ == "__main__":

    order_path = "data/order.xlsx"
    output_path = "data/parts.xlsx"

    run(order_path, output_path)