
import csv
import json
import sys
from collections import Counter
from pathlib import Path


def analyze_csv(file_path):
    path = Path(file_path)

    if not path.is_file():
        raise FileNotFoundError(f"CSV file not found: {path}")

    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)

        if not reader.fieldnames:
            raise ValueError("CSV file has no headers.")

        headers = reader.fieldnames
        rows = list(reader)

    report = {
        "file": path.name,
        "total_rows": len(rows),
        "total_columns": len(headers),
        "columns": {},
        "duplicate_rows": 0,
    }

    row_counts = Counter(
        tuple((row.get(header) or "").strip() for header in headers)
        for row in rows
    )

    report["duplicate_rows"] = sum(
        count - 1 for count in row_counts.values() if count > 1
    )

    for header in headers:
        values = [(row.get(header) or "").strip() for row in rows]
        non_empty = [value for value in values if value]

        report["columns"][header] = {
            "empty_values": len(values) - len(non_empty),
            "unique_values": len(set(non_empty)),
        }

    return report


def main():
    if len(sys.argv) != 2:
        print("Usage: python csv_analyzer.py <file.csv>")
        sys.exit(1)

    try:
        report = analyze_csv(sys.argv[1])
        print(json.dumps(report, indent=2))
    except (OSError, ValueError, csv.Error) as error:
        print(f"Analysis failed: {error}")
        sys.exit(1)


if __name__ == "__main__":
    main()
