
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from csv_analyzer import analyze_csv


def generate_report(csv_path):
    """Analyze CSV data and prepare a structured report."""
    analysis = analyze_csv(csv_path)

    return {
        "report_type": "CSV Data Quality",
        "generated_at": datetime.now(
            timezone.utc
        ).isoformat(),
        "source": str(csv_path),
        "summary": {
            "total_rows": analysis["total_rows"],
            "total_columns": analysis["total_columns"],
            "duplicate_rows": analysis["duplicate_rows"],
        },
        "column_analysis": analysis["columns"],
        "status": "completed",
    }


def save_report(report, output_path):
    """Save a report as formatted JSON."""
    destination = Path(output_path)
    destination.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    with destination.open("w", encoding="utf-8") as file:
        json.dump(report, file, indent=4)

    return destination


def print_summary(report):
    """Display a readable analysis summary."""
    summary = report["summary"]

    print("\n========== DATA QUALITY REPORT ==========")
    print("Source:", report["source"])
    print("Rows:", summary["total_rows"])
    print("Columns:", summary["total_columns"])
    print("Duplicates:", summary["duplicate_rows"])

    print("\nColumn statistics:")

    for name, stats in report["column_analysis"].items():
        print(f"\n{name}")
        print("  Empty values:", stats["empty_values"])
        print("  Unique values:", stats["unique_values"])

    print("\nStatus:", report["status"])
    print("=========================================")


def main():
    parser = argparse.ArgumentParser(
        description="Generate CSV data quality reports"
    )

    parser.add_argument(
        "input",
        help="Path to source CSV file"
    )

    parser.add_argument(
        "--output",
        default="report.json",
        help="Output JSON file path"
    )

    args = parser.parse_args()

    try:
        report = generate_report(args.input)
        destination = save_report(
            report,
            args.output
        )

        print_summary(report)
        print(f"\nReport saved: {destination}")

    except (OSError, ValueError, KeyError) as error:
        print(f"Report generation failed: {error}")
        sys.exit(1)


if __name__ == "__main__":
    main()
